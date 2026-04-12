package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	stripe "github.com/stripe/stripe-go/v76"
	bpsession "github.com/stripe/stripe-go/v76/billingportal/session"
	cksession "github.com/stripe/stripe-go/v76/checkout/session"
	stripeCustomer "github.com/stripe/stripe-go/v76/customer"
	"github.com/stripe/stripe-go/v76/webhook"
)

// ── config ───────────────────────────────────────────────────────────────────

// BillingConfig holds Stripe keys and price IDs loaded from environment variables.
type BillingConfig struct {
	SecretKey       string
	PublishableKey  string
	WebhookSecret   string
	PriceIDPro      string
	PriceIDEnt      string
	PriceIDTok50    string
	PriceIDTok250   string
	PriceIDTok1000  string
	AppURL          string
}

// IsEnabled reports whether billing is configured (i.e. a secret key is set).
func (bc *BillingConfig) IsEnabled() bool { return bc.SecretKey != "" }

// loadBillingConfig reads billing configuration from environment variables.
func loadBillingConfig() *BillingConfig {
	appURL := os.Getenv("APP_URL")
	if appURL == "" {
		appURL = "http://localhost:4040"
	}
	return &BillingConfig{
		SecretKey:      os.Getenv("STRIPE_SECRET_KEY"),
		PublishableKey: os.Getenv("STRIPE_PUBLISHABLE_KEY"),
		WebhookSecret:  os.Getenv("STRIPE_WEBHOOK_SECRET"),
		PriceIDPro:     os.Getenv("STRIPE_PRICE_PRO_MONTHLY"),
		PriceIDEnt:     os.Getenv("STRIPE_PRICE_ENT_MONTHLY"),
		PriceIDTok50:   os.Getenv("STRIPE_PRICE_TOKENS_50"),
		PriceIDTok250:  os.Getenv("STRIPE_PRICE_TOKENS_250"),
		PriceIDTok1000: os.Getenv("STRIPE_PRICE_TOKENS_1000"),
		AppURL:         appURL,
	}
}

// ── token costs ───────────────────────────────────────────────────────────────

const freeDailyLimit = 10

// freeTokenCosts maps op names to their token cost for free-tier users.
// Pro/Enterprise users always pay 0.
var freeTokenCosts = map[string]int{
	// Image ops — free for all tiers
	"image_to_jpg":  0,
	"image_to_png":  0,
	"image_to_webp": 0,
	"image_to_avif": 0,
	"image_resize":  0,
	"blur":          0,
	"sharpen":       0,
	"grayscale":     0,

	// Basic audio — free for all tiers
	"audio_mp3":     0,
	"audio_aac":     0,
	"audio_flac":    0,
	"extract_audio": 0,

	// Standard video ops — 3 tokens
	"transcode":        3,
	"transcode_webm":   3,
	"transcode_mkv":    3,
	"resize":           3,
	"trim":             3,
	"change_framerate": 3,
	"change_bitrate":   3,
	"speed":            3,
	"crop":             3,
	"gif_from_images":  3,
	"pad_aspect":       3,

	// Medium ops
	"audio_trim":      2,
	"audio_fade":      2,
	"stereo_to_mono":  1,
	"audio_bitrate":   1,
	"rotate":          2,
	"flip":            2,
	"thumbnail":       2,
	"loop":            3,
	"audio_concat":    3,
	"concat":          5,
	"watermark":       5,
	"reverse":         5,
	"gif_from_video":  5,
	"meme_overlay":    5,
	"silence_trim":    3,
	"spectrogram":     5,
	"waveform_png":    3,
	"youtube_preview": 5,
	"subtitles_soft":  5,

	// Heavy ops
	"h264_to_h265":    10,
	"normalize_audio": 8,
	"timelapse":       8,
	"contact_sheet":   8,
	"subtitles_burn":  8,
	"time_stretch":    8,
	"pitch_shift":     8,

	// audio_opus not explicitly listed — default 5
}

// TokenCostForOp returns the token cost for an op given the user's tier.
func TokenCostForOp(op, tier string) int {
	if tier == "pro" || tier == "enterprise" {
		return 0
	}
	if cost, ok := freeTokenCosts[op]; ok {
		return cost
	}
	return 5 // unknown op default
}

// ── types ─────────────────────────────────────────────────────────────────────

// BillingHandler holds references to the DB and configuration.
type BillingHandler struct {
	DB  *BillingDB
	Cfg *BillingConfig
}

// BillingError is returned with HTTP 402 when an operation is blocked.
type BillingError struct {
	Error          string `json:"error"`
	Kind           string `json:"kind"` // "auth_required" | "insufficient_tokens" | "daily_limit"
	Message        string `json:"message"`
	RequiredTokens int    `json:"required_tokens,omitempty"`
	Balance        int    `json:"balance,omitempty"`
	DailyUsed      int    `json:"daily_used,omitempty"`
	DailyMax       int    `json:"daily_max,omitempty"`
}

// BillingInfo is returned by GET /billing/me.
type BillingInfo struct {
	LoggedIn     bool   `json:"logged_in"`
	Email        string `json:"email,omitempty"`
	Tier         string `json:"tier"`
	TokenBalance int    `json:"token_balance"`
	DailyOpsUsed int    `json:"daily_ops_used"`
	DailyOpsMax  int    `json:"daily_ops_max"` // -1 = unlimited
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

// Me returns the current user's billing info.
// GET /billing/me
func (h *BillingHandler) Me(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "GET only")
		return
	}

	if !h.Cfg.IsEnabled() {
		writeJSON(w, http.StatusOK, BillingInfo{
			LoggedIn:    false,
			Tier:        "free",
			DailyOpsMax: -1,
		})
		return
	}

	token := r.Header.Get("X-Session-Token")
	user, err := h.DB.GetUserBySession(token)
	if err != nil || user == nil {
		writeJSON(w, http.StatusOK, BillingInfo{
			LoggedIn:    false,
			Tier:        "free",
			DailyOpsMax: -1,
		})
		return
	}

	sub, _ := h.DB.GetSubscription(user.ID)
	tier := "free"
	if sub != nil {
		tier = sub.Tier
	}

	balance, _ := h.DB.GetTokenBalance(user.ID)
	dailyUsed, _ := h.DB.GetDailyOpCount(user.ID)

	dailyMax := freeDailyLimit
	if tier == "pro" || tier == "enterprise" {
		dailyMax = -1
	}

	writeJSON(w, http.StatusOK, BillingInfo{
		LoggedIn:     true,
		Email:        user.Email,
		Tier:         tier,
		TokenBalance: balance,
		DailyOpsUsed: dailyUsed,
		DailyOpsMax:  dailyMax,
	})
}

// Identify creates or retrieves a user account by email.
// POST /billing/identify  body: {"email":"..."}
func (h *BillingHandler) Identify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	if !h.Cfg.IsEnabled() {
		writeErr(w, http.StatusServiceUnavailable, "billing not enabled")
		return
	}

	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" {
		writeErr(w, http.StatusBadRequest, "invalid body: expected {\"email\":\"...\"}")
		return
	}

	user, err := h.DB.GetOrCreateUser(body.Email)
	if err != nil {
		log.Printf("billing identify error: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to create account")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"session_token": user.SessionToken,
		"email":         user.Email,
	})
}

// CreateSubscriptionCheckout creates a Stripe Checkout session for a subscription.
// POST /billing/checkout/subscription  body: {"plan":"pro"|"enterprise"}
func (h *BillingHandler) CreateSubscriptionCheckout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	if !h.Cfg.IsEnabled() {
		writeErr(w, http.StatusServiceUnavailable, "billing not enabled")
		return
	}

	user, err := h.authUser(r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		Plan string `json:"plan"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	var priceID string
	switch body.Plan {
	case "pro":
		priceID = h.Cfg.PriceIDPro
	case "enterprise":
		priceID = h.Cfg.PriceIDEnt
	default:
		writeErr(w, http.StatusBadRequest, "plan must be 'pro' or 'enterprise'")
		return
	}
	if priceID == "" {
		writeErr(w, http.StatusInternalServerError, "price ID not configured for plan: "+body.Plan)
		return
	}

	custID, err := h.ensureStripeCustomer(user)
	if err != nil {
		log.Printf("billing checkout subscription: ensure customer: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to create customer")
		return
	}

	stripe.Key = h.Cfg.SecretKey
	params := &stripe.CheckoutSessionParams{
		Customer: stripe.String(custID),
		Mode:     stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{Price: stripe.String(priceID), Quantity: stripe.Int64(1)},
		},
		SuccessURL: stripe.String(h.Cfg.AppURL + "?billing=success"),
		CancelURL:  stripe.String(h.Cfg.AppURL + "?billing=cancel"),
	}

	sess, err := cksession.New(params)
	if err != nil {
		log.Printf("billing checkout subscription stripe error: %v", err)
		writeErr(w, http.StatusInternalServerError, "stripe error: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"url": sess.URL})
}

// CreateTokenCheckout creates a Stripe Checkout session for a token pack purchase.
// POST /billing/checkout/tokens  body: {"pack":"50"|"250"|"1000"}
func (h *BillingHandler) CreateTokenCheckout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	if !h.Cfg.IsEnabled() {
		writeErr(w, http.StatusServiceUnavailable, "billing not enabled")
		return
	}

	user, err := h.authUser(r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "authentication required")
		return
	}

	var body struct {
		Pack string `json:"pack"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	var priceID string
	switch body.Pack {
	case "50":
		priceID = h.Cfg.PriceIDTok50
	case "250":
		priceID = h.Cfg.PriceIDTok250
	case "1000":
		priceID = h.Cfg.PriceIDTok1000
	default:
		writeErr(w, http.StatusBadRequest, "pack must be '50', '250', or '1000'")
		return
	}
	if priceID == "" {
		writeErr(w, http.StatusInternalServerError, "price ID not configured for pack: "+body.Pack)
		return
	}

	custID, err := h.ensureStripeCustomer(user)
	if err != nil {
		log.Printf("billing checkout tokens: ensure customer: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to create customer")
		return
	}

	stripe.Key = h.Cfg.SecretKey
	params := &stripe.CheckoutSessionParams{
		Customer: stripe.String(custID),
		Mode:     stripe.String(string(stripe.CheckoutSessionModePayment)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{Price: stripe.String(priceID), Quantity: stripe.Int64(1)},
		},
		SuccessURL: stripe.String(h.Cfg.AppURL + "?billing=success"),
		CancelURL:  stripe.String(h.Cfg.AppURL + "?billing=cancel"),
		Metadata: map[string]string{
			"token_pack": body.Pack,
		},
	}

	sess, err := cksession.New(params)
	if err != nil {
		log.Printf("billing checkout tokens stripe error: %v", err)
		writeErr(w, http.StatusInternalServerError, "stripe error: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"url": sess.URL})
}

// CustomerPortal creates a Stripe Billing Portal session.
// POST /billing/portal
func (h *BillingHandler) CustomerPortal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	if !h.Cfg.IsEnabled() {
		writeErr(w, http.StatusServiceUnavailable, "billing not enabled")
		return
	}

	user, err := h.authUser(r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "authentication required")
		return
	}

	custID, err := h.ensureStripeCustomer(user)
	if err != nil {
		log.Printf("billing portal: ensure customer: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to create customer")
		return
	}

	stripe.Key = h.Cfg.SecretKey
	params := &stripe.BillingPortalSessionParams{
		Customer:  stripe.String(custID),
		ReturnURL: stripe.String(h.Cfg.AppURL),
	}

	sess, err := bpsession.New(params)
	if err != nil {
		log.Printf("billing portal stripe error: %v", err)
		writeErr(w, http.StatusInternalServerError, "stripe error: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"url": sess.URL})
}

// Webhook handles incoming Stripe webhook events.
// POST /billing/webhook
func (h *BillingHandler) Webhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "POST only")
		return
	}

	const maxBodyBytes = 65536
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "cannot read body")
		return
	}

	var event stripe.Event
	if h.Cfg.WebhookSecret != "" {
		sigHeader := r.Header.Get("Stripe-Signature")
		event, err = webhook.ConstructEvent(body, sigHeader, h.Cfg.WebhookSecret)
		if err != nil {
			log.Printf("billing webhook signature verification failed: %v", err)
			writeErr(w, http.StatusBadRequest, "invalid signature")
			return
		}
	} else {
		if err := json.Unmarshal(body, &event); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid JSON")
			return
		}
	}

	stripe.Key = h.Cfg.SecretKey

	switch event.Type {
	case "checkout.session.completed":
		h.handleCheckoutCompleted(event)
	case "customer.subscription.updated", "customer.subscription.deleted":
		h.handleSubscriptionChange(event)
	case "invoice.paid":
		h.handleInvoicePaid(event)
	default:
		// Unhandled event — that's fine.
	}

	w.WriteHeader(http.StatusOK)
}

// ── webhook sub-handlers ──────────────────────────────────────────────────────

func (h *BillingHandler) handleCheckoutCompleted(event stripe.Event) {
	var sess stripe.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &sess); err != nil {
		log.Printf("billing webhook: unmarshal checkout.session.completed: %v", err)
		return
	}
	if sess.Mode != stripe.CheckoutSessionModePayment {
		return // subscription checkouts handled by subscription events
	}

	pack := sess.Metadata["token_pack"]
	var tokens int
	switch pack {
	case "50":
		tokens = 50
	case "250":
		tokens = 250
	case "1000":
		tokens = 1000
	default:
		log.Printf("billing webhook: unknown token_pack %q", pack)
		return
	}

	custID := ""
	if sess.Customer != nil {
		custID = sess.Customer.ID
	}
	if custID == "" {
		log.Printf("billing webhook: checkout.session.completed has no customer")
		return
	}

	user, err := h.DB.GetUserByStripeCustomer(custID)
	if err != nil {
		log.Printf("billing webhook: user not found for customer %s: %v", custID, err)
		return
	}

	if err := h.DB.AddTokens(user.ID, tokens, "token_purchase", fmt.Sprintf("pack=%s session=%s", pack, sess.ID)); err != nil {
		log.Printf("billing webhook: add tokens failed for user %s: %v", user.ID, err)
	} else {
		log.Printf("billing webhook: credited %d tokens to user %s", tokens, user.ID)
	}
}

func (h *BillingHandler) handleSubscriptionChange(event stripe.Event) {
	var sub stripe.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		log.Printf("billing webhook: unmarshal subscription event: %v", err)
		return
	}

	custID := ""
	if sub.Customer != nil {
		custID = sub.Customer.ID
	}
	if custID == "" {
		log.Printf("billing webhook: subscription event has no customer")
		return
	}

	user, err := h.DB.GetUserByStripeCustomer(custID)
	if err != nil {
		log.Printf("billing webhook: user not found for customer %s: %v", custID, err)
		return
	}

	tier := "free"
	priceID := ""
	if len(sub.Items.Data) > 0 && sub.Items.Data[0].Price != nil {
		priceID = sub.Items.Data[0].Price.ID
		tier = h.tierFromPriceID(priceID)
	}

	status := string(sub.Status)
	if event.Type == "customer.subscription.deleted" {
		status = "canceled"
		tier = "free"
	}

	s := &Subscription{
		UserID:               user.ID,
		StripeSubscriptionID: sub.ID,
		StripePriceID:        priceID,
		Tier:                 tier,
		Status:               status,
		CurrentPeriodEnd:     time.Unix(sub.CurrentPeriodEnd, 0),
	}
	if err := h.DB.UpsertSubscription(s); err != nil {
		log.Printf("billing webhook: upsert subscription failed: %v", err)
	} else {
		log.Printf("billing webhook: subscription %s updated to tier=%s status=%s for user %s",
			sub.ID, tier, status, user.ID)
	}
}

func (h *BillingHandler) handleInvoicePaid(event stripe.Event) {
	var inv stripe.Invoice
	if err := json.Unmarshal(event.Data.Raw, &inv); err != nil {
		log.Printf("billing webhook: unmarshal invoice.paid: %v", err)
		return
	}

	custID := ""
	if inv.Customer != nil {
		custID = inv.Customer.ID
	}
	if custID == "" {
		return
	}

	user, err := h.DB.GetUserByStripeCustomer(custID)
	if err != nil {
		log.Printf("billing webhook: invoice.paid user not found for customer %s: %v", custID, err)
		return
	}

	sub, err := h.DB.GetSubscription(user.ID)
	if err != nil {
		return
	}

	var bonus int
	switch sub.Tier {
	case "pro":
		bonus = 100
	case "enterprise":
		bonus = 500
	default:
		return
	}

	invoiceID := inv.ID
	if err := h.DB.AddTokens(user.ID, bonus, "monthly_bonus", fmt.Sprintf("tier=%s invoice=%s", sub.Tier, invoiceID)); err != nil {
		log.Printf("billing webhook: monthly bonus failed for user %s: %v", user.ID, err)
	} else {
		log.Printf("billing webhook: credited %d monthly bonus tokens to user %s (%s tier)", bonus, user.ID, sub.Tier)
	}
}

// ── CheckConvert ──────────────────────────────────────────────────────────────

// CheckConvert enforces billing rules before a conversion op is allowed to run.
// Returns nil if the op is permitted, or a *BillingError to return to the client.
func (h *BillingHandler) CheckConvert(r *http.Request, opName string) *BillingError {
	if !h.Cfg.IsEnabled() {
		return nil
	}

	token := r.Header.Get("X-Session-Token")
	user, err := h.DB.GetUserBySession(token)

	// Anonymous user.
	if err != nil || user == nil {
		cost := TokenCostForOp(opName, "free")
		if cost > 0 {
			return &BillingError{
				Error:          "authentication required",
				Kind:           "auth_required",
				Message:        "Sign in to use this op. It requires tokens.",
				RequiredTokens: cost,
			}
		}
		// Free op — allow anonymous.
		return nil
	}

	// Authenticated user.
	sub, _ := h.DB.GetSubscription(user.ID)
	tier := "free"
	if sub != nil {
		tier = sub.Tier
	}

	cost := TokenCostForOp(opName, tier)

	// Pro/Enterprise: just track usage.
	if tier == "pro" || tier == "enterprise" {
		_ = h.DB.IncrementDailyOp(user.ID)
		return nil
	}

	// Free tier: check daily limit.
	dailyUsed, _ := h.DB.GetDailyOpCount(user.ID)
	if dailyUsed >= freeDailyLimit {
		return &BillingError{
			Error:     "daily limit reached",
			Kind:      "daily_limit",
			Message:   fmt.Sprintf("Free plan allows %d ops per day. Upgrade to Pro for unlimited.", freeDailyLimit),
			DailyUsed: dailyUsed,
			DailyMax:  freeDailyLimit,
		}
	}

	// Free tier: check token balance for non-free ops.
	if cost > 0 {
		balance, _ := h.DB.GetTokenBalance(user.ID)
		if balance < cost {
			return &BillingError{
				Error:          "insufficient tokens",
				Kind:           "insufficient_tokens",
				Message:        fmt.Sprintf("This op costs %d tokens, but you have %d.", cost, balance),
				RequiredTokens: cost,
				Balance:        balance,
			}
		}
		if err := h.DB.DeductTokens(user.ID, cost, "op:"+opName); err != nil {
			return &BillingError{
				Error:   "token deduction failed",
				Kind:    "insufficient_tokens",
				Message: "Could not deduct tokens: " + err.Error(),
			}
		}
	}

	_ = h.DB.IncrementDailyOp(user.ID)
	return nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

// authUser reads the session token from the request and returns the user.
func (h *BillingHandler) authUser(r *http.Request) (*User, error) {
	token := r.Header.Get("X-Session-Token")
	user, err := h.DB.GetUserBySession(token)
	if err != nil {
		return nil, fmt.Errorf("invalid session")
	}
	return user, nil
}

// ensureStripeCustomer creates a Stripe customer if the user doesn't have one yet.
func (h *BillingHandler) ensureStripeCustomer(user *User) (string, error) {
	if user.StripeCustomerID != "" {
		return user.StripeCustomerID, nil
	}

	stripe.Key = h.Cfg.SecretKey
	params := &stripe.CustomerParams{
		Email: stripe.String(user.Email),
	}
	params.AddMetadata("user_id", user.ID)

	cust, err := stripeCustomer.New(params)
	if err != nil {
		return "", fmt.Errorf("create stripe customer: %w", err)
	}

	if err := h.DB.UpdateStripeCustomer(user.ID, cust.ID); err != nil {
		return "", fmt.Errorf("save stripe customer id: %w", err)
	}

	return cust.ID, nil
}

// tierFromPriceID maps a Stripe price ID to a tier name.
func (h *BillingHandler) tierFromPriceID(priceID string) string {
	switch priceID {
	case h.Cfg.PriceIDPro:
		return "pro"
	case h.Cfg.PriceIDEnt:
		return "enterprise"
	default:
		return "free"
	}
}
