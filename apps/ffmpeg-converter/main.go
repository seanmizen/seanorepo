package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	stripe "github.com/stripe/stripe-go/v76"
)

func main() {
	// Fail fast if ffmpeg isn't on PATH — every op shells out to it.
	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		log.Fatalf("ffmpeg not found on PATH: %v (install with `brew install ffmpeg` or equivalent)", err)
	}
	log.Printf("ffmpeg found at %s", ffmpegPath)
	if _, err := exec.LookPath("ffprobe"); err != nil {
		log.Printf("WARN: ffprobe not found — silence-detect and a few probing ops will fail")
	}

	port := getenv("PORT", "9876")
	dataDir := getenv("DATA_DIR", "./data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatalf("failed to create data dir %s: %v", dataDir, err)
	}
	abs, _ := filepath.Abs(dataDir)
	log.Printf("data dir: %s", abs)

	store := NewStore(dataDir)
	jobs := NewJobTracker()
	ops := RegisterOps()
	log.Printf("registered %d operations", len(ops))

	// Billing setup (non-fatal).
	billingCfg := loadBillingConfig()
	var bh *BillingHandler
	if billingCfg.IsEnabled() {
		stripe.Key = billingCfg.SecretKey
		dbPath := filepath.Join(dataDir, "billing.db")
		billingDB, dbErr := NewBillingDB(dbPath)
		if dbErr != nil {
			log.Printf("WARN: billing DB init failed (%v) — billing disabled", dbErr)
		} else {
			bh = &BillingHandler{DB: billingDB, Cfg: billingCfg}
			log.Printf("billing enabled (Stripe configured, DB at %s)", dbPath)
		}
	} else {
		log.Printf("billing disabled (STRIPE_SECRET_KEY not set)")
	}

	mux := http.NewServeMux()
	h := &Handler{Store: store, Jobs: jobs, Ops: ops, Billing: bh}
	mux.HandleFunc("/health", h.Health)
	mux.HandleFunc("/ops", h.ListOps)
	mux.HandleFunc("/convert", h.Convert)
	mux.HandleFunc("/jobs/", h.JobOrOutput) // /jobs/{id} or /jobs/{id}/output

	// Billing routes (always registered; handlers gracefully handle disabled state).
	if bh != nil {
		mux.HandleFunc("/billing/me", bh.Me)
		mux.HandleFunc("/billing/identify", bh.Identify)
		mux.HandleFunc("/billing/checkout/subscription", bh.CreateSubscriptionCheckout)
		mux.HandleFunc("/billing/checkout/tokens", bh.CreateTokenCheckout)
		mux.HandleFunc("/billing/portal", bh.CustomerPortal)
		mux.HandleFunc("/billing/webhook", bh.Webhook)
	} else {
		// Billing disabled: /billing/me returns minimal anonymous info.
		mux.HandleFunc("/billing/me", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusOK, BillingInfo{
				LoggedIn:    false,
				Tier:        "free",
				DailyOpsMax: -1,
			})
		})
	}

	// Config endpoint — exposes publishable key for the frontend.
	pubKey := ""
	if billingCfg != nil {
		pubKey = billingCfg.PublishableKey
	}
	mux.HandleFunc("/billing/config", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"publishable_key": pubKey})
	})

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  2 * time.Minute,
		WriteTimeout: 2 * time.Minute,
		IdleTimeout:  60 * time.Second,
	}

	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Graceful shutdown.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		log.Println("shutdown signal received")
		cancel()
		shutCtx, shutCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutCancel()
		_ = srv.Shutdown(shutCtx)
	}()

	log.Printf("ffmpeg-converter listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
