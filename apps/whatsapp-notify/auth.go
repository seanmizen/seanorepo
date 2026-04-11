package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

// Authenticator validates HMAC signatures and enforces a per-secret rate limit.
// The rate limit is a simple sliding window: one request per interval.
type Authenticator struct {
	secret   string
	interval time.Duration
	mu       sync.Mutex
	lastReq  time.Time
}

// NewAuthenticator creates an Authenticator with the given secret and request interval.
func NewAuthenticator(secret string, interval time.Duration) *Authenticator {
	return &Authenticator{
		secret:   secret,
		interval: interval,
	}
}

// ValidateSignature checks an X-Notify-Signature header value against the body.
// The expected header format is "sha256=<lowercase-hex>".
// Uses constant-time comparison to prevent timing attacks.
func (a *Authenticator) ValidateSignature(body []byte, sig string) bool {
	if !strings.HasPrefix(sig, "sha256=") {
		return false
	}
	provided := strings.TrimPrefix(sig, "sha256=")
	mac := hmac.New(sha256.New, []byte(a.secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(provided), []byte(expected))
}

// AllowRequest returns true if the caller is within the rate limit.
// One allowed request resets the window.
func (a *Authenticator) AllowRequest() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	if !a.lastReq.IsZero() && now.Sub(a.lastReq) < a.interval {
		return false
	}
	a.lastReq = now
	return true
}
