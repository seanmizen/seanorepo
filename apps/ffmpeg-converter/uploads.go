package main

// Chunked uploads. Cloudflare rejects a proxied request body over 100 MB
// (Free plan), so the site sends a large file as several smaller requests:
//
//	POST /uploads            -> {"upload_id": "...", "chunk_size": 33554432}
//	PUT  /uploads/{id}/{n}   -> stores chunk n (0-based). A repeat replaces it,
//	                            so a client can retry a failed chunk.
//	POST /convert            with upload_id, chunks=N and filename, instead
//	                            of a multipart file: joins chunks 0..N-1.
//
// An upload lives in DATA_DIR/up-<id>/. Each chunk write changes the
// directory, so the one-hour sweep removes only abandoned uploads.

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// DefaultChunkBytes stays well under Cloudflare's 100 MB request limit.
const DefaultChunkBytes = 32 << 20

// maxChunks bounds the chunk index, so a client cannot create files without
// limit. 10000 chunks of the smallest sensible size is still far over 2 GB.
const maxChunks = 10000

var uploadIDPattern = regexp.MustCompile(`^[0-9a-f]{16}$`)

// uploadError carries the HTTP status for an upload problem.
type uploadError struct {
	status int
	msg    string
}

func (e *uploadError) Error() string { return e.msg }

func (s *Store) uploadDir(id string) string {
	return filepath.Join(s.DataDir, "up-"+id)
}

// NewUpload creates an empty upload and returns its ID.
func (s *Store) NewUpload() (string, error) {
	id := randomID()
	if err := os.MkdirAll(s.uploadDir(id), 0o755); err != nil {
		return "", err
	}
	return id, nil
}

// PutChunk stores chunk n of an upload. It writes to a temp file first, so a
// broken request never leaves half a chunk behind.
func (s *Store) PutChunk(id string, n int, r io.Reader, maxTotal int64) error {
	dir := s.uploadDir(id)
	if !uploadIDPattern.MatchString(id) {
		return &uploadError{http.StatusBadRequest, "bad upload id"}
	}
	if _, err := os.Stat(dir); err != nil {
		return &uploadError{http.StatusNotFound, "unknown upload"}
	}
	if n < 0 || n >= maxChunks {
		return &uploadError{http.StatusBadRequest, fmt.Sprintf("chunk index must be 0 to %d", maxChunks-1)}
	}
	tmp, err := os.CreateTemp(dir, "tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	_, err = io.Copy(tmp, r)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return &uploadError{http.StatusRequestEntityTooLarge,
				fmt.Sprintf("chunk too large: the limit is %d bytes", tooBig.Limit)}
		}
		return err
	}
	if err := os.Rename(tmp.Name(), chunkPath(dir, n)); err != nil {
		return err
	}
	// Refuse the chunk that takes the upload over the limit, so a client
	// learns early and does not upload the rest.
	if total, err := uploadSize(dir); err == nil && maxTotal > 0 && total > maxTotal {
		_ = os.Remove(chunkPath(dir, n))
		return &uploadError{http.StatusRequestEntityTooLarge,
			fmt.Sprintf("file too large: the limit is %d MB", maxTotal>>20)}
	}
	return nil
}

// Assemble joins chunks 0..chunks-1 of an upload into the job's input file,
// then removes the upload. It returns the input path.
func (s *Store) Assemble(id string, chunks int, name, jobID string, maxTotal int64) (string, error) {
	dir := s.uploadDir(id)
	if !uploadIDPattern.MatchString(id) {
		return "", &uploadError{http.StatusBadRequest, "bad upload id"}
	}
	if _, err := os.Stat(dir); err != nil {
		return "", &uploadError{http.StatusNotFound, "unknown upload: it expired, or it was already used"}
	}
	if chunks < 1 || chunks > maxChunks {
		return "", &uploadError{http.StatusBadRequest, "chunks must be 1 or more"}
	}
	var total int64
	for n := 0; n < chunks; n++ {
		info, err := os.Stat(chunkPath(dir, n))
		if err != nil {
			return "", &uploadError{http.StatusBadRequest, fmt.Sprintf("chunk %d is missing", n)}
		}
		total += info.Size()
	}
	if maxTotal > 0 && total > maxTotal {
		return "", &uploadError{http.StatusRequestEntityTooLarge,
			fmt.Sprintf("file too large: the limit is %d MB", maxTotal>>20)}
	}
	if name == "" {
		name = "upload"
	}

	jobDir, err := s.PrepareJobDir(jobID)
	if err != nil {
		return "", err
	}
	path := filepath.Join(jobDir, "in_"+sanitize(name))
	out, err := os.Create(path)
	if err != nil {
		return "", err
	}
	for n := 0; n < chunks; n++ {
		in, err := os.Open(chunkPath(dir, n))
		if err != nil {
			out.Close()
			return "", err
		}
		_, err = io.Copy(out, in)
		in.Close()
		if err != nil {
			out.Close()
			return "", err
		}
	}
	if err := out.Close(); err != nil {
		return "", err
	}
	_ = os.RemoveAll(dir)
	return path, nil
}

func chunkPath(dir string, n int) string {
	return filepath.Join(dir, fmt.Sprintf("%06d.part", n))
}

func uploadSize(dir string) (int64, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	var total int64
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".part") {
			continue
		}
		if info, err := e.Info(); err == nil {
			total += info.Size()
		}
	}
	return total, nil
}

// Uploads handles POST /uploads and PUT /uploads/{id}/{n}.
func (h *Handler) Uploads(w http.ResponseWriter, r *http.Request) {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/uploads"), "/")
	chunkBytes := h.ChunkBytes
	if chunkBytes <= 0 {
		chunkBytes = DefaultChunkBytes
	}

	if rest == "" {
		if r.Method != http.MethodPost {
			writeErr(w, http.StatusMethodNotAllowed, "POST only")
			return
		}
		id, err := h.Store.NewUpload()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"upload_id":  id,
			"chunk_size": chunkBytes,
		})
		return
	}

	parts := strings.Split(rest, "/")
	if len(parts) != 2 {
		writeErr(w, http.StatusNotFound, "use PUT /uploads/{id}/{n}")
		return
	}
	if r.Method != http.MethodPut {
		writeErr(w, http.StatusMethodNotAllowed, "PUT only")
		return
	}
	n, err := strconv.Atoi(parts[1])
	if err != nil {
		writeErr(w, http.StatusBadRequest, "chunk index must be a number")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, chunkBytes)
	if err := h.Store.PutChunk(parts[0], n, r.Body, h.MaxUploadBytes); err != nil {
		var ue *uploadError
		if errors.As(err, &ue) {
			writeErr(w, ue.status, ue.msg)
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
