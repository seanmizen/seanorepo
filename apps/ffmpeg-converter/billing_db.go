package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// BillingDB wraps the SQLite connection and exposes billing-specific queries.
type BillingDB struct {
	db *sql.DB
}

// User represents a registered user.
type User struct {
	ID               string
	Email            string
	StripeCustomerID string
	SessionToken     string
	CreatedAt        time.Time
}

// Subscription represents a user's current subscription.
type Subscription struct {
	ID                   string
	UserID               string
	StripeSubscriptionID string
	StripePriceID        string
	Tier                 string
	Status               string
	CurrentPeriodEnd     time.Time
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    stripe_customer_id TEXT,
    session_token TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    stripe_subscription_id TEXT UNIQUE,
    stripe_price_id TEXT,
    tier TEXT NOT NULL DEFAULT 'free',
    status TEXT NOT NULL DEFAULT 'active',
    current_period_end DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS token_balances (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    balance INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS token_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    metadata TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS daily_usage (
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date)
);
`

// NewBillingDB opens (or creates) the SQLite database at path and applies the schema.
func NewBillingDB(path string) (*BillingDB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open billing db: %w", err)
	}
	db.SetMaxOpenConns(1) // SQLite is single-writer
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply billing schema: %w", err)
	}
	return &BillingDB{db: db}, nil
}

// GetOrCreateUser upserts a user by email. A session token is created on insert.
func (b *BillingDB) GetOrCreateUser(email string) (*User, error) {
	// Try to fetch first.
	u, err := b.GetUserByEmail(email)
	if err == nil {
		return u, nil
	}

	// Create new.
	id := generateID()
	token := generateSessionToken()
	_, err = b.db.Exec(
		`INSERT INTO users (id, email, session_token) VALUES (?, ?, ?)
         ON CONFLICT(email) DO NOTHING`,
		id, email, token,
	)
	if err != nil {
		return nil, fmt.Errorf("insert user: %w", err)
	}
	// Another concurrent insert may have won the race — fetch again.
	return b.GetUserByEmail(email)
}

// GetUserByEmail returns a user by email, or an error if not found.
func (b *BillingDB) GetUserByEmail(email string) (*User, error) {
	row := b.db.QueryRow(
		`SELECT id, email, COALESCE(stripe_customer_id,''), COALESCE(session_token,''), created_at
         FROM users WHERE email = ?`, email)
	return scanUser(row)
}

// GetUserBySession returns a user by session token.
func (b *BillingDB) GetUserBySession(token string) (*User, error) {
	if token == "" {
		return nil, fmt.Errorf("empty session token")
	}
	row := b.db.QueryRow(
		`SELECT id, email, COALESCE(stripe_customer_id,''), COALESCE(session_token,''), created_at
         FROM users WHERE session_token = ?`, token)
	return scanUser(row)
}

// GetUserByStripeCustomer returns a user by Stripe customer ID.
func (b *BillingDB) GetUserByStripeCustomer(custID string) (*User, error) {
	row := b.db.QueryRow(
		`SELECT id, email, COALESCE(stripe_customer_id,''), COALESCE(session_token,''), created_at
         FROM users WHERE stripe_customer_id = ?`, custID)
	return scanUser(row)
}

// UpdateStripeCustomer stores the Stripe customer ID for a user.
func (b *BillingDB) UpdateStripeCustomer(userID, custID string) error {
	_, err := b.db.Exec(`UPDATE users SET stripe_customer_id = ? WHERE id = ?`, custID, userID)
	return err
}

// GetSubscription returns the active subscription for a user, or a synthetic
// free-tier subscription if none is found.
func (b *BillingDB) GetSubscription(userID string) (*Subscription, error) {
	row := b.db.QueryRow(
		`SELECT id, user_id, COALESCE(stripe_subscription_id,''), COALESCE(stripe_price_id,''),
                tier, status, COALESCE(current_period_end, '1970-01-01')
         FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`, userID)
	var s Subscription
	var periodEnd string
	err := row.Scan(&s.ID, &s.UserID, &s.StripeSubscriptionID, &s.StripePriceID,
		&s.Tier, &s.Status, &periodEnd)
	if err == sql.ErrNoRows {
		return &Subscription{UserID: userID, Tier: "free", Status: "active"}, nil
	}
	if err != nil {
		return nil, err
	}
	s.CurrentPeriodEnd, _ = time.Parse("2006-01-02T15:04:05Z", periodEnd)
	return &s, nil
}

// UpsertSubscription inserts or updates a subscription record.
func (b *BillingDB) UpsertSubscription(s *Subscription) error {
	if s.ID == "" {
		s.ID = generateID()
	}
	periodEnd := s.CurrentPeriodEnd.UTC().Format("2006-01-02T15:04:05Z")
	_, err := b.db.Exec(`
        INSERT INTO subscriptions
            (id, user_id, stripe_subscription_id, stripe_price_id, tier, status, current_period_end, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(stripe_subscription_id) DO UPDATE SET
            tier = excluded.tier,
            status = excluded.status,
            stripe_price_id = excluded.stripe_price_id,
            current_period_end = excluded.current_period_end,
            updated_at = CURRENT_TIMESTAMP`,
		s.ID, s.UserID, s.StripeSubscriptionID, s.StripePriceID,
		s.Tier, s.Status, periodEnd,
	)
	return err
}

// GetTokenBalance returns the current token balance for a user (0 if no row).
func (b *BillingDB) GetTokenBalance(userID string) (int, error) {
	var bal int
	err := b.db.QueryRow(`SELECT balance FROM token_balances WHERE user_id = ?`, userID).Scan(&bal)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return bal, err
}

// AddTokens credits tokens to a user's balance within a transaction.
func (b *BillingDB) AddTokens(userID string, amount int, reason, meta string) error {
	tx, err := b.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	// Upsert balance.
	_, err = tx.Exec(`
        INSERT INTO token_balances (user_id, balance, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            balance = balance + excluded.balance,
            updated_at = CURRENT_TIMESTAMP`,
		userID, amount)
	if err != nil {
		return err
	}

	// Record transaction.
	_, err = tx.Exec(
		`INSERT INTO token_transactions (id, user_id, amount, reason, metadata) VALUES (?, ?, ?, ?, ?)`,
		generateID(), userID, amount, reason, meta,
	)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// DeductTokens removes tokens from a user's balance. Returns an error if the
// balance is insufficient.
func (b *BillingDB) DeductTokens(userID string, amount int, reason string) error {
	tx, err := b.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var bal int
	err = tx.QueryRow(`SELECT balance FROM token_balances WHERE user_id = ?`, userID).Scan(&bal)
	if err == sql.ErrNoRows {
		bal = 0
	} else if err != nil {
		return err
	}

	if bal < amount {
		return fmt.Errorf("insufficient tokens: have %d, need %d", bal, amount)
	}

	_, err = tx.Exec(`
        UPDATE token_balances SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`, amount, userID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(
		`INSERT INTO token_transactions (id, user_id, amount, reason) VALUES (?, ?, ?, ?)`,
		generateID(), userID, -amount, reason,
	)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// GetDailyOpCount returns today's op count for the user.
func (b *BillingDB) GetDailyOpCount(userID string) (int, error) {
	today := time.Now().UTC().Format("2006-01-02")
	var count int
	err := b.db.QueryRow(
		`SELECT count FROM daily_usage WHERE user_id = ? AND date = ?`, userID, today,
	).Scan(&count)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return count, err
}

// IncrementDailyOp increments today's op count for the user.
func (b *BillingDB) IncrementDailyOp(userID string) error {
	today := time.Now().UTC().Format("2006-01-02")
	_, err := b.db.Exec(`
        INSERT INTO daily_usage (user_id, date, count) VALUES (?, ?, 1)
        ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1`,
		userID, today,
	)
	return err
}

// ── helpers ──────────────────────────────────────────────────────────────────

func scanUser(row *sql.Row) (*User, error) {
	var u User
	var createdAt string
	err := row.Scan(&u.ID, &u.Email, &u.StripeCustomerID, &u.SessionToken, &createdAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, err
	}
	u.CreatedAt, _ = time.Parse("2006-01-02T15:04:05Z", createdAt)
	return &u, nil
}

func generateID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func generateSessionToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
