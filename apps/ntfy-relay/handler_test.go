package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	relayshared "relay-shared"
)

const testSecret = "test-secret"

// sign produces the X-Notify-Signature value for a given body.
func sign(secret string, body []byte) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(body)
	return "sha256=" + hex.EncodeToString(m.Sum(nil))
}

// post fires a signed POST /notify against h and returns the recorder.
func post(t *testing.T, h *ntfyHandler, req relayshared.NotifyRequest, secret string) *httptest.ResponseRecorder {
	t.Helper()
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "/notify", bytes.NewReader(b))
	if secret != "" {
		r.Header.Set("X-Notify-Signature", sign(secret, b))
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

// freshDry returns a dry-run handler with its rate-limit clock reset.
func freshDry() *ntfyHandler {
	h := newHandler("https://ntfy.sh/test-topic", testSecret, true)
	h.lastReq = time.Time{} // zero = no prior request
	return h
}

// ── tests ──────────────────────────────────────────────────────────────────

// 1. Happy path — default priority message returns 204.
func TestSendDefault(t *testing.T) {
	h := freshDry()
	w := post(t, h, relayshared.NotifyRequest{
		Message:  "hello world",
		Title:    "Test",
		Priority: 3,
		Tags:     []string{"tada"},
	}, testSecret)
	if w.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d: %s", w.Code, w.Body.String())
	}
}

// 2. Wrong secret → 403.
func TestBadSignature(t *testing.T) {
	h := freshDry()
	w := post(t, h, relayshared.NotifyRequest{Message: "hi"}, "wrong-secret")
	if w.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", w.Code)
	}
}

// 3. Missing signature header (secret configured) → 403.
func TestMissingSignature(t *testing.T) {
	h := freshDry()
	b, _ := json.Marshal(relayshared.NotifyRequest{Message: "hi"})
	r := httptest.NewRequest(http.MethodPost, "/notify", bytes.NewReader(b))
	// intentionally no X-Notify-Signature header
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", w.Code)
	}
}

// 4. Rate limit: second request within 5 s → 429.
func TestRateLimit(t *testing.T) {
	h := freshDry()

	w1 := post(t, h, relayshared.NotifyRequest{Message: "first"}, testSecret)
	if w1.Code != http.StatusNoContent {
		t.Fatalf("first: want 204, got %d", w1.Code)
	}

	w2 := post(t, h, relayshared.NotifyRequest{Message: "second"}, testSecret)
	if w2.Code != http.StatusTooManyRequests {
		t.Fatalf("second: want 429, got %d", w2.Code)
	}
}

// 5. Headers forwarded to ntfy — Title, Priority, Tags all arrive correctly.
func TestHeaderForwarding(t *testing.T) {
	var received *http.Request
	var receivedBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = r
		receivedBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	h := newHandler(srv.URL, testSecret, false) // live mode
	w := post(t, h, relayshared.NotifyRequest{
		Message:  "real send",
		Title:    "Urgent Alert",
		Priority: 5,
		Tags:     []string{"warning", "skull"},
	}, testSecret)

	if w.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d: %s", w.Code, w.Body.String())
	}
	if received == nil {
		t.Fatal("fake ntfy server never received a request")
	}
	if got := received.Header.Get("Title"); got != "Urgent Alert" {
		t.Errorf("Title: got %q, want %q", got, "Urgent Alert")
	}
	if got := received.Header.Get("Priority"); got != "5" {
		t.Errorf("Priority: got %q, want %q", got, "5")
	}
	if got := received.Header.Get("Tags"); got != "warning,skull" {
		t.Errorf("Tags: got %q, want %q", got, "warning,skull")
	}
	if string(receivedBody) != "real send" {
		t.Errorf("Body: got %q, want %q", string(receivedBody), "real send")
	}
}

// 6. Invalid JSON body → 400.
func TestInvalidJSON(t *testing.T) {
	h := freshDry()
	body := []byte(`not json at all`)
	r := httptest.NewRequest(http.MethodPost, "/notify", bytes.NewReader(body))
	r.Header.Set("X-Notify-Signature", sign(testSecret, body))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

// 7. No secret configured — signature check is skipped entirely.
func TestNoSecretSkipsCheck(t *testing.T) {
	h := newHandler("https://ntfy.sh/test-topic", "", true)
	h.lastReq = time.Time{}
	// post with wrong signature — should still pass because no secret is set
	w := post(t, h, relayshared.NotifyRequest{Message: "unsecured"}, "irrelevant")
	if w.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", w.Code)
	}
}

// 8. Priority out of range (0 and 6) — header should be omitted, not "0" or "6".
func TestPriorityOutOfRange(t *testing.T) {
	var received *http.Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = r
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	for _, p := range []int{0, 6} {
		h := newHandler(srv.URL, testSecret, false)
		post(t, h, relayshared.NotifyRequest{Message: "test", Priority: p}, testSecret)
		if got := received.Header.Get("Priority"); got != "" {
			t.Errorf("priority %d: want no Priority header, got %q", p, got)
		}
	}
}
