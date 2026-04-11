package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	rs "github.com/seanmizen/relay-shared"
)

// longInterval prevents rate limiting from interfering with handler tests.
const longInterval = 24 * time.Hour

func newDryRunHandler() *Handler {
	auth := NewAuthenticator("test-secret", longInterval)
	wa := NewWhatsAppClient("", "", "") // empty vars → dry run
	return NewHandler(auth, wa)
}

func post(h *Handler, body []byte, sig string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/notify", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if sig != "" {
		req.Header.Set("X-Notify-Signature", sig)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func TestHandler_OK(t *testing.T) {
	h := newDryRunHandler()
	body, _ := json.Marshal(rs.NotifyRequest{Message: "task done"})
	rr := post(h, body, testSign(body, "test-secret"))

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp rs.NotifyResponse
	json.NewDecoder(rr.Body).Decode(&resp)
	if !resp.OK {
		t.Fatal("expected ok=true")
	}
	if resp.ID == "" {
		t.Fatal("expected non-empty ID")
	}
}

func TestHandler_MissingSignature(t *testing.T) {
	h := newDryRunHandler()
	body, _ := json.Marshal(rs.NotifyRequest{Message: "x"})
	rr := post(h, body, "")
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestHandler_BadSignature(t *testing.T) {
	h := newDryRunHandler()
	body, _ := json.Marshal(rs.NotifyRequest{Message: "x"})
	rr := post(h, body, "sha256=deadbeef")
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestHandler_EmptyMessage(t *testing.T) {
	h := newDryRunHandler()
	body, _ := json.Marshal(rs.NotifyRequest{Message: ""})
	rr := post(h, body, testSign(body, "test-secret"))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

func TestHandler_InvalidJSON(t *testing.T) {
	h := newDryRunHandler()
	body := []byte(`not-json`)
	rr := post(h, body, testSign(body, "test-secret"))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

func TestHandler_RateLimit(t *testing.T) {
	auth := NewAuthenticator("test-secret", longInterval) // long interval
	wa := NewWhatsAppClient("", "", "")
	h := NewHandler(auth, wa)

	send := func() int {
		body, _ := json.Marshal(rs.NotifyRequest{Message: "hi"})
		return post(h, body, testSign(body, "test-secret")).Code
	}

	if code := send(); code != http.StatusOK {
		t.Fatalf("first request should succeed, got %d", code)
	}
	if code := send(); code != http.StatusTooManyRequests {
		t.Fatalf("second request should be rate-limited, got %d", code)
	}
}

func TestHandler_NotFound(t *testing.T) {
	h := newDryRunHandler()
	req := httptest.NewRequest(http.MethodGet, "/unknown", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rr.Code)
	}
}

func TestHandler_WrongMethod(t *testing.T) {
	h := newDryRunHandler()
	req := httptest.NewRequest(http.MethodGet, "/notify", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for GET /notify, got %d", rr.Code)
	}
}

func TestHandler_WithPriorityAndTitle(t *testing.T) {
	h := newDryRunHandler()
	body, _ := json.Marshal(rs.NotifyRequest{
		Message:  "all tests passed",
		Title:    "Build: seanmizen.com",
		Priority: rs.PriorityHigh,
		Tags:     []string{"build", "ci"},
	})
	rr := post(h, body, testSign(body, "test-secret"))
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}
