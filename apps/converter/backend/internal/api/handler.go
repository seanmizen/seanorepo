package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/seanmizen/converter/internal/converter"
	"github.com/seanmizen/converter/internal/job"
	"github.com/seanmizen/converter/internal/storage"
)

// Handler holds the shared dependencies for all HTTP handlers.
type Handler struct {
	queue          *job.Queue
	store          *storage.TempStore
	registry       *converter.Registry
	maxUploadBytes int64
}

func NewHandler(q *job.Queue, s *storage.TempStore, r *converter.Registry, maxUploadBytes int64) *Handler {
	return &Handler{queue: q, store: s, registry: r, maxUploadBytes: maxUploadBytes}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// GetFormats returns all supported input formats and their possible output formats.
// GET /api/formats
func (h *Handler) GetFormats(w http.ResponseWriter, r *http.Request) {
	all := []string{
		"mp4", "webm", "mkv", "avi", "mov", "flv",
		"mp3", "aac", "ogg", "flac", "wav", "opus", "m4a",
		"jpg", "jpeg", "png", "webp", "avif", "bmp", "gif", "tiff",
	}
	result := make(map[string][]string, len(all))
	for _, ext := range all {
		c, err := h.registry.FindConverter("." + ext)
		if err != nil {
			continue
		}
		if outs := c.OutputFormats("." + ext); outs != nil {
			result[ext] = outs
		}
	}
	writeJSON(w, http.StatusOK, result)
}

// CreateJob accepts a multipart upload and enqueues a conversion job.
// POST /api/jobs
// Form fields: file (required), outputFormat (required)
func (h *Handler) CreateJob(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, h.maxUploadBytes)

	// 32 MiB in-memory buffer; anything larger goes to temp files handled by io.Copy below.
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "request too large or malformed")
		return
	}

	outputFormat := strings.ToLower(r.FormValue("outputFormat"))
	if outputFormat == "" {
		writeError(w, http.StatusBadRequest, "outputFormat is required")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file field is required")
		return
	}
	defer file.Close()

	inputExt := strings.ToLower(filepath.Ext(header.Filename))
	if inputExt == "" {
		writeError(w, http.StatusBadRequest, "uploaded filename must have an extension")
		return
	}

	c, err := h.registry.FindConverter(inputExt)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unsupported input format: %s", inputExt))
		return
	}

	validOutput := false
	for _, f := range c.OutputFormats(inputExt) {
		if f == outputFormat {
			validOutput = true
			break
		}
	}
	if !validOutput {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("cannot convert %s → %s", inputExt, outputFormat))
		return
	}

	// Stream the upload directly to a temp file — no full-file RAM buffer.
	inputPath, err := h.store.NewFile(inputExt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not allocate temp file")
		return
	}
	tmp, err := os.OpenFile(inputPath, os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not open temp file")
		return
	}
	if _, err := io.Copy(tmp, file); err != nil {
		tmp.Close()
		_ = h.store.Delete(inputPath)
		writeError(w, http.StatusInternalServerError, "upload write failed")
		return
	}
	tmp.Close()

	j := &job.Job{
		ID:           newID(),
		Status:       job.StatusQueued,
		OriginalName: header.Filename,
		OutputFormat: outputFormat,
		InputPath:    inputPath,
		CreatedAt:    time.Now(),
	}

	if err := h.queue.Submit(j); err != nil {
		_ = h.store.Delete(inputPath)
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	log.Printf("job %s: queued %s → %s (%d bytes)", j.ID, header.Filename, outputFormat, header.Size)
	writeJSON(w, http.StatusAccepted, map[string]string{"id": j.ID})
}

// GetJob returns the current snapshot of a job.
// GET /api/jobs/{id}
func (h *Handler) GetJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	j, ok := h.queue.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}
	writeJSON(w, http.StatusOK, j)
}

// JobEvents streams Server-Sent Events for a job until it completes or errors.
// GET /api/jobs/{id}/events
func (h *Handler) JobEvents(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported by this server")
		return
	}

	if _, ok := h.queue.Get(id); !ok {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // tell nginx/Caddy not to buffer SSE

	sendEvent := func(j *job.Job) {
		data, _ := json.Marshal(j)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	ticker := time.NewTicker(400 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			cur, ok := h.queue.Get(id)
			if !ok {
				return
			}
			sendEvent(cur)
			if cur.Status == job.StatusDone || cur.Status == job.StatusError {
				return
			}
		}
	}
}

// Download streams the converted output file to the client.
// GET /api/jobs/{id}/download
func (h *Handler) Download(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	j, ok := h.queue.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}
	if j.Status != job.StatusDone {
		writeError(w, http.StatusConflict, "job not complete yet")
		return
	}

	ext := filepath.Ext(j.OutputPath)
	mime := converter.MIMEType(ext)
	base := strings.TrimSuffix(j.OriginalName, filepath.Ext(j.OriginalName))
	downloadName := base + converter.OutputExt(j.OutputFormat)

	f, err := os.Open(j.OutputPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "output file unavailable")
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, downloadName))
	http.ServeContent(w, r, downloadName, time.Time{}, f)
}
