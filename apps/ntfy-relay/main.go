package main

import (
	"log"
	"net/http"
	"os"
)

func main() {
	ntfyURL := os.Getenv("NTFY_URL")
	dryRun := ntfyURL == "" || os.Getenv("DRY_RUN") == "1"
	if ntfyURL == "" {
		ntfyURL = "https://ntfy.sh/placeholder-topic"
		log.Println("NTFY_URL not set — running in dry-run mode (no messages will be sent)")
	}

	secret := os.Getenv("NOTIFY_SECRET")
	if secret == "" {
		log.Println("WARNING: NOTIFY_SECRET not set — signature verification disabled")
	}

	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8080"
	}

	h := newHandler(ntfyURL, secret, dryRun)

	mux := http.NewServeMux()
	mux.Handle("POST /notify", h)

	log.Printf("ntfy-relay listening on %s → %s (dry_run=%v sig_check=%v)",
		addr, ntfyURL, dryRun, secret != "")
	log.Fatal(http.ListenAndServe(addr, mux))
}
