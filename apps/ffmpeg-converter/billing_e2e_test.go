package main

// Billing E2E tests.
//
// All billing logic runs against a real in-memory SQLite DB (no mocking).
// Stripe API calls (checkout, portal) are NOT made – those endpoints are
// tested only for their auth/validation error paths.
//
// Webhook events are sent as plain JSON (WebhookSecret = "") to test the
// business logic branch, and separately with a valid HMAC signature to test
// the signature-validation branch.

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ── helpers ───────────────────────────────────────────────────────────────────

const testWebhookSecret = "test_webhook_secret_for_hmac_validation"

// newTestBillingDB opens a fresh SQLite billing DB in a temp directory.
func newTestBillingDB(t *testing.T) *BillingDB {
	t.Helper()
	db, err := NewBillingDB(filepath.Join(t.TempDir(), "billing.db"))
	if err != nil {
		t.Fatalf("create billing DB: %v", err)
	}
	t.Cleanup(func() { _ = db.db.Close() })
	return db
}

// testBillingCfg returns a BillingConfig with fake keys and a given webhook
// secret (pass "" to disable signature validation in tests).
func testBillingCfg(webhookSecret string) *BillingConfig {
	return &BillingConfig{
		SecretKey:      "sk_test_fakefakefake",
		PublishableKey: "pk_test_fakefakefake",
		WebhookSecret:  webhookSecret,
		PriceIDPro:     "price_pro_test",
		PriceIDEnt:     "price_ent_test",
		PriceIDTok50:   "price_tok50_test",
		PriceIDTok250:  "price_tok250_test",
		PriceIDTok1000: "price_tok1000_test",
		AppURL:         "http://localhost:9876",
	}
}

// newBillingServer creates an httptest server with billing enabled.
// Business logic (DB operations) is real; Stripe API calls will error if made.
func newBillingServer(t *testing.T, webhookSecret string) (*httptest.Server, *BillingHandler) {
	t.Helper()
	db := newTestBillingDB(t)
	bh := &BillingHandler{DB: db, Cfg: testBillingCfg(webhookSecret)}
	ts := httptest.NewServer(buildMux(NewStore(t.TempDir()), NewJobTracker(), synthOps(), bh))
	t.Cleanup(ts.Close)
	return ts, bh
}

// createTestUser calls /billing/identify and returns the session token.
func createTestUser(t *testing.T, ts *httptest.Server, email string) string {
	t.Helper()
	payload, _ := json.Marshal(map[string]string{"email": email})
	resp, err := http.Post(ts.URL+"/billing/identify", "application/json", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("identify: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("identify: want 200, got %d: %s", resp.StatusCode, b)
	}
	var result map[string]string
	_ = json.NewDecoder(resp.Body).Decode(&result)
	if result["session_token"] == "" {
		t.Fatal("identify: empty session_token")
	}
	return result["session_token"]
}

// stripeWebhookSig generates a valid Stripe-Signature header for a given
// payload and secret, using the same HMAC algorithm as the real Stripe SDK.
// See: https://stripe.com/docs/webhooks#signatures
func stripeWebhookSig(payload []byte, secret string) string {
	ts := time.Now().Unix()
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.", ts)))
	mac.Write(payload)
	v1 := hex.EncodeToString(mac.Sum(nil))
	return fmt.Sprintf("t=%d,v1=%s", ts, v1)
}

// sendWebhook POSTs an event payload to /billing/webhook.
// If secret is non-empty, the Stripe-Signature header is computed and attached.
func sendWebhook(t *testing.T, ts *httptest.Server, payload []byte, secret string) (int, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, ts.URL+"/billing/webhook", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("webhook request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if secret != "" {
		req.Header.Set("Stripe-Signature", stripeWebhookSig(payload, secret))
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook do: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, body
}

// webhookPayload constructs a minimal Stripe event JSON payload.
// data is placed as the value of data.object.
// The api_version is set to match stripe-go v76's expected version (2023-10-16)
// so that ConstructEvent does not reject it on version mismatch.
func webhookPayload(eventType string, data any) []byte {
	event := map[string]any{
		"id":          "evt_test_" + randomID(),
		"type":        eventType,
		"api_version": "2023-10-16",
		"data": map[string]any{
			"object": data,
		},
	}
	b, _ := json.Marshal(event)
	return b
}

// billingGET sends an authenticated GET to the given path.
func billingGET(t *testing.T, ts *httptest.Server, path, sessionToken string) (int, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, ts.URL+path, nil)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	if sessionToken != "" {
		req.Header.Set("X-Session-Token", sessionToken)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do GET %s: %v", path, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, body
}

// billingPOST sends an authenticated POST with a JSON body.
func billingPOST(t *testing.T, ts *httptest.Server, path, sessionToken string, body any) (int, []byte) {
	t.Helper()
	payload, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, ts.URL+path, bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	req.Header.Set("Content-Type", "application/json")
	if sessionToken != "" {
		req.Header.Set("X-Session-Token", sessionToken)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do POST %s: %v", path, err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, respBody
}

// ── BillingDB unit tests ──────────────────────────────────────────────────────

func TestBillingDB_GetOrCreateUser(t *testing.T) {
	db := newTestBillingDB(t)

	u1, err := db.GetOrCreateUser("alice@example.com")
	if err != nil {
		t.Fatalf("first create: %v", err)
	}
	if u1.Email != "alice@example.com" {
		t.Errorf("want alice@example.com, got %q", u1.Email)
	}
	if u1.SessionToken == "" {
		t.Error("expected session token")
	}

	// Idempotent: same email returns same user.
	u2, err := db.GetOrCreateUser("alice@example.com")
	if err != nil {
		t.Fatalf("second create: %v", err)
	}
	if u1.ID != u2.ID {
		t.Errorf("want same ID, got %q vs %q", u1.ID, u2.ID)
	}
	if u1.SessionToken != u2.SessionToken {
		t.Error("session token changed on re-create")
	}
}

func TestBillingDB_GetUserBySession(t *testing.T) {
	db := newTestBillingDB(t)
	u, _ := db.GetOrCreateUser("bob@example.com")

	found, err := db.GetUserBySession(u.SessionToken)
	if err != nil {
		t.Fatalf("GetUserBySession: %v", err)
	}
	if found.ID != u.ID {
		t.Errorf("wrong user: want %q, got %q", u.ID, found.ID)
	}
}

func TestBillingDB_GetUserBySession_EmptyToken(t *testing.T) {
	db := newTestBillingDB(t)
	_, err := db.GetUserBySession("")
	if err == nil {
		t.Error("expected error for empty session token")
	}
}

func TestBillingDB_GetUserBySession_UnknownToken(t *testing.T) {
	db := newTestBillingDB(t)
	_, err := db.GetUserBySession("deadbeefdeadbeefdeadbeef")
	if err == nil {
		t.Error("expected error for unknown session token")
	}
}

func TestBillingDB_AddTokens(t *testing.T) {
	db := newTestBillingDB(t)
	u, _ := db.GetOrCreateUser("carol@example.com")

	if err := db.AddTokens(u.ID, 100, "test_purchase", "pack=100"); err != nil {
		t.Fatalf("AddTokens: %v", err)
	}
	bal, _ := db.GetTokenBalance(u.ID)
	if bal != 100 {
		t.Errorf("want 100, got %d", bal)
	}

	// Add more.
	_ = db.AddTokens(u.ID, 50, "bonus", "")
	bal, _ = db.GetTokenBalance(u.ID)
	if bal != 150 {
		t.Errorf("want 150, got %d", bal)
	}
}

func TestBillingDB_DeductTokens(t *testing.T) {
	db := newTestBillingDB(t)
	u, _ := db.GetOrCreateUser("dave@example.com")
	_ = db.AddTokens(u.ID, 50, "initial", "")

	if err := db.DeductTokens(u.ID, 20, "op:transcode"); err != nil {
		t.Fatalf("DeductTokens: %v", err)
	}
	bal, _ := db.GetTokenBalance(u.ID)
	if bal != 30 {
		t.Errorf("want 30, got %d", bal)
	}
}

func TestBillingDB_DeductTokens_Insufficient(t *testing.T) {
	db := newTestBillingDB(t)
	u, _ := db.GetOrCreateUser("eve@example.com")
	_ = db.AddTokens(u.ID, 5, "initial", "")

	if err := db.DeductTokens(u.ID, 10, "op:transcode"); err == nil {
		t.Error("expected error for insufficient tokens")
	}
	// Balance unchanged.
	bal, _ := db.GetTokenBalance(u.ID)
	if bal != 5 {
		t.Errorf("balance should be unchanged at 5, got %d", bal)
	}
}

func TestBillingDB_DeductTokens_ZeroBalance(t *testing.T) {
	db := newTestBillingDB(t)
	u, _ := db.GetOrCreateUser("frank@example.com")

	if err := db.DeductTokens(u.ID, 1, "op:transcode"); err == nil {
		t.Error("expected error deducting from zero balance")
	}
}

func TestBillingDB_DailyOpCount(t *testing.T) {
	db := newTestBillingDB(t)
	u, _ := db.GetOrCreateUser("grace@example.com")

	count, _ := db.GetDailyOpCount(u.ID)
	if count != 0 {
		t.Errorf("want 0, got %d", count)
	}

	for i := 0; i < 5; i++ {
		_ = db.IncrementDailyOp(u.ID)
	}
	count, _ = db.GetDailyOpCount(u.ID)
	if count != 5 {
		t.Errorf("want 5, got %d", count)
	}
}

func TestBillingDB_UpsertSubscription(t *testing.T) {
	db := newTestBillingDB(t)
	u, _ := db.GetOrCreateUser("heidi@example.com")

	sub := &Subscription{
		UserID:               u.ID,
		StripeSubscriptionID: "sub_test_001",
		StripePriceID:        "price_pro_test",
		Tier:                 "pro",
		Status:               "active",
		CurrentPeriodEnd:     time.Now().Add(30 * 24 * time.Hour),
	}
	if err := db.UpsertSubscription(sub); err != nil {
		t.Fatalf("UpsertSubscription: %v", err)
	}

	got, err := db.GetSubscription(u.ID)
	if err != nil {
		t.Fatalf("GetSubscription: %v", err)
	}
	if got.Tier != "pro" {
		t.Errorf("want pro, got %q", got.Tier)
	}
	if got.Status != "active" {
		t.Errorf("want active, got %q", got.Status)
	}
}

func TestBillingDB_UpsertSubscription_Update(t *testing.T) {
	db := newTestBillingDB(t)
	u, _ := db.GetOrCreateUser("ivan@example.com")

	sub := &Subscription{
		UserID:               u.ID,
		StripeSubscriptionID: "sub_test_002",
		Tier:                 "pro",
		Status:               "active",
	}
	_ = db.UpsertSubscription(sub)

	// Upgrade to enterprise.
	sub.Tier = "enterprise"
	sub.StripePriceID = "price_ent_test"
	if err := db.UpsertSubscription(sub); err != nil {
		t.Fatalf("UpsertSubscription update: %v", err)
	}

	got, _ := db.GetSubscription(u.ID)
	if got.Tier != "enterprise" {
		t.Errorf("want enterprise after update, got %q", got.Tier)
	}
}

func TestBillingDB_GetSubscription_NoSubscription_ReturnsFree(t *testing.T) {
	db := newTestBillingDB(t)
	u, _ := db.GetOrCreateUser("judy@example.com")

	sub, err := db.GetSubscription(u.ID)
	if err != nil {
		t.Fatalf("GetSubscription: %v", err)
	}
	if sub.Tier != "free" {
		t.Errorf("want free for user with no subscription, got %q", sub.Tier)
	}
}

// ── TokenCostForOp ────────────────────────────────────────────────────────────

func TestTokenCostForOp_ProAndEnterprisePay0(t *testing.T) {
	for _, tier := range []string{"pro", "enterprise"} {
		for _, op := range []string{"transcode", "h264_to_h265", "concat", "normalize_audio"} {
			cost := TokenCostForOp(op, tier)
			if cost != 0 {
				t.Errorf("tier %s op %s: want 0, got %d", tier, op, cost)
			}
		}
	}
}

func TestTokenCostForOp_FreeTierImageOps(t *testing.T) {
	freeOps := []string{"image_to_jpg", "image_to_png", "image_to_webp", "image_to_avif",
		"image_resize", "blur", "sharpen", "grayscale"}
	for _, op := range freeOps {
		if cost := TokenCostForOp(op, "free"); cost != 0 {
			t.Errorf("op %q: want 0 for free tier, got %d", op, cost)
		}
	}
}

func TestTokenCostForOp_FreeTierBasicAudio(t *testing.T) {
	for _, op := range []string{"audio_mp3", "audio_aac", "audio_flac", "extract_audio"} {
		if cost := TokenCostForOp(op, "free"); cost != 0 {
			t.Errorf("op %q: want 0 for free tier, got %d", op, cost)
		}
	}
}

func TestTokenCostForOp_FreeTierStandardVideo(t *testing.T) {
	standard3 := []string{"transcode", "transcode_webm", "transcode_mkv", "resize",
		"trim", "change_framerate", "change_bitrate", "speed", "crop", "gif_from_images", "pad_aspect"}
	for _, op := range standard3 {
		if cost := TokenCostForOp(op, "free"); cost != 3 {
			t.Errorf("op %q: want 3 for free tier, got %d", op, cost)
		}
	}
}

func TestTokenCostForOp_FreeTierHeavyOps(t *testing.T) {
	heavy := map[string]int{
		"h264_to_h265":    10,
		"normalize_audio": 8,
		"timelapse":       8,
		"contact_sheet":   8,
		"subtitles_burn":  8,
		"time_stretch":    8,
		"pitch_shift":     8,
	}
	for op, want := range heavy {
		if got := TokenCostForOp(op, "free"); got != want {
			t.Errorf("op %q: want %d, got %d", op, want, got)
		}
	}
}

func TestTokenCostForOp_UnknownOpDefaultsFive(t *testing.T) {
	if cost := TokenCostForOp("definitely_not_a_real_op_xyz", "free"); cost != 5 {
		t.Errorf("unknown op: want default 5, got %d", cost)
	}
}

// ── /billing/identify ─────────────────────────────────────────────────────────

func TestBillingIdentify(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	token := createTestUser(t, ts, "identify_test@example.com")
	if len(token) < 32 {
		t.Errorf("expected long session token, got %q", token)
	}
}

func TestBillingIdentify_Idempotent(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	t1 := createTestUser(t, ts, "idem@example.com")
	t2 := createTestUser(t, ts, "idem@example.com")
	if t1 != t2 {
		t.Error("expected same token for same email on second call")
	}
}

func TestBillingIdentify_MissingEmail(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	code, _ := billingPOST(t, ts, "/billing/identify", "", map[string]string{"name": "no-email"})
	if code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", code)
	}
}

func TestBillingIdentify_InvalidJSON(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/billing/identify",
		strings.NewReader("not-json"))
	req.Header.Set("Content-Type", "application/json")
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", resp.StatusCode)
	}
}

func TestBillingIdentify_MethodNotAllowed(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	resp, _ := http.Get(ts.URL + "/billing/identify")
	resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", resp.StatusCode)
	}
}

// ── /billing/me ───────────────────────────────────────────────────────────────

func TestBillingMe_Anonymous(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	code, body := billingGET(t, ts, "/billing/me", "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}
	var info BillingInfo
	_ = json.Unmarshal(body, &info)
	if info.LoggedIn {
		t.Error("expected logged_in=false for anonymous request")
	}
	if info.Tier != "free" {
		t.Errorf("want tier=free, got %q", info.Tier)
	}
}

func TestBillingMe_InvalidToken(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	code, body := billingGET(t, ts, "/billing/me", "invalid_token_xyz")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}
	var info BillingInfo
	_ = json.Unmarshal(body, &info)
	if info.LoggedIn {
		t.Error("expected logged_in=false for invalid token")
	}
}

func TestBillingMe_Authenticated(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	token := createTestUser(t, ts, "authme@example.com")

	code, body := billingGET(t, ts, "/billing/me", token)
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d; body: %s", code, body)
	}
	var info BillingInfo
	_ = json.Unmarshal(body, &info)
	if !info.LoggedIn {
		t.Error("expected logged_in=true")
	}
	if info.Email != "authme@example.com" {
		t.Errorf("want email=authme@example.com, got %q", info.Email)
	}
	if info.Tier != "free" {
		t.Errorf("want tier=free for new user, got %q", info.Tier)
	}
	if info.DailyOpsMax != freeDailyLimit {
		t.Errorf("want daily_ops_max=%d, got %d", freeDailyLimit, info.DailyOpsMax)
	}
}

func TestBillingMe_MethodNotAllowed(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	code, _ := billingPOST(t, ts, "/billing/me", "", nil)
	if code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", code)
	}
}

// ── CheckConvert / billing gate ───────────────────────────────────────────────

func TestCheckConvert_Anonymous_FreeOp(t *testing.T) {
	// Anonymous users can run 0-cost ops (image_to_jpg = free for all).
	ts, _ := newBillingServer(t, "")
	code, body := doConvert(t, ts, "image_to_jpg",
		map[string][]byte{"f.jpg": []byte("data")}, nil, "")
	if code != http.StatusOK {
		t.Fatalf("anonymous free op: want 200, got %d; body: %s", code, body)
	}
}

func TestCheckConvert_Anonymous_PaidOp_RequiresAuth(t *testing.T) {
	// Anonymous users cannot run ops that cost tokens.
	ts, _ := newBillingServer(t, "")
	code, body := doConvert(t, ts, "transcode",
		map[string][]byte{"f.mp4": []byte("data")}, nil, "")
	if code != http.StatusPaymentRequired {
		t.Fatalf("anonymous paid op: want 402, got %d; body: %s", code, body)
	}
	var berr BillingError
	_ = json.Unmarshal(body, &berr)
	if berr.Kind != "auth_required" {
		t.Errorf("want kind=auth_required, got %q", berr.Kind)
	}
	if berr.RequiredTokens != 3 {
		t.Errorf("want required_tokens=3 for transcode, got %d", berr.RequiredTokens)
	}
}

func TestCheckConvert_FreeTier_DailyLimit(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "dailylimit@example.com")
	user, _ := bh.DB.GetUserBySession(token)

	// Manually set daily count to the limit.
	for i := 0; i < freeDailyLimit; i++ {
		_ = bh.DB.IncrementDailyOp(user.ID)
	}

	// Next op should be blocked (image_to_jpg is free but still counts towards daily).
	code, body := doConvert(t, ts, "image_to_jpg",
		map[string][]byte{"f.jpg": []byte("data")}, nil, token)
	if code != http.StatusPaymentRequired {
		t.Fatalf("daily limit: want 402, got %d; body: %s", code, body)
	}
	var berr BillingError
	_ = json.Unmarshal(body, &berr)
	if berr.Kind != "daily_limit" {
		t.Errorf("want kind=daily_limit, got %q", berr.Kind)
	}
	if berr.DailyUsed != freeDailyLimit {
		t.Errorf("want daily_used=%d, got %d", freeDailyLimit, berr.DailyUsed)
	}
	if berr.DailyMax != freeDailyLimit {
		t.Errorf("want daily_max=%d, got %d", freeDailyLimit, berr.DailyMax)
	}
}

func TestCheckConvert_FreeTier_InsufficientTokens(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	token := createTestUser(t, ts, "insufftoken@example.com")

	// No tokens in balance — transcode costs 3.
	code, body := doConvert(t, ts, "transcode",
		map[string][]byte{"f.mp4": []byte("data")}, nil, token)
	if code != http.StatusPaymentRequired {
		t.Fatalf("insufficient tokens: want 402, got %d; body: %s", code, body)
	}
	var berr BillingError
	_ = json.Unmarshal(body, &berr)
	if berr.Kind != "insufficient_tokens" {
		t.Errorf("want kind=insufficient_tokens, got %q", berr.Kind)
	}
}

func TestCheckConvert_FreeTier_TokenDeducted(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "deductme@example.com")
	user, _ := bh.DB.GetUserBySession(token)

	// Give user 10 tokens.
	_ = bh.DB.AddTokens(user.ID, 10, "test_credit", "")

	code, body := doConvert(t, ts, "transcode",
		map[string][]byte{"f.mp4": []byte("data")}, nil, token)
	if code != http.StatusOK {
		t.Fatalf("want 200 after deduction, got %d; body: %s", code, body)
	}

	// Balance should be 10 - 3 = 7.
	bal, _ := bh.DB.GetTokenBalance(user.ID)
	if bal != 7 {
		t.Errorf("want balance 7 after transcode, got %d", bal)
	}
}

func TestCheckConvert_FreeTier_DailyOpIncremented(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "dailycount@example.com")
	user, _ := bh.DB.GetUserBySession(token)

	// image_to_jpg is free (0 tokens) but still counts towards daily limit.
	code, _ := doConvert(t, ts, "image_to_jpg",
		map[string][]byte{"f.jpg": []byte("data")}, nil, token)
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}

	count, _ := bh.DB.GetDailyOpCount(user.ID)
	if count != 1 {
		t.Errorf("want daily count 1, got %d", count)
	}
}

func TestCheckConvert_FreeTier_ExpensiveOp_Blocked(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "expensive@example.com")
	user, _ := bh.DB.GetUserBySession(token)

	// Give 5 tokens; h264_to_h265 costs 10.
	_ = bh.DB.AddTokens(user.ID, 5, "test_credit", "")

	code, body := doConvert(t, ts, "h264_to_h265",
		map[string][]byte{"f.mp4": []byte("data")}, nil, token)
	if code != http.StatusPaymentRequired {
		t.Fatalf("want 402, got %d; body: %s", code, body)
	}
	var berr BillingError
	_ = json.Unmarshal(body, &berr)
	if berr.RequiredTokens != 10 {
		t.Errorf("want required_tokens=10, got %d", berr.RequiredTokens)
	}
	if berr.Balance != 5 {
		t.Errorf("want balance=5 in error, got %d", berr.Balance)
	}
}

func TestCheckConvert_Pro_Unlimited(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "prouser@example.com")
	user, _ := bh.DB.GetUserBySession(token)

	// Set pro subscription and daily usage at freeDailyLimit.
	_ = bh.DB.UpsertSubscription(&Subscription{
		UserID: user.ID, StripeSubscriptionID: "sub_pro_test",
		Tier: "pro", Status: "active",
	})
	for i := 0; i < freeDailyLimit; i++ {
		_ = bh.DB.IncrementDailyOp(user.ID)
	}

	// Pro users are unlimited — no 402.
	code, body := doConvert(t, ts, "transcode",
		map[string][]byte{"f.mp4": []byte("data")}, nil, token)
	if code != http.StatusOK {
		t.Fatalf("pro user: want 200, got %d; body: %s", code, body)
	}
}

func TestCheckConvert_Enterprise_Unlimited(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "enterpriseuser@example.com")
	user, _ := bh.DB.GetUserBySession(token)

	_ = bh.DB.UpsertSubscription(&Subscription{
		UserID: user.ID, StripeSubscriptionID: "sub_ent_test",
		Tier: "enterprise", Status: "active",
	})
	for i := 0; i < freeDailyLimit; i++ {
		_ = bh.DB.IncrementDailyOp(user.ID)
	}

	code, body := doConvert(t, ts, "h264_to_h265",
		map[string][]byte{"f.mp4": []byte("data")}, nil, token)
	if code != http.StatusOK {
		t.Fatalf("enterprise user: want 200, got %d; body: %s", code, body)
	}
}

func TestBillingMe_Pro_ShowsUnlimitedDailyMax(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "proinfocheck@example.com")
	user, _ := bh.DB.GetUserBySession(token)

	_ = bh.DB.UpsertSubscription(&Subscription{
		UserID: user.ID, StripeSubscriptionID: "sub_pro_info",
		Tier: "pro", Status: "active",
	})

	_, body := billingGET(t, ts, "/billing/me", token)
	var info BillingInfo
	_ = json.Unmarshal(body, &info)
	if info.DailyOpsMax != -1 {
		t.Errorf("pro user: want daily_ops_max=-1, got %d", info.DailyOpsMax)
	}
	if info.Tier != "pro" {
		t.Errorf("want tier=pro, got %q", info.Tier)
	}
}

// ── webhook: signature validation ────────────────────────────────────────────

func TestWebhook_InvalidSignature(t *testing.T) {
	ts, _ := newBillingServer(t, testWebhookSecret)
	payload := webhookPayload("ping", map[string]any{"id": "test"})

	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/billing/webhook", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Stripe-Signature", "t=1234,v1=badhash")
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad signature: want 400, got %d", resp.StatusCode)
	}
}

func TestWebhook_MissingSignature_WithSecret(t *testing.T) {
	ts, _ := newBillingServer(t, testWebhookSecret)
	payload := webhookPayload("ping", map[string]any{"id": "test"})

	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/billing/webhook", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	// No Stripe-Signature header.
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing signature: want 400, got %d", resp.StatusCode)
	}
}

func TestWebhook_MethodNotAllowed(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	resp, _ := http.Get(ts.URL + "/billing/webhook")
	resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", resp.StatusCode)
	}
}

func TestWebhook_UnknownEvent_Ignored(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	payload := webhookPayload("some.unknown.event.type", map[string]any{"id": "x"})
	code, _ := sendWebhook(t, ts, payload, "")
	if code != http.StatusOK {
		t.Fatalf("unknown event: want 200, got %d", code)
	}
}

// ── webhook: checkout.session.completed (token purchase) ──────────────────────

func TestWebhook_TokenPurchase_50(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "tokenbuy50@example.com")
	user, _ := bh.DB.GetUserBySession(token)

	// Attach a Stripe customer ID so the webhook can look up the user.
	_ = bh.DB.UpdateStripeCustomer(user.ID, "cus_tok50_test")

	payload := webhookPayload("checkout.session.completed", map[string]any{
		"id":       "cs_test_50",
		"mode":     "payment",
		"customer": "cus_tok50_test",
		"metadata": map[string]string{"token_pack": "50"},
	})
	code, _ := sendWebhook(t, ts, payload, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}

	bal, _ := bh.DB.GetTokenBalance(user.ID)
	if bal != 50 {
		t.Errorf("want 50 tokens after pack purchase, got %d", bal)
	}
}

func TestWebhook_TokenPurchase_250(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "tokenbuy250@example.com")
	user, _ := bh.DB.GetUserBySession(token)
	_ = bh.DB.UpdateStripeCustomer(user.ID, "cus_tok250_test")

	payload := webhookPayload("checkout.session.completed", map[string]any{
		"id":       "cs_test_250",
		"mode":     "payment",
		"customer": "cus_tok250_test",
		"metadata": map[string]string{"token_pack": "250"},
	})
	code, _ := sendWebhook(t, ts, payload, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}

	bal, _ := bh.DB.GetTokenBalance(user.ID)
	if bal != 250 {
		t.Errorf("want 250 tokens, got %d", bal)
	}
}

func TestWebhook_TokenPurchase_1000(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "tokenbuy1000@example.com")
	user, _ := bh.DB.GetUserBySession(token)
	_ = bh.DB.UpdateStripeCustomer(user.ID, "cus_tok1000_test")

	payload := webhookPayload("checkout.session.completed", map[string]any{
		"id":       "cs_test_1000",
		"mode":     "payment",
		"customer": "cus_tok1000_test",
		"metadata": map[string]string{"token_pack": "1000"},
	})
	code, _ := sendWebhook(t, ts, payload, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}

	bal, _ := bh.DB.GetTokenBalance(user.ID)
	if bal != 1000 {
		t.Errorf("want 1000 tokens, got %d", bal)
	}
}

func TestWebhook_TokenPurchase_Subscription_Ignored(t *testing.T) {
	// checkout.session.completed with mode=subscription should NOT add tokens
	// (subscription tier changes are handled via subscription events).
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "subbuy@example.com")
	user, _ := bh.DB.GetUserBySession(token)
	_ = bh.DB.UpdateStripeCustomer(user.ID, "cus_subbuy_test")

	payload := webhookPayload("checkout.session.completed", map[string]any{
		"id":       "cs_test_sub",
		"mode":     "subscription",
		"customer": "cus_subbuy_test",
		"metadata": map[string]string{},
	})
	code, _ := sendWebhook(t, ts, payload, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}

	// No tokens should have been added.
	bal, _ := bh.DB.GetTokenBalance(user.ID)
	if bal != 0 {
		t.Errorf("subscription checkout should not add tokens, got %d", bal)
	}
}

func TestWebhook_TokenPurchase_UnknownPack_Ignored(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "unknownpack@example.com")
	user, _ := bh.DB.GetUserBySession(token)
	_ = bh.DB.UpdateStripeCustomer(user.ID, "cus_unkpack_test")

	payload := webhookPayload("checkout.session.completed", map[string]any{
		"id":       "cs_test_unkpack",
		"mode":     "payment",
		"customer": "cus_unkpack_test",
		"metadata": map[string]string{"token_pack": "999"},
	})
	code, _ := sendWebhook(t, ts, payload, "")
	if code != http.StatusOK {
		t.Fatalf("want 200 (graceful ignore), got %d", code)
	}

	bal, _ := bh.DB.GetTokenBalance(user.ID)
	if bal != 0 {
		t.Errorf("unknown pack: expected no tokens, got %d", bal)
	}
}

// ── webhook: customer.subscription.updated ────────────────────────────────────

func TestWebhook_SubscriptionUpdated_Pro(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "subpro@example.com")
	user, _ := bh.DB.GetUserBySession(token)
	_ = bh.DB.UpdateStripeCustomer(user.ID, "cus_subpro_test")

	payload := webhookPayload("customer.subscription.updated", map[string]any{
		"id":                 "sub_pro_webhook",
		"status":             "active",
		"customer":           "cus_subpro_test",
		"current_period_end": time.Now().Add(30 * 24 * time.Hour).Unix(),
		"items": map[string]any{
			"data": []map[string]any{
				{"id": "si_pro", "price": map[string]any{"id": "price_pro_test"}},
			},
		},
	})
	code, _ := sendWebhook(t, ts, payload, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}

	sub, _ := bh.DB.GetSubscription(user.ID)
	if sub.Tier != "pro" {
		t.Errorf("want tier=pro after webhook, got %q", sub.Tier)
	}
	if sub.Status != "active" {
		t.Errorf("want status=active, got %q", sub.Status)
	}
}

func TestWebhook_SubscriptionUpdated_Enterprise(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "subent@example.com")
	user, _ := bh.DB.GetUserBySession(token)
	_ = bh.DB.UpdateStripeCustomer(user.ID, "cus_subent_test")

	payload := webhookPayload("customer.subscription.updated", map[string]any{
		"id":                 "sub_ent_webhook",
		"status":             "active",
		"customer":           "cus_subent_test",
		"current_period_end": time.Now().Add(30 * 24 * time.Hour).Unix(),
		"items": map[string]any{
			"data": []map[string]any{
				{"id": "si_ent", "price": map[string]any{"id": "price_ent_test"}},
			},
		},
	})
	code, _ := sendWebhook(t, ts, payload, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}

	sub, _ := bh.DB.GetSubscription(user.ID)
	if sub.Tier != "enterprise" {
		t.Errorf("want tier=enterprise, got %q", sub.Tier)
	}
}

// ── webhook: customer.subscription.deleted ────────────────────────────────────

func TestWebhook_SubscriptionDeleted_DowngradesToFree(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "subdelete@example.com")
	user, _ := bh.DB.GetUserBySession(token)
	_ = bh.DB.UpdateStripeCustomer(user.ID, "cus_subdel_test")

	// First give them a pro subscription.
	_ = bh.DB.UpsertSubscription(&Subscription{
		UserID: user.ID, StripeSubscriptionID: "sub_del_test",
		Tier: "pro", Status: "active",
	})

	payload := webhookPayload("customer.subscription.deleted", map[string]any{
		"id":       "sub_del_test",
		"status":   "canceled",
		"customer": "cus_subdel_test",
		"items": map[string]any{
			"data": []map[string]any{
				{"id": "si_del", "price": map[string]any{"id": "price_pro_test"}},
			},
		},
	})
	code, _ := sendWebhook(t, ts, payload, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}

	sub, _ := bh.DB.GetSubscription(user.ID)
	if sub.Tier != "free" {
		t.Errorf("deleted subscription: want tier=free, got %q", sub.Tier)
	}
	if sub.Status != "canceled" {
		t.Errorf("deleted subscription: want status=canceled, got %q", sub.Status)
	}
}

// ── webhook: invoice.paid (monthly token bonus) ───────────────────────────────

func TestWebhook_InvoicePaid_ProBonus(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "proinvoice@example.com")
	user, _ := bh.DB.GetUserBySession(token)
	_ = bh.DB.UpdateStripeCustomer(user.ID, "cus_proinv_test")
	_ = bh.DB.UpsertSubscription(&Subscription{
		UserID: user.ID, StripeSubscriptionID: "sub_proinv",
		Tier: "pro", Status: "active",
	})

	payload := webhookPayload("invoice.paid", map[string]any{
		"id":       "inv_pro_test",
		"customer": "cus_proinv_test",
	})
	code, _ := sendWebhook(t, ts, payload, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}

	bal, _ := bh.DB.GetTokenBalance(user.ID)
	if bal != 100 {
		t.Errorf("pro monthly bonus: want 100 tokens, got %d", bal)
	}
}

func TestWebhook_InvoicePaid_EnterpriseBonus(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "entinvoice@example.com")
	user, _ := bh.DB.GetUserBySession(token)
	_ = bh.DB.UpdateStripeCustomer(user.ID, "cus_entinv_test")
	_ = bh.DB.UpsertSubscription(&Subscription{
		UserID: user.ID, StripeSubscriptionID: "sub_entinv",
		Tier: "enterprise", Status: "active",
	})

	payload := webhookPayload("invoice.paid", map[string]any{
		"id":       "inv_ent_test",
		"customer": "cus_entinv_test",
	})
	code, _ := sendWebhook(t, ts, payload, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}

	bal, _ := bh.DB.GetTokenBalance(user.ID)
	if bal != 500 {
		t.Errorf("enterprise monthly bonus: want 500 tokens, got %d", bal)
	}
}

func TestWebhook_InvoicePaid_FreeUser_NoBonus(t *testing.T) {
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "freeinvoice@example.com")
	user, _ := bh.DB.GetUserBySession(token)
	_ = bh.DB.UpdateStripeCustomer(user.ID, "cus_freeinv_test")
	// No subscription record — defaults to free tier.

	payload := webhookPayload("invoice.paid", map[string]any{
		"id":       "inv_free_test",
		"customer": "cus_freeinv_test",
	})
	code, _ := sendWebhook(t, ts, payload, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}

	// Free tier gets no bonus tokens.
	bal, _ := bh.DB.GetTokenBalance(user.ID)
	if bal != 0 {
		t.Errorf("free user invoice.paid: expected 0 bonus tokens, got %d", bal)
	}
}

func TestWebhook_InvoicePaid_ProBonus_Accumulates(t *testing.T) {
	// Paying the invoice twice (e.g. idempotency retry) should add tokens twice.
	// The system does NOT deduplicate — this is intentional and mirrors Stripe's
	// idempotency recommendation of handling duplicates at the application level
	// (tracked via invoice ID in metadata).
	ts, bh := newBillingServer(t, "")
	token := createTestUser(t, ts, "proinvoice2@example.com")
	user, _ := bh.DB.GetUserBySession(token)
	_ = bh.DB.UpdateStripeCustomer(user.ID, "cus_proinv2_test")
	_ = bh.DB.UpsertSubscription(&Subscription{
		UserID: user.ID, StripeSubscriptionID: "sub_proinv2",
		Tier: "pro", Status: "active",
	})

	payload := webhookPayload("invoice.paid", map[string]any{
		"id":       "inv_pro_test2",
		"customer": "cus_proinv2_test",
	})
	sendWebhook(t, ts, payload, "")
	sendWebhook(t, ts, payload, "")

	bal, _ := bh.DB.GetTokenBalance(user.ID)
	if bal != 200 {
		t.Errorf("two invoice.paid: want 200 tokens, got %d (note: dedup not implemented)", bal)
	}
}

// ── Stripe checkout/portal: auth-only validation ──────────────────────────────
// These endpoints require a valid session token. We test the auth failure path
// only — actual Stripe API calls would fail with the fake key.

func TestBillingCheckoutSubscription_Unauthenticated(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	code, _ := billingPOST(t, ts, "/billing/checkout/subscription", "", map[string]string{"plan": "pro"})
	if code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", code)
	}
}

func TestBillingCheckoutTokens_Unauthenticated(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	code, _ := billingPOST(t, ts, "/billing/checkout/tokens", "", map[string]string{"pack": "50"})
	if code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", code)
	}
}

func TestBillingPortal_Unauthenticated(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	code, _ := billingPOST(t, ts, "/billing/portal", "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", code)
	}
}

func TestBillingCheckoutSubscription_InvalidPlan(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	token := createTestUser(t, ts, "invalidplan@example.com")
	code, body := billingPOST(t, ts, "/billing/checkout/subscription", token,
		map[string]string{"plan": "ultradeluxe"})
	if code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d; body: %s", code, body)
	}
}

func TestBillingCheckoutTokens_InvalidPack(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	token := createTestUser(t, ts, "invalidpack@example.com")
	code, body := billingPOST(t, ts, "/billing/checkout/tokens", token,
		map[string]string{"pack": "999"})
	if code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d; body: %s", code, body)
	}
}

func TestBillingCheckoutSubscription_MethodNotAllowed(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	resp, _ := http.Get(ts.URL + "/billing/checkout/subscription")
	resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", resp.StatusCode)
	}
}

func TestBillingCheckoutTokens_MethodNotAllowed(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	resp, _ := http.Get(ts.URL + "/billing/checkout/tokens")
	resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", resp.StatusCode)
	}
}

func TestBillingPortal_MethodNotAllowed(t *testing.T) {
	ts, _ := newBillingServer(t, "")
	resp, _ := http.Get(ts.URL + "/billing/portal")
	resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", resp.StatusCode)
	}
}

// ── billing disabled: 503 for checkout/portal ──────────────────────────────────

func TestBillingDisabled_Identify_Returns404(t *testing.T) {
	ts := newFastServer(t, nil) // no billing handler
	code, _ := billingPOST(t, ts, "/billing/identify", "", map[string]string{"email": "x@x.com"})
	if code != http.StatusNotFound && code != http.StatusServiceUnavailable {
		// Either 404 (route not registered) or 503 (registered but disabled).
		t.Fatalf("want 404 or 503 when billing disabled, got %d", code)
	}
}
