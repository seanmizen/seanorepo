package main

import (
	"crypto/rand"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
)

// Store holds uploaded inputs and produced outputs on disk.
// Everything lives under DataDir — no DB, no persistence guarantees.
type Store struct {
	DataDir string
}

func NewStore(dataDir string) *Store {
	return &Store{DataDir: dataDir}
}

func (s *Store) jobDir(jobID string) string {
	return filepath.Join(s.DataDir, jobID)
}

// PrepareJobDir creates a fresh directory for a job.
func (s *Store) PrepareJobDir(jobID string) (string, error) {
	dir := s.jobDir(jobID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// SaveUpload copies an uploaded reader to disk under the job dir.
// Returns the on-disk path.
func (s *Store) SaveUpload(jobID, name string, r io.Reader) (string, error) {
	dir, err := s.PrepareJobDir(jobID)
	if err != nil {
		return "", err
	}
	p := filepath.Join(dir, "in_"+sanitize(name))
	f, err := os.Create(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := io.Copy(f, r); err != nil {
		return "", err
	}
	return p, nil
}

// OutputPath returns where a job's output should be written.
// ext should include the leading dot, e.g. ".mp4".
func (s *Store) OutputPath(jobID, ext string) string {
	return filepath.Join(s.jobDir(jobID), "out"+ext)
}

// randomID returns a short hex id. Not cryptographic — just uniqueness.
func randomID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func sanitize(name string) string {
	// Drop any path components. FFmpeg doesn't care about the original name
	// but we don't want "../etc/passwd" shenanigans.
	return filepath.Base(name)
}
