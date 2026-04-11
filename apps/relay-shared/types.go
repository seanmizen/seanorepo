// Package relayshared defines the shared request/response types used by all
// notify relay servers (ntfy, WhatsApp, etc.).
//
// Wire shape for POST /notify:
//
//	{
//	    "message":  "something happened",   // required
//	    "title":    "Alert",                 // optional
//	    "priority": 4,                       // 1–5, ntfy scale (0 = default=3)
//	    "tags":     ["warning", "tada"]      // emoji shortcodes
//	}
//
// Priority mapping across backends:
//
//	1 = min    (ntfy: silent, below fold)
//	2 = low    (ntfy: silent, collapsed)
//	3 = default (ntfy: standard vibration)
//	4 = high   (ntfy: long vibration + pop-over)
//	5 = urgent (ntfy: sustained vibration + pop-over)
package relayshared

// NotifyRequest is the body accepted by every relay's POST /notify endpoint.
type NotifyRequest struct {
	// Message is the notification body. Required.
	Message string `json:"message"`
	// Title overrides the notification title. Optional.
	Title string `json:"title,omitempty"`
	// Priority is 1–5 (ntfy scale). 0 means use the backend default (3).
	Priority int `json:"priority,omitempty"`
	// Tags are emoji shortcodes forwarded verbatim to the backend
	// (e.g. ["warning", "tada", "skull"]).
	Tags []string `json:"tags,omitempty"`
}

// NotifyResponse is returned on success.
type NotifyResponse struct {
	OK bool `json:"ok"`
}
