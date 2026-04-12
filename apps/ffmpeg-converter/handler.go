package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

type Handler struct {
	Store   *Store
	Jobs    *JobTracker
	Ops     map[string]*Operation
	Billing *BillingHandler
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"ops":     len(h.Ops),
		"service": "ffmpeg-converter",
		"time":    time.Now().Format(time.RFC3339),
	})
}

func (h *Handler) ListOps(w http.ResponseWriter, r *http.Request) {
	out := make([]map[string]string, 0, len(h.Ops))
	for name, op := range h.Ops {
		out = append(out, map[string]string{
			"name":        name,
			"category":    op.Category,
			"description": op.Description,
			"output_ext":  op.DefaultExt,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// Convert accepts a multipart/form-data POST:
//   - file (required): one or more input files (repeat field for concat)
//   - op (required): registered operation name
//   - Any other form values are passed as op args (strings).
func (h *Handler) Convert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	// Max 64 MiB in memory for multipart. Tiny-by-design.
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "bad multipart: "+err.Error())
		return
	}

	opName := r.FormValue("op")
	if opName == "" {
		writeErr(w, http.StatusBadRequest, "missing 'op' field")
		return
	}
	op, ok := h.Ops[opName]
	if !ok {
		writeErr(w, http.StatusBadRequest, "unknown op: "+opName)
		return
	}

	// Billing gate — check before creating the job.
	if h.Billing != nil {
		if berr := h.Billing.CheckConvert(r, opName); berr != nil {
			writeJSON(w, http.StatusPaymentRequired, berr)
			return
		}
	}

	job := h.Jobs.Create(opName)

	files := r.MultipartForm.File["file"]
	if len(files) == 0 && op.MinInputs > 0 {
		writeErr(w, http.StatusBadRequest, "missing 'file' upload")
		return
	}
	if len(files) < op.MinInputs {
		writeErr(w, http.StatusBadRequest,
			fmt.Sprintf("op %q requires at least %d file(s), got %d", opName, op.MinInputs, len(files)))
		return
	}

	inputs := make([]string, 0, len(files))
	for _, fh := range files {
		f, err := fh.Open()
		if err != nil {
			h.fail(job, err)
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		path, err := h.Store.SaveUpload(job.ID, fh.Filename, f)
		_ = f.Close()
		if err != nil {
			h.fail(job, err)
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		inputs = append(inputs, path)
	}

	// Collect form args (excluding reserved).
	args := map[string]string{}
	for k, v := range r.MultipartForm.Value {
		if k == "op" || k == "file" {
			continue
		}
		if len(v) > 0 {
			args[k] = v[0]
		}
	}

	ext := op.DefaultExt
	if override := args["ext"]; override != "" {
		if !strings.HasPrefix(override, ".") {
			override = "." + override
		}
		ext = override
	}
	outPath := h.Store.OutputPath(job.ID, ext)

	h.Jobs.Update(job.ID, func(j *Job) { j.Status = StatusRunning })

	ctx := r.Context()
	if err := op.Run(ctx, OpContext{Inputs: inputs, Output: outPath, Args: args}); err != nil {
		h.fail(job, err)
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	h.Jobs.Update(job.ID, func(j *Job) {
		j.Status = StatusDone
		j.OutputPath = outPath
		j.EndedAt = time.Now()
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"job_id":     job.ID,
		"status":     StatusDone,
		"op":         opName,
		"output":     "/jobs/" + job.ID + "/output",
		"local_path": outPath,
	})
}

// JobOrOutput handles:
//
//	GET /jobs/{id}         — job status JSON
//	GET /jobs/{id}/output  — download the output file
func (h *Handler) JobOrOutput(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/jobs/")
	parts := strings.Split(trimmed, "/")
	if len(parts) == 0 || parts[0] == "" {
		writeErr(w, http.StatusNotFound, "missing job id")
		return
	}
	id := parts[0]
	j, ok := h.Jobs.Get(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "unknown job")
		return
	}
	if len(parts) == 1 {
		writeJSON(w, http.StatusOK, j)
		return
	}
	if parts[1] != "output" {
		writeErr(w, http.StatusNotFound, "unknown sub-resource")
		return
	}
	if j.Status != StatusDone {
		writeErr(w, http.StatusConflict, "job not done")
		return
	}
	http.ServeFile(w, r, j.OutputPath)
}

func (h *Handler) fail(j *Job, err error) {
	log.Printf("job %s failed: %v", j.ID, err)
	h.Jobs.Update(j.ID, func(jj *Job) {
		jj.Status = StatusError
		jj.Error = err.Error()
		jj.EndedAt = time.Now()
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// ensure filepath is referenced (used by ServeFile indirectly via job.OutputPath)
var _ = filepath.Join
