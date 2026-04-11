package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	relayshared "relay-shared"
)

const rateWindow = 5 * time.Second

type ntfyHandler struct {
	ntfyURL string
	secret  []byte
	dryRun  bool
	client  *http.Client

	mu      sync.Mutex
	lastReq time.Time
}

func newHandler(ntfyURL, secret string, dryRun bool) *ntfyHandler {
	return &ntfyHandler{
		ntfyURL: ntfyURL,
		secret:  []byte(secret),
		dryRun:  dryRun,
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

func (h *ntfyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}

	// HMAC signature check — skip only if no secret is configured.
	if len(h.secret) > 0 {
		if !h.checkSig(body, r.Header.Get("X-Notify-Signature")) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
	}

	// 1 request per 5 s global rate limit.
	h.mu.Lock()
	if !h.lastReq.IsZero() && time.Since(h.lastReq) < rateWindow {
		h.mu.Unlock()
		http.Error(w, "rate limited", http.StatusTooManyRequests)
		return
	}
	h.lastReq = time.Now()
	h.mu.Unlock()

	var req relayshared.NotifyRequest
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	if err := h.send(req); err != nil {
		log.Printf("ntfy send error: %v", err)
		http.Error(w, "upstream error", http.StatusBadGateway)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *ntfyHandler) checkSig(body []byte, got string) bool {
	want := "sha256=" + hmacHex(h.secret, body)
	return hmac.Equal([]byte(got), []byte(want))
}

func hmacHex(key, data []byte) string {
	m := hmac.New(sha256.New, key)
	m.Write(data)
	return hex.EncodeToString(m.Sum(nil))
}

func (h *ntfyHandler) send(req relayshared.NotifyRequest) error {
	if h.dryRun {
		log.Printf("[dry-run] ntfy POST → %s | title=%q priority=%d tags=%v msg=%q",
			h.ntfyURL, req.Title, req.Priority, req.Tags, req.Message)
		return nil
	}

	httpReq, err := http.NewRequest(http.MethodPost, h.ntfyURL, strings.NewReader(req.Message))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "text/plain")

	if req.Title != "" {
		httpReq.Header.Set("Title", req.Title)
	}
	if req.Priority >= 1 && req.Priority <= 5 {
		httpReq.Header.Set("Priority", fmt.Sprintf("%d", req.Priority))
	}
	if len(req.Tags) > 0 {
		httpReq.Header.Set("Tags", strings.Join(req.Tags, ","))
	}

	resp, err := h.client.Do(httpReq)
	if err != nil {
		return fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("ntfy returned %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return nil
}
