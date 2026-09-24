package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"syscall"
	"time"

	stripe "github.com/stripe/stripe-go/v76"
)

func main() {
	// `ffmpeg-converter -healthcheck` asks the running server for /health.
	// The Docker healthcheck uses it: the image has no curl.
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		os.Exit(healthcheck(getenv("PORT", "9876")))
	}

	// Fail fast if ffmpeg isn't on PATH — every op shells out to it.
	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		log.Fatalf("ffmpeg not found on PATH: %v (install with `brew install ffmpeg` or equivalent)", err)
	}
	log.Printf("ffmpeg found at %s", ffmpegPath)
	if out, err := exec.Command("ffmpeg", "-hide_banner", "-version").Output(); err == nil {
		// ffmpeg before 8 reads one tile of an iPhone photo. libheif's
		// decoder reads the whole photo (withHEIFDecode in ops.go).
		if major, minor, ok := ffmpegVersion(string(out)); ok && major < 8 && heifDecoder == "" {
			log.Printf("WARN: ffmpeg %d.%d and no heif-dec. HEIC photos come out as one tile. Install libheif-examples. The site offers HEIC to JPG and HEIC to PNG.", major, minor)
		}
	}
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

	// Remove uploads and outputs after FILE_TTL (default 1h). Running jobs
	// keep their directory, because ffmpeg writes to it and so updates it.
	ttl, err := time.ParseDuration(getenv("FILE_TTL", "1h"))
	if err != nil {
		log.Fatalf("bad FILE_TTL: %v", err)
	}
	go func() {
		for range time.Tick(ttl / 12) {
			cutoff := time.Now().Add(-ttl)
			if n := store.Sweep(cutoff, jobs.Busy); n > 0 {
				log.Printf("swept %d job dir(s) older than %s", n, ttl)
			}
			jobs.Prune(cutoff)
		}
	}()

	maxUploadMB, err := strconv.ParseInt(getenv("MAX_UPLOAD_MB", "2048"), 10, 64)
	if err != nil {
		log.Fatalf("bad MAX_UPLOAD_MB: %v", err)
	}

	// Each chunk is one request through Cloudflare, which refuses a body
	// over 100 MB on the Free plan.
	chunkBytes, err := strconv.ParseInt(getenv("UPLOAD_CHUNK_BYTES", strconv.Itoa(DefaultChunkBytes)), 10, 64)
	if err != nil || chunkBytes < 1 {
		log.Fatalf("bad UPLOAD_CHUNK_BYTES: %q", getenv("UPLOAD_CHUNK_BYTES", ""))
	}

	maxJobs, err := strconv.Atoi(getenv("MAX_JOBS", "2"))
	if err != nil || maxJobs < 1 {
		log.Fatalf("bad MAX_JOBS: %q", getenv("MAX_JOBS", "2"))
	}

	mux := http.NewServeMux()
	h := &Handler{
		Store: store, Jobs: jobs, Ops: ops, Billing: bh,
		MaxUploadBytes: maxUploadMB << 20,
		ChunkBytes:     chunkBytes,
		slots:          make(chan struct{}, maxJobs),
	}
	mux.HandleFunc("/health", h.Health)
	mux.HandleFunc("/ops", h.ListOps)
	mux.HandleFunc("/convert", h.Convert)
	mux.HandleFunc("/uploads", h.Uploads)   // POST: start a chunked upload
	mux.HandleFunc("/uploads/", h.Uploads)  // PUT /uploads/{id}/{n}: one chunk
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
		Addr:    ":" + port,
		Handler: withAPIPrefix(mux),
		// Large uploads on a slow connection take many minutes. Async jobs
		// answer fast, but a synchronous /convert or a large download can not.
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Minute,
		WriteTimeout:      30 * time.Minute,
		IdleTimeout:       60 * time.Second,
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

// ffmpegVersion reads the version from `ffmpeg -version` output, for example
// "ffmpeg version 7.0.2-static" or "ffmpeg version n8.1.3-20260923".
// Builds from git ("N-12345-g...") return ok=false.
func ffmpegVersion(out string) (major, minor int, ok bool) {
	m := regexp.MustCompile(`^ffmpeg version n?(\d+)\.(\d+)`).FindStringSubmatch(out)
	if m == nil {
		return 0, 0, false
	}
	major, _ = strconv.Atoi(m[1])
	minor, _ = strconv.Atoi(m[2])
	return major, minor, true
}

// withAPIPrefix serves every route twice: at /convert and at /api/convert.
// Backend routes use /api (CLAUDE.md), and the tunnel sends
// seansconverter.com/api/* here. The bare paths stay for the test suite.
func withAPIPrefix(mux http.Handler) http.Handler {
	root := http.NewServeMux()
	root.Handle("/api/", http.StripPrefix("/api", mux))
	root.Handle("/", mux)
	return root
}

func healthcheck(port string) int {
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/health")
	if err != nil {
		return 1
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
