// Package relayshared defines the shared request/response types used by the
// ntfy and whatsapp-notify relay servers. Both servers expose an identical
// POST /notify schema so that Claude skills can call either one with the same
// payload. Keep this file in sync with any schema changes.
package relayshared

// Priority represents the urgency of a notification.
type Priority string

const (
	PriorityLow    Priority = "low"
	PriorityNormal Priority = "normal"
	PriorityHigh   Priority = "high"
)

// NotifyRequest is the inbound schema for POST /notify on both relay servers.
type NotifyRequest struct {
	Message  string   `json:"message"`
	Title    string   `json:"title,omitempty"`
	Priority Priority `json:"priority,omitempty"`
	Tags     []string `json:"tags,omitempty"`
}

// NotifyResponse is returned on success.
type NotifyResponse struct {
	OK bool   `json:"ok"`
	ID string `json:"id"`
}

// ErrorResponse is returned on any 4xx/5xx.
type ErrorResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}
