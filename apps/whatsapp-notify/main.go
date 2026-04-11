package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	secret := os.Getenv("NOTIFY_SECRET")
	if secret == "" {
		log.Fatal("NOTIFY_SECRET env var is required")
	}

	phoneID := os.Getenv("META_PHONE_ID")
	token := os.Getenv("META_TOKEN")
	toNumber := os.Getenv("META_TO_NUMBER")
	port := getenv("PORT", "8765")

	auth := NewAuthenticator(secret, 5*time.Second)
	wa := NewWhatsAppClient(phoneID, token, toNumber)
	h := NewHandler(auth, wa)

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      h,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		log.Println("shutting down...")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	log.Printf("whatsapp-notify listening on :%s (dryRun=%v)", port, wa.dryRun)
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
