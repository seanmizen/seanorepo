package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"
)

func testSign(body []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func TestValidateSignature_Valid(t *testing.T) {
	a := NewAuthenticator("test-secret", 5*time.Second)
	body := []byte(`{"message":"hello"}`)
	if !a.ValidateSignature(body, testSign(body, "test-secret")) {
		t.Fatal("valid signature should pass")
	}
}

func TestValidateSignature_WrongSecret(t *testing.T) {
	a := NewAuthenticator("test-secret", 5*time.Second)
	body := []byte(`{"message":"hello"}`)
	if a.ValidateSignature(body, testSign(body, "wrong-secret")) {
		t.Fatal("wrong secret should fail")
	}
}

func TestValidateSignature_TamperedBody(t *testing.T) {
	a := NewAuthenticator("test-secret", 5*time.Second)
	body := []byte(`{"message":"hello"}`)
	sig := testSign(body, "test-secret")
	tampered := []byte(`{"message":"evil"}`)
	if a.ValidateSignature(tampered, sig) {
		t.Fatal("tampered body should fail")
	}
}

func TestValidateSignature_MissingPrefix(t *testing.T) {
	a := NewAuthenticator("test-secret", 5*time.Second)
	body := []byte(`{"message":"hello"}`)
	mac := hmac.New(sha256.New, []byte("test-secret"))
	mac.Write(body)
	// Raw hex without the "sha256=" prefix.
	raw := hex.EncodeToString(mac.Sum(nil))
	if a.ValidateSignature(body, raw) {
		t.Fatal("missing sha256= prefix should fail")
	}
}

func TestValidateSignature_EmptySig(t *testing.T) {
	a := NewAuthenticator("test-secret", 5*time.Second)
	if a.ValidateSignature([]byte("body"), "") {
		t.Fatal("empty signature should fail")
	}
}

func TestRateLimit_FirstAllowed(t *testing.T) {
	a := NewAuthenticator("s", 100*time.Millisecond)
	if !a.AllowRequest() {
		t.Fatal("first request should be allowed")
	}
}

func TestRateLimit_SecondDenied(t *testing.T) {
	a := NewAuthenticator("s", 100*time.Millisecond)
	a.AllowRequest()
	if a.AllowRequest() {
		t.Fatal("second request within interval should be denied")
	}
}

func TestRateLimit_AllowedAfterInterval(t *testing.T) {
	a := NewAuthenticator("s", 50*time.Millisecond)
	a.AllowRequest()
	time.Sleep(60 * time.Millisecond)
	if !a.AllowRequest() {
		t.Fatal("request after interval should be allowed")
	}
}
