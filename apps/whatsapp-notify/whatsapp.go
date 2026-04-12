package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	rs "github.com/seanmizen/relay-shared"
)

const metaAPIBase = "https://graph.facebook.com/v20.0"

// WhatsAppClient sends messages via the Meta WhatsApp Cloud API.
// If any of phoneID, token, or toNumber are empty the client boots in dry-run
// mode: it logs what it would send and returns a synthetic message ID without
// making any outbound HTTP call.
type WhatsAppClient struct {
	phoneID  string
	token    string
	toNumber string
	dryRun   bool
	http     *http.Client
}

// NewWhatsAppClient constructs a client. Missing env vars trigger dry-run mode.
func NewWhatsAppClient(phoneID, token, toNumber string) *WhatsAppClient {
	dryRun := phoneID == "" || token == "" || toNumber == ""
	if dryRun {
		log.Println("[whatsapp] DRY RUN — META_PHONE_ID, META_TOKEN, or META_TO_NUMBER not set; messages will be logged, not sent")
	}
	return &WhatsAppClient{
		phoneID:  phoneID,
		token:    token,
		toNumber: toNumber,
		dryRun:   dryRun,
		http:     &http.Client{},
	}
}

// metaPayload is the request body for the Meta Cloud API messages endpoint.
type metaPayload struct {
	MessagingProduct string   `json:"messaging_product"`
	To               string   `json:"to"`
	Type             string   `json:"type"`
	Text             metaText `json:"text"`
}

type metaText struct {
	Body string `json:"body"`
}

// metaResponse is the success body from the Meta API.
type metaResponse struct {
	Messages []struct {
		ID string `json:"id"`
	} `json:"messages"`
}

// Send dispatches a notification. Returns the Meta message ID on success.
// In dry-run mode it logs and returns "dry-run-id" without making any network call.
func (c *WhatsAppClient) Send(req rs.NotifyRequest) (string, error) {
	body := buildBody(req)

	if c.dryRun {
		log.Printf("[whatsapp] DRY RUN — would send to %s: %q", c.toNumber, body)
		return "dry-run-id", nil
	}

	payload := metaPayload{
		MessagingProduct: "whatsapp",
		To:               c.toNumber,
		Type:             "text",
		Text:             metaText{Body: body},
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal payload: %w", err)
	}

	url := fmt.Sprintf("%s/%s/messages", metaAPIBase, c.phoneID)
	httpReq, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("send to Meta API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("Meta API returned HTTP %d", resp.StatusCode)
	}

	var mr metaResponse
	if err := json.NewDecoder(resp.Body).Decode(&mr); err != nil {
		return "", fmt.Errorf("decode Meta API response: %w", err)
	}
	if len(mr.Messages) == 0 {
		return "", fmt.Errorf("Meta API returned no message IDs")
	}
	return mr.Messages[0].ID, nil
}

// buildBody assembles the WhatsApp text from the notify request fields.
// Title (if any) is prepended on its own line. High-priority messages get a
// trailing "[!] HIGH PRIORITY" suffix.
func buildBody(req rs.NotifyRequest) string {
	var b strings.Builder
	if req.Title != "" {
		b.WriteString(req.Title)
		b.WriteString("\n")
	}
	b.WriteString(req.Message)
	if req.Priority >= 4 {
		b.WriteString("\n[!] HIGH PRIORITY")
	}
	return b.String()
}
