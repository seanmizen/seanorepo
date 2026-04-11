package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// TempStore manages temporary files with automatic TTL-based cleanup.
type TempStore struct {
	dir    string
	maxAge time.Duration
	mu     sync.Mutex
	files  map[string]time.Time // path → created-at
}

func NewTempStore(dir string, maxAge time.Duration) *TempStore {
	return &TempStore{
		dir:    dir,
		maxAge: maxAge,
		files:  make(map[string]time.Time),
	}
}

// NewFile creates an empty temp file with the given extension and returns its absolute path.
// The caller is responsible for writing to it.
func (s *TempStore) NewFile(ext string) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("rand: %w", err)
	}
	path := filepath.Join(s.dir, hex.EncodeToString(b)+ext)

	f, err := os.Create(path)
	if err != nil {
		return "", fmt.Errorf("create: %w", err)
	}
	f.Close()

	s.mu.Lock()
	s.files[path] = time.Now()
	s.mu.Unlock()

	return path, nil
}

// Delete removes a temp file from disk and the registry.
func (s *TempStore) Delete(path string) error {
	s.mu.Lock()
	delete(s.files, path)
	s.mu.Unlock()
	err := os.Remove(path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

// StartCleanup starts a background goroutine that sweeps expired files at the given interval.
func (s *TempStore) StartCleanup(ctx context.Context, interval time.Duration) {
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.sweep()
			}
		}
	}()
}

func (s *TempStore) sweep() {
	cutoff := time.Now().Add(-s.maxAge)

	s.mu.Lock()
	var expired []string
	for path, created := range s.files {
		if created.Before(cutoff) {
			expired = append(expired, path)
			delete(s.files, path)
		}
	}
	s.mu.Unlock()

	for _, path := range expired {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			log.Printf("tempstore sweep: remove %s: %v", path, err)
		}
	}
	if len(expired) > 0 {
		log.Printf("tempstore sweep: removed %d expired files", len(expired))
	}
}
