package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/seanmizen/converter/internal/api"
	"github.com/seanmizen/converter/internal/converter"
	"github.com/seanmizen/converter/internal/job"
	"github.com/seanmizen/converter/internal/storage"
)

func main() {
	port := getenv("PORT", "4041")
	numWorkers := getenvInt("WORKERS", 4)
	tempDir := getenv("TEMP_DIR", os.TempDir())
	maxUploadMB := getenvInt64("MAX_UPLOAD_MB", 500)
	fileTTL := getenvDuration("FILE_TTL", 1*time.Hour)

	log.Printf("converter starting: port=%s workers=%d tempDir=%s maxUploadMB=%d",
		port, numWorkers, tempDir, maxUploadMB)

	store := storage.NewTempStore(tempDir, fileTTL)
	queue := job.NewQueue(256)

	registry := converter.NewRegistry()
	registry.Register(converter.NewFFmpegConverter())
	// Add more converters here: registry.Register(converter.NewImageMagickConverter())

	pool := job.NewWorkerPool(queue, registry, store, numWorkers)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool.Start(ctx)
	store.StartCleanup(ctx, 15*time.Minute)

	h := api.NewHandler(queue, store, registry, maxUploadMB*1024*1024)
	router := api.NewRouter(h)

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      router,
		ReadTimeout:  30 * time.Minute, // allow slow uploads
		WriteTimeout: 30 * time.Minute, // allow slow downloads
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown on SIGINT/SIGTERM.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		log.Println("shutting down...")
		cancel()
		shutCtx, shutCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutCancel()
		_ = srv.Shutdown(shutCtx)
	}()

	log.Printf("listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getenvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func getenvInt64(key string, fallback int64) int64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return fallback
}

func getenvDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
