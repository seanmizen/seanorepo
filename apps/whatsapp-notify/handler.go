package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"

	rs "github.com/seanmizen/relay-shared"
)

const maxBodyBytes = 64 * 1024 // 64 KB — a notification should never be larger

// Handler handles POST /notify requests.
type Handler struct {
	auth *Authenticator
	wa   *WhatsAppClient
}

// NewHandler wires up the HTTP handler.
func NewHandler(auth *Authenticator, wa *WhatsAppClient) *Handler {
	return &Handler{auth: auth, wa: wa}
}

// ServeHTTP routes requests. Only POST /notify is accepted; everything else is 404.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost && r.URL.Path == "/notify" {
		h.handleNotify(w, r)
		return
	}
	writeError(w, http.StatusNotFound, "not found")
}

func (h *Handler) handleNotify(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, "cannot read body")
		return
	}

	sig := r.Header.Get("X-Notify-Signature")
	if sig == "" {
		writeError(w, http.StatusUnauthorized, "missing X-Notify-Signature header")
		return
	}
	if !h.auth.ValidateSignature(body, sig) {
		writeError(w, http.StatusUnauthorized, "invalid signature")
		return
	}

	if !h.auth.AllowRequest() {
		writeError(w, http.StatusTooManyRequests, "rate limit exceeded — wait 5 seconds")
		return
	}

	var req rs.NotifyRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Message == "" {
		writeError(w, http.StatusBadRequest, "message is required")
		return
	}

	id, err := h.wa.Send(req)
	if err != nil {
		log.Printf("[handler] WhatsApp send failed: %v", err)
		writeError(w, http.StatusServiceUnavailable, "failed to send message")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rs.NotifyResponse{OK: true, ID: id})
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(rs.ErrorResponse{OK: false, Error: msg})
}
