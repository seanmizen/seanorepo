package main

// E2E tests for the ffmpeg-converter HTTP API.
//
// Two server flavours are used:
//
//   newFastServer – synthetic ops that write a small file without invoking
//                   ffmpeg. Used for routing, billing, and error-case tests.
//
//   newCoreServer – real RegisterOps() ops; skipped automatically when ffmpeg
//                   is not on PATH. Used to verify the full /ops listing and
//                   at least one real conversion.
//
// Run with:
//
//	go test ./... -v -timeout 120s

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
)

// ── server helpers ────────────────────────────────────────────────────────────

// synthOps returns a minimal set of synthetic operations that write a small
// dummy output file without calling ffmpeg. Names match real ops so that the
// billing token-cost map applies correctly.
func synthOps() map[string]*Operation {
	writeOK := func(_ context.Context, oc OpContext) error {
		return os.WriteFile(oc.Output, []byte("synth-output"), 0o644)
	}

	ops := map[string]*Operation{}
	for name, minInputs := range map[string]int{
		"image_to_jpg": 1, // 0 tokens – free for all tiers
		"transcode":    1, // 3 tokens for free tier
		"h264_to_h265": 1, // 10 tokens (expensive)
		"concat":       2, // 5 tokens, requires 2+ files
	} {
		name, minInputs := name, minInputs
		ops[name] = &Operation{
			Name:       name,
			Category:   "test",
			DefaultExt: ".out",
			MinInputs:  minInputs,
			Run:        writeOK,
		}
	}
	return ops
}

// buildMux mirrors main()'s route registration so tests can wire up a handler
// without starting a real OS process.
func buildMux(store *Store, jobs *JobTracker, ops map[string]*Operation, bh *BillingHandler) http.Handler {
	mux := http.NewServeMux()
	h := &Handler{Store: store, Jobs: jobs, Ops: ops, Billing: bh}
	mux.HandleFunc("/health", h.Health)
	mux.HandleFunc("/ops", h.ListOps)
	mux.HandleFunc("/convert", h.Convert)
	mux.HandleFunc("/jobs/", h.JobOrOutput)

	if bh != nil {
		mux.HandleFunc("/billing/me", bh.Me)
		mux.HandleFunc("/billing/identify", bh.Identify)
		mux.HandleFunc("/billing/checkout/subscription", bh.CreateSubscriptionCheckout)
		mux.HandleFunc("/billing/checkout/tokens", bh.CreateTokenCheckout)
		mux.HandleFunc("/billing/portal", bh.CustomerPortal)
		mux.HandleFunc("/billing/webhook", bh.Webhook)
	} else {
		mux.HandleFunc("/billing/me", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusOK, BillingInfo{LoggedIn: false, Tier: "free", DailyOpsMax: -1})
		})
	}
	pubKey := ""
	if bh != nil && bh.Cfg != nil {
		pubKey = bh.Cfg.PublishableKey
	}
	mux.HandleFunc("/billing/config", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"publishable_key": pubKey})
	})
	return mux
}

// newFastServer creates an httptest server with synthetic ops (no ffmpeg).
func newFastServer(t *testing.T, bh *BillingHandler) *httptest.Server {
	t.Helper()
	tmpDir := t.TempDir()
	ts := httptest.NewServer(buildMux(NewStore(tmpDir), NewJobTracker(), synthOps(), bh))
	t.Cleanup(ts.Close)
	return ts
}

// newCoreServer creates an httptest server with real RegisterOps().
// The test is skipped if ffmpeg is not on PATH.
func newCoreServer(t *testing.T) *httptest.Server {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH – skipping real-conversion test")
	}
	tmpDir := t.TempDir()
	ts := httptest.NewServer(buildMux(NewStore(tmpDir), NewJobTracker(), RegisterOps(), nil))
	t.Cleanup(ts.Close)
	return ts
}

// ── multipart helper ──────────────────────────────────────────────────────────

// doConvert POSTs a multipart /convert request and returns (statusCode, body).
func doConvert(t *testing.T, server *httptest.Server, op string, files map[string][]byte, args map[string]string, sessionToken string) (int, []byte) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)

	_ = mw.WriteField("op", op)
	for name, data := range files {
		fw, err := mw.CreateFormFile("file", name)
		if err != nil {
			t.Fatalf("create form file: %v", err)
		}
		_, _ = fw.Write(data)
	}
	for k, v := range args {
		_ = mw.WriteField(k, v)
	}
	mw.Close()

	req, err := http.NewRequest(http.MethodPost, server.URL+"/convert", &buf)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if sessionToken != "" {
		req.Header.Set("X-Session-Token", sessionToken)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, body
}

// ── health ────────────────────────────────────────────────────────────────────

func TestHealth(t *testing.T) {
	ts := newFastServer(t, nil)
	resp, err := http.Get(ts.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if body["status"] != "ok" {
		t.Errorf("want status=ok, got %v", body["status"])
	}
	if body["service"] != "ffmpeg-converter" {
		t.Errorf("want service=ffmpeg-converter, got %v", body["service"])
	}
	if _, ok := body["time"]; !ok {
		t.Error("expected 'time' field in health response")
	}
}

// ── /ops listing ──────────────────────────────────────────────────────────────

func TestListOps_SynthServer(t *testing.T) {
	ts := newFastServer(t, nil)
	resp, err := http.Get(ts.URL + "/ops")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	var ops []map[string]string
	_ = json.NewDecoder(resp.Body).Decode(&ops)
	if len(ops) == 0 {
		t.Error("expected at least one op in listing")
	}
	// Verify required fields are present.
	for _, op := range ops {
		for _, field := range []string{"name", "category", "output_ext"} {
			if op[field] == "" {
				t.Errorf("op %q missing field %q", op["name"], field)
			}
		}
	}
}

func TestListOps_AllRegistered(t *testing.T) {
	ts := newCoreServer(t)
	resp, err := http.Get(ts.URL + "/ops")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var ops []map[string]string
	_ = json.NewDecoder(resp.Body).Decode(&ops)

	if len(ops) < 50 {
		t.Errorf("want >=50 ops, got %d", len(ops))
	}

	// Spot-check all four categories are represented.
	names := make(map[string]bool, len(ops))
	for _, op := range ops {
		names[op["name"]] = true
	}
	required := []string{
		// video
		"transcode", "resize", "h264_to_h265", "timelapse",
		// audio
		"audio_mp3", "normalize_audio", "pitch_shift",
		// image
		"image_to_jpg", "image_to_webp", "image_to_avif",
		// special
		"youtube_preview", "meme_overlay", "silence_trim",
	}
	for _, name := range required {
		if !names[name] {
			t.Errorf("op %q not found in /ops", name)
		}
	}
}

// ── /convert happy paths ──────────────────────────────────────────────────────

func TestConvert_HappyPath(t *testing.T) {
	ts := newFastServer(t, nil)
	code, body := doConvert(t, ts, "image_to_jpg",
		map[string][]byte{"test.jpg": []byte("dummy-image-data")},
		nil, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d; body: %s", code, body)
	}
	var resp map[string]any
	_ = json.Unmarshal(body, &resp)
	if resp["status"] != "done" {
		t.Errorf("want status=done, got %v", resp["status"])
	}
	if resp["job_id"] == "" {
		t.Error("expected non-empty job_id")
	}
	if resp["output"] == nil {
		t.Error("expected output URL in response")
	}
}

func TestConvert_ExtensionOverride(t *testing.T) {
	ts := newFastServer(t, nil)
	code, body := doConvert(t, ts, "image_to_jpg",
		map[string][]byte{"test.jpg": []byte("data")},
		map[string]string{"ext": "png"}, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d; body: %s", code, body)
	}
	var resp map[string]any
	_ = json.Unmarshal(body, &resp)
	localPath, _ := resp["local_path"].(string)
	if !strings.HasSuffix(localPath, ".png") {
		t.Errorf("want .png output, got %q", localPath)
	}
}

func TestConvert_ExtensionOverride_NoDot(t *testing.T) {
	// ext without leading dot should still work.
	ts := newFastServer(t, nil)
	code, body := doConvert(t, ts, "image_to_jpg",
		map[string][]byte{"test.jpg": []byte("data")},
		map[string]string{"ext": "webp"}, "") // no leading dot
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d; body: %s", code, body)
	}
	var resp map[string]any
	_ = json.Unmarshal(body, &resp)
	if lp, _ := resp["local_path"].(string); !strings.HasSuffix(lp, ".webp") {
		t.Errorf("want .webp output, got %q", lp)
	}
}

func TestConvert_MultipleFiles_Concat(t *testing.T) {
	ts := newFastServer(t, nil)
	code, body := doConvert(t, ts, "concat",
		map[string][]byte{
			"a.mp4": []byte("video-a"),
			"b.mp4": []byte("video-b"),
		},
		nil, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d; body: %s", code, body)
	}
}

func TestConvert_PathTraversalPrevention(t *testing.T) {
	// A filename containing path-traversal components should be sanitized and
	// the conversion should succeed (files land in the job dir, not /).
	ts := newFastServer(t, nil)
	code, _ := doConvert(t, ts, "image_to_jpg",
		map[string][]byte{"../../../etc/passwd": []byte("dummy")},
		nil, "")
	if code != http.StatusOK {
		t.Fatalf("want 200 after path sanitization, got %d", code)
	}
}

// ── /convert error cases ──────────────────────────────────────────────────────

func TestConvert_MissingOp(t *testing.T) {
	ts := newFastServer(t, nil)
	code, body := doConvert(t, ts, "",
		map[string][]byte{"f.jpg": []byte("x")}, nil, "")
	if code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", code)
	}
	if !strings.Contains(string(body), "missing 'op'") {
		t.Errorf("want 'missing op' in error, got: %s", body)
	}
}

func TestConvert_UnknownOp(t *testing.T) {
	ts := newFastServer(t, nil)
	code, body := doConvert(t, ts, "not_a_real_op_xyz",
		map[string][]byte{"f.mp4": []byte("x")}, nil, "")
	if code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", code)
	}
	if !strings.Contains(string(body), "unknown op") {
		t.Errorf("want 'unknown op' in error, got: %s", body)
	}
}

func TestConvert_MissingFile(t *testing.T) {
	ts := newFastServer(t, nil)
	code, _ := doConvert(t, ts, "image_to_jpg", nil, nil, "")
	if code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", code)
	}
}

func TestConvert_TooFewFiles_Concat(t *testing.T) {
	// concat requires MinInputs=2.
	ts := newFastServer(t, nil)
	code, body := doConvert(t, ts, "concat",
		map[string][]byte{"only.mp4": []byte("data")}, nil, "")
	if code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d; body: %s", code, body)
	}
	if !strings.Contains(string(body), "requires at least 2") {
		t.Errorf("want 'requires at least 2' in error, got: %s", body)
	}
}

func TestConvert_MethodNotAllowed(t *testing.T) {
	ts := newFastServer(t, nil)
	resp, err := http.Get(ts.URL + "/convert")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", resp.StatusCode)
	}
}

// ── job lifecycle ─────────────────────────────────────────────────────────────

func TestJobStatus(t *testing.T) {
	ts := newFastServer(t, nil)
	_, body := doConvert(t, ts, "image_to_jpg",
		map[string][]byte{"test.jpg": []byte("x")}, nil, "")
	var convertResp map[string]any
	_ = json.Unmarshal(body, &convertResp)
	jobID := convertResp["job_id"].(string)

	resp, err := http.Get(ts.URL + "/jobs/" + jobID)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	var job map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&job)
	if job["status"] != "done" {
		t.Errorf("want job status=done, got %v", job["status"])
	}
	if job["op"] != "image_to_jpg" {
		t.Errorf("want op=image_to_jpg, got %v", job["op"])
	}
	if _, ok := job["started_at"]; !ok {
		t.Error("expected started_at in job JSON")
	}
}

func TestJobOutput_Download(t *testing.T) {
	ts := newFastServer(t, nil)
	_, body := doConvert(t, ts, "image_to_jpg",
		map[string][]byte{"test.jpg": []byte("x")}, nil, "")
	var resp map[string]any
	_ = json.Unmarshal(body, &resp)
	outputURL := resp["output"].(string)

	dlResp, err := http.Get(ts.URL + outputURL)
	if err != nil {
		t.Fatal(err)
	}
	defer dlResp.Body.Close()
	if dlResp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", dlResp.StatusCode)
	}
	data, _ := io.ReadAll(dlResp.Body)
	if len(data) == 0 {
		t.Error("downloaded output is empty")
	}
}

func TestJobOutput_JobNotDone_Returns409(t *testing.T) {
	// Create a job that stays in pending state (never run) and attempt to
	// download its output — must return 409 Conflict.
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)
	jobs := NewJobTracker()
	ops := synthOps()

	pending := jobs.Create("image_to_jpg")
	// Do NOT mark it done.

	ts := httptest.NewServer(buildMux(store, jobs, ops, nil))
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/jobs/" + pending.ID + "/output")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("want 409, got %d", resp.StatusCode)
	}
}

func TestJobNotFound(t *testing.T) {
	ts := newFastServer(t, nil)
	resp, err := http.Get(ts.URL + "/jobs/does-not-exist-at-all")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("want 404, got %d", resp.StatusCode)
	}
}

func TestJobOutput_NotFound(t *testing.T) {
	ts := newFastServer(t, nil)
	resp, err := http.Get(ts.URL + "/jobs/does-not-exist-at-all/output")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("want 404, got %d", resp.StatusCode)
	}
}

func TestJobSubresource_Unknown(t *testing.T) {
	ts := newFastServer(t, nil)
	_, body := doConvert(t, ts, "image_to_jpg",
		map[string][]byte{"test.jpg": []byte("x")}, nil, "")
	var resp map[string]any
	_ = json.Unmarshal(body, &resp)
	jobID := resp["job_id"].(string)

	httpResp, _ := http.Get(ts.URL + "/jobs/" + jobID + "/notaresource")
	httpResp.Body.Close()
	if httpResp.StatusCode != http.StatusNotFound {
		t.Fatalf("want 404 for unknown sub-resource, got %d", httpResp.StatusCode)
	}
}

// ── concurrent jobs ───────────────────────────────────────────────────────────

func TestConvert_ConcurrentJobs(t *testing.T) {
	ts := newFastServer(t, nil)
	const n = 20

	type result struct {
		code int
		body []byte
	}
	results := make([]result, n)
	var wg sync.WaitGroup

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			code, body := doConvert(t, ts, "image_to_jpg",
				map[string][]byte{"concurrent.jpg": []byte("data")},
				nil, "")
			results[idx] = result{code, body}
		}(i)
	}
	wg.Wait()

	for i, r := range results {
		if r.code != http.StatusOK {
			t.Errorf("job %d: want 200, got %d; body: %s", i, r.code, r.body)
		}
		var resp map[string]any
		_ = json.Unmarshal(r.body, &resp)
		if resp["status"] != "done" {
			t.Errorf("job %d: want done status, got %v", i, resp["status"])
		}
	}
}

func TestConvert_ConcurrentJobs_AllHaveDistinctIDs(t *testing.T) {
	ts := newFastServer(t, nil)
	const n = 10
	ids := make([]string, n)
	var wg sync.WaitGroup
	var mu sync.Mutex

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_, body := doConvert(t, ts, "image_to_jpg",
				map[string][]byte{"f.jpg": []byte("data")}, nil, "")
			var resp map[string]any
			_ = json.Unmarshal(body, &resp)
			if id, ok := resp["job_id"].(string); ok {
				mu.Lock()
				ids[idx] = id
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()

	seen := make(map[string]bool, n)
	for _, id := range ids {
		if seen[id] {
			t.Errorf("duplicate job ID: %s", id)
		}
		seen[id] = true
	}
}

// ── real ffmpeg conversion ────────────────────────────────────────────────────

func TestConvert_RealFfmpeg_Transcode(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH")
	}

	ts := newCoreServer(t)

	// Generate a 1-second 64x36 synthetic video as input.
	tmpDir := t.TempDir()
	inputPath := tmpDir + "/input.mp4"
	cmd := exec.Command("ffmpeg",
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=blue:s=64x36:r=10:d=1",
		"-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=1",
		"-c:v", "libx264", "-preset", "ultrafast", "-crf", "40",
		"-c:a", "aac", "-b:a", "32k",
		"-shortest", inputPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("could not generate test video: %v\n%s", err, out)
	}

	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		t.Fatalf("read input: %v", err)
	}

	code, body := doConvert(t, ts, "transcode",
		map[string][]byte{"input.mp4": inputData}, nil, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d; body: %s", code, body)
	}

	var resp map[string]any
	_ = json.Unmarshal(body, &resp)
	if resp["status"] != "done" {
		t.Errorf("want status=done, got %v", resp["status"])
	}

	// Download and verify it's not empty.
	outputURL := resp["output"].(string)
	dlResp, err := http.Get(ts.URL + outputURL)
	if err != nil {
		t.Fatal(err)
	}
	defer dlResp.Body.Close()
	data, _ := io.ReadAll(dlResp.Body)
	if len(data) < 100 {
		t.Errorf("downloaded output suspiciously small (%d bytes)", len(data))
	}
}

func TestConvert_RealFfmpeg_SpacedFilename_WebP(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH")
	}
	// Skip if no WebP encoder is available at all.
	encoders, _ := exec.Command("ffmpeg", "-hide_banner", "-encoders").Output()
	if !strings.Contains(string(encoders), "libwebp") {
		if _, err := exec.LookPath("cwebp"); err != nil {
			t.Skip("no WebP encoder available (no libwebp in ffmpeg, no cwebp on PATH)")
		}
	}

	ts := newCoreServer(t)

	// Generate a tiny test PNG via lavfi — no external fixtures needed.
	tmpDir := t.TempDir()
	inputPath := tmpDir + "/input.png"
	cmd := exec.Command("ffmpeg",
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=red:s=8x8:r=1",
		"-frames:v", "1", inputPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("could not generate test PNG: %v\n%s", err, out)
	}
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		t.Fatalf("read PNG: %v", err)
	}

	// Submit under a filename with spaces, exactly like a macOS screenshot.
	code, body := doConvert(t, ts, "image_to_webp",
		map[string][]byte{"Screenshot 2026-04-12 at 15.34.32.png": inputData},
		nil, "")
	if code != http.StatusOK {
		t.Fatalf("want 200 for spaced filename, got %d; body: %s", code, body)
	}

	var resp map[string]any
	_ = json.Unmarshal(body, &resp)
	if resp["status"] != "done" {
		t.Errorf("want status=done, got %v", resp["status"])
	}

	dlResp, err := http.Get(ts.URL + resp["output"].(string))
	if err != nil {
		t.Fatal(err)
	}
	defer dlResp.Body.Close()
	data, _ := io.ReadAll(dlResp.Body)
	if len(data) < 10 {
		t.Errorf("WebP output suspiciously small (%d bytes)", len(data))
	}
}

// TestConvert_RealFfmpeg_ExtractAudio_WavCodec verifies that the extract_audio
// op produces a real WAV file (RIFF header) with stereo source preserved as
// stereo and CD-quality sample rate (44.1 kHz). Regression test for the bug
// where extract_audio hard-coded -ar 16000 -ac 1, downgrading music sources
// to transcription quality.
func TestConvert_RealFfmpeg_ExtractAudio_WavCodec(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH")
	}
	ffprobePath, ffprobeErr := exec.LookPath("ffprobe")
	if ffprobeErr != nil {
		t.Skip("ffprobe not on PATH – needed to verify codec/rate/channels")
	}

	ts := newCoreServer(t)

	// Generate a 1-second stereo 44.1 kHz video as input. extract_audio must
	// preserve those characteristics on the way out.
	tmpDir := t.TempDir()
	inputPath := tmpDir + "/input.mp4"
	cmd := exec.Command("ffmpeg",
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=blue:s=64x36:r=10:d=1",
		"-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=1",
		"-ac", "2",
		"-c:v", "libx264", "-preset", "ultrafast", "-crf", "40",
		"-c:a", "aac", "-b:a", "96k",
		"-shortest", inputPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("could not generate test video: %v\n%s", err, out)
	}
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		t.Fatalf("read input: %v", err)
	}

	code, body := doConvert(t, ts, "extract_audio",
		map[string][]byte{"input.mp4": inputData}, nil, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d; body: %s", code, body)
	}
	var resp map[string]any
	_ = json.Unmarshal(body, &resp)
	if resp["status"] != "done" {
		t.Errorf("want status=done, got %v", resp["status"])
	}

	// Pull the WAV bytes back and write to disk so ffprobe can inspect.
	dlResp, err := http.Get(ts.URL + resp["output"].(string))
	if err != nil {
		t.Fatal(err)
	}
	defer dlResp.Body.Close()
	wavBytes, _ := io.ReadAll(dlResp.Body)
	if len(wavBytes) < 44 {
		t.Fatalf("output too small to be a WAV (%d bytes)", len(wavBytes))
	}
	// RIFF/WAVE header sanity check: bytes [0:4]="RIFF", [8:12]="WAVE".
	if !bytes.Equal(wavBytes[0:4], []byte("RIFF")) || !bytes.Equal(wavBytes[8:12], []byte("WAVE")) {
		t.Fatalf("output is not a RIFF/WAVE file: header=%q", wavBytes[0:12])
	}
	wavPath := tmpDir + "/output.wav"
	if err := os.WriteFile(wavPath, wavBytes, 0o644); err != nil {
		t.Fatalf("write wav: %v", err)
	}

	// ffprobe → JSON, check codec_name=pcm_s16le, sample_rate=44100, channels=2.
	probe := exec.Command(ffprobePath,
		"-v", "error", "-select_streams", "a:0",
		"-show_entries", "stream=codec_name,sample_rate,channels",
		"-of", "json", wavPath)
	probeOut, err := probe.Output()
	if err != nil {
		t.Fatalf("ffprobe failed: %v", err)
	}
	var probed struct {
		Streams []struct {
			CodecName  string `json:"codec_name"`
			SampleRate string `json:"sample_rate"`
			Channels   int    `json:"channels"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(probeOut, &probed); err != nil {
		t.Fatalf("parse ffprobe output: %v", err)
	}
	if len(probed.Streams) == 0 {
		t.Fatalf("ffprobe found no audio stream in output")
	}
	s := probed.Streams[0]
	if s.CodecName != "pcm_s16le" {
		t.Errorf("want codec_name=pcm_s16le, got %q", s.CodecName)
	}
	if s.SampleRate != "44100" {
		t.Errorf("want sample_rate=44100 (mirroring source), got %q", s.SampleRate)
	}
	if s.Channels != 2 {
		t.Errorf("want channels=2 (stereo, mirroring source), got %d", s.Channels)
	}
}

// TestConvert_RealFfmpeg_AudioOgg_VorbisCodec verifies that the audio_ogg op
// produces a real Vorbis-in-Ogg file. Regression test for the bug where the
// matrix routed video-to-ogg at extract_audio (which produced WAV bytes inside
// a .ogg-named file).
func TestConvert_RealFfmpeg_AudioOgg_VorbisCodec(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH")
	}
	ffprobePath, ffprobeErr := exec.LookPath("ffprobe")
	if ffprobeErr != nil {
		t.Skip("ffprobe not on PATH – needed to verify codec")
	}
	encoders, _ := exec.Command("ffmpeg", "-hide_banner", "-encoders").Output()
	if !strings.Contains(string(encoders), "libvorbis") {
		t.Skip("libvorbis encoder not built into ffmpeg")
	}

	ts := newCoreServer(t)

	tmpDir := t.TempDir()
	inputPath := tmpDir + "/input.mp4"
	cmd := exec.Command("ffmpeg",
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=blue:s=64x36:r=10:d=1",
		"-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=1",
		"-c:v", "libx264", "-preset", "ultrafast", "-crf", "40",
		"-c:a", "aac", "-b:a", "96k",
		"-shortest", inputPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("could not generate test video: %v\n%s", err, out)
	}
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		t.Fatalf("read input: %v", err)
	}

	code, body := doConvert(t, ts, "audio_ogg",
		map[string][]byte{"input.mp4": inputData}, nil, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d; body: %s", code, body)
	}
	var resp map[string]any
	_ = json.Unmarshal(body, &resp)
	if resp["status"] != "done" {
		t.Errorf("want status=done, got %v", resp["status"])
	}

	dlResp, err := http.Get(ts.URL + resp["output"].(string))
	if err != nil {
		t.Fatal(err)
	}
	defer dlResp.Body.Close()
	oggBytes, _ := io.ReadAll(dlResp.Body)
	if len(oggBytes) < 4 {
		t.Fatalf("output too small (%d bytes)", len(oggBytes))
	}
	// Ogg files start with "OggS" capture pattern (RFC 3533, §6).
	if !bytes.Equal(oggBytes[0:4], []byte("OggS")) {
		t.Fatalf("output is not an Ogg container: header=%q (regression: backend probably emitted WAV)", oggBytes[0:min(12, len(oggBytes))])
	}
	oggPath := tmpDir + "/output.ogg"
	if err := os.WriteFile(oggPath, oggBytes, 0o644); err != nil {
		t.Fatalf("write ogg: %v", err)
	}

	probe := exec.Command(ffprobePath,
		"-v", "error", "-select_streams", "a:0",
		"-show_entries", "stream=codec_name",
		"-of", "json", oggPath)
	probeOut, err := probe.Output()
	if err != nil {
		t.Fatalf("ffprobe failed: %v", err)
	}
	var probed struct {
		Streams []struct {
			CodecName string `json:"codec_name"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(probeOut, &probed); err != nil {
		t.Fatalf("parse ffprobe output: %v", err)
	}
	if len(probed.Streams) == 0 {
		t.Fatalf("ffprobe found no audio stream in output")
	}
	if probed.Streams[0].CodecName != "vorbis" {
		t.Errorf("want codec_name=vorbis, got %q", probed.Streams[0].CodecName)
	}
}

// TestConvert_RealFfmpeg_GifFromVideo_DefaultWidth verifies that gif_from_video
// produces a 480 px-wide GIF by default — matching the ffmpeg command advertised
// in the matrix (web/src/ops/matrix.ts). Regression test for the bug where the
// backend was hard-coded to scale=96:-1 while the copy-button told users 480.
func TestConvert_RealFfmpeg_GifFromVideo_DefaultWidth(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH")
	}
	ffprobePath, ffprobeErr := exec.LookPath("ffprobe")
	if ffprobeErr != nil {
		t.Skip("ffprobe not on PATH – needed to verify gif width")
	}

	ts := newCoreServer(t)

	// Generate a 1-second 1920x1080 synthetic video as input. This is wide
	// enough that scale=480:-1 will downscale (proving the scale filter ran)
	// but won't accidentally land on 96.
	tmpDir := t.TempDir()
	inputPath := tmpDir + "/input.mp4"
	cmd := exec.Command("ffmpeg",
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=blue:s=1920x1080:r=10:d=1",
		"-c:v", "libx264", "-preset", "ultrafast", "-crf", "40",
		"-pix_fmt", "yuv420p", inputPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("could not generate test video: %v\n%s", err, out)
	}
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		t.Fatalf("read input: %v", err)
	}

	code, body := doConvert(t, ts, "gif_from_video",
		map[string][]byte{"input.mp4": inputData}, nil, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d; body: %s", code, body)
	}
	var resp map[string]any
	_ = json.Unmarshal(body, &resp)
	if resp["status"] != "done" {
		t.Errorf("want status=done, got %v", resp["status"])
	}

	dlResp, err := http.Get(ts.URL + resp["output"].(string))
	if err != nil {
		t.Fatal(err)
	}
	defer dlResp.Body.Close()
	gifBytes, _ := io.ReadAll(dlResp.Body)
	if len(gifBytes) < 6 {
		t.Fatalf("output too small to be a GIF (%d bytes)", len(gifBytes))
	}
	// GIF header is "GIF87a" or "GIF89a".
	if !bytes.HasPrefix(gifBytes, []byte("GIF8")) {
		t.Fatalf("output is not a GIF: header=%q", gifBytes[:6])
	}
	gifPath := tmpDir + "/output.gif"
	if err := os.WriteFile(gifPath, gifBytes, 0o644); err != nil {
		t.Fatalf("write gif: %v", err)
	}

	probe := exec.Command(ffprobePath,
		"-v", "error", "-select_streams", "v:0",
		"-show_entries", "stream=width",
		"-of", "json", gifPath)
	probeOut, err := probe.Output()
	if err != nil {
		t.Fatalf("ffprobe failed: %v", err)
	}
	var probed struct {
		Streams []struct {
			Width int `json:"width"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(probeOut, &probed); err != nil {
		t.Fatalf("parse ffprobe output: %v", err)
	}
	if len(probed.Streams) == 0 {
		t.Fatalf("ffprobe found no video stream in gif")
	}
	if probed.Streams[0].Width != 480 {
		t.Errorf("want gif width=480 (matrix advertises scale=480:-1), got %d", probed.Streams[0].Width)
	}
}

// TestConvert_RealFfmpeg_GifFromVideo_WidthOverride verifies that the width
// arg overrides the 480 default. Locks in the read-from-extraArgs-if-present
// behaviour the AC asks for.
func TestConvert_RealFfmpeg_GifFromVideo_WidthOverride(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH")
	}
	ffprobePath, ffprobeErr := exec.LookPath("ffprobe")
	if ffprobeErr != nil {
		t.Skip("ffprobe not on PATH – needed to verify gif width")
	}

	ts := newCoreServer(t)
	tmpDir := t.TempDir()
	inputPath := tmpDir + "/input.mp4"
	cmd := exec.Command("ffmpeg",
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=blue:s=1920x1080:r=10:d=1",
		"-c:v", "libx264", "-preset", "ultrafast", "-crf", "40",
		"-pix_fmt", "yuv420p", inputPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("could not generate test video: %v\n%s", err, out)
	}
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		t.Fatalf("read input: %v", err)
	}

	code, body := doConvert(t, ts, "gif_from_video",
		map[string][]byte{"input.mp4": inputData},
		map[string]string{"width": "240"}, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d; body: %s", code, body)
	}
	var resp map[string]any
	_ = json.Unmarshal(body, &resp)

	dlResp, err := http.Get(ts.URL + resp["output"].(string))
	if err != nil {
		t.Fatal(err)
	}
	defer dlResp.Body.Close()
	gifBytes, _ := io.ReadAll(dlResp.Body)
	gifPath := tmpDir + "/output.gif"
	if err := os.WriteFile(gifPath, gifBytes, 0o644); err != nil {
		t.Fatalf("write gif: %v", err)
	}

	probe := exec.Command(ffprobePath,
		"-v", "error", "-select_streams", "v:0",
		"-show_entries", "stream=width",
		"-of", "json", gifPath)
	probeOut, err := probe.Output()
	if err != nil {
		t.Fatalf("ffprobe failed: %v", err)
	}
	var probed struct {
		Streams []struct {
			Width int `json:"width"`
		} `json:"streams"`
	}
	_ = json.Unmarshal(probeOut, &probed)
	if len(probed.Streams) == 0 || probed.Streams[0].Width != 240 {
		t.Errorf("want gif width=240 (override), got %+v", probed.Streams)
	}
}

// SEAN-92: each preset chip on `/gif/[slug]` (Smooth/Compact/Tiny) must
// produce a GIF at its advertised width AND frame rate. The chip values come
// straight from the AC; the test drives the (width, fps) tuple straight to
// the backend `extraArgs` to lock the contract — if the chip values change
// in the frontend, the test moves with them.
func TestConvert_RealFfmpeg_GifFromVideo_Presets(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH")
	}
	ffprobePath, ffprobeErr := exec.LookPath("ffprobe")
	if ffprobeErr != nil {
		t.Skip("ffprobe not on PATH – needed to verify gif width + fps")
	}

	ts := newCoreServer(t)
	tmpDir := t.TempDir()

	// 2-second source so palettegen has at least 20 frames at 10 fps to
	// sample — short enough that even Smooth (20 fps × 2 s = 40 frames at
	// 480 px) finishes in well under the test timeout.
	inputPath := tmpDir + "/input.mp4"
	cmd := exec.Command("ffmpeg",
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=blue:s=1920x1080:r=30:d=2",
		"-c:v", "libx264", "-preset", "ultrafast", "-crf", "40",
		"-pix_fmt", "yuv420p", inputPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("could not generate test video: %v\n%s", err, out)
	}
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		t.Fatalf("read input: %v", err)
	}

	cases := []struct {
		name      string
		args      map[string]string
		wantWidth int
		wantFps   string // ffprobe returns frame rate as "20/1" etc.
	}{
		{
			name:      "smooth",
			args:      map[string]string{"width": "480", "fps": "20"},
			wantWidth: 480,
			wantFps:   "20/1",
		},
		{
			name:      "compact",
			args:      map[string]string{"width": "320", "fps": "15"},
			wantWidth: 320,
			wantFps:   "15/1",
		},
		{
			name:      "tiny",
			args:      map[string]string{"width": "240", "fps": "10", "dither": "none"},
			wantWidth: 240,
			wantFps:   "10/1",
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			code, body := doConvert(t, ts, "gif_from_video",
				map[string][]byte{"input.mp4": inputData}, tc.args, "")
			if code != http.StatusOK {
				t.Fatalf("want 200, got %d; body: %s", code, body)
			}
			var resp map[string]any
			_ = json.Unmarshal(body, &resp)

			dlResp, err := http.Get(ts.URL + resp["output"].(string))
			if err != nil {
				t.Fatal(err)
			}
			defer dlResp.Body.Close()
			gifBytes, _ := io.ReadAll(dlResp.Body)
			gifPath := tmpDir + "/" + tc.name + ".gif"
			if err := os.WriteFile(gifPath, gifBytes, 0o644); err != nil {
				t.Fatalf("write gif: %v", err)
			}

			probe := exec.Command(ffprobePath,
				"-v", "error", "-select_streams", "v:0",
				"-show_entries", "stream=width,r_frame_rate",
				"-of", "json", gifPath)
			probeOut, err := probe.Output()
			if err != nil {
				t.Fatalf("ffprobe failed: %v", err)
			}
			var probed struct {
				Streams []struct {
					Width     int    `json:"width"`
					FrameRate string `json:"r_frame_rate"`
				} `json:"streams"`
			}
			if err := json.Unmarshal(probeOut, &probed); err != nil {
				t.Fatalf("parse ffprobe: %v", err)
			}
			if len(probed.Streams) == 0 {
				t.Fatalf("ffprobe found no video stream in %s gif", tc.name)
			}
			s := probed.Streams[0]
			if s.Width != tc.wantWidth {
				t.Errorf("%s preset: want width=%d, got %d", tc.name, tc.wantWidth, s.Width)
			}
			if s.FrameRate != tc.wantFps {
				t.Errorf("%s preset: want r_frame_rate=%s, got %q", tc.name, tc.wantFps, s.FrameRate)
			}
		})
	}
}

// SEAN-92: trim args (`start`, `duration`) must clip the output GIF to the
// requested window. Locks in input-side -ss/-t semantics — if the backend
// regresses to using filter-side trim, palettegen samples frames the user
// can't see and the test still catches the duration regression here.
func TestConvert_RealFfmpeg_GifFromVideo_Trim(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH")
	}
	ffprobePath, ffprobeErr := exec.LookPath("ffprobe")
	if ffprobeErr != nil {
		t.Skip("ffprobe not on PATH – needed to verify gif duration")
	}

	ts := newCoreServer(t)
	tmpDir := t.TempDir()

	// 4-second source so a 1-second trim leaves an obvious window.
	inputPath := tmpDir + "/input.mp4"
	cmd := exec.Command("ffmpeg",
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "color=c=red:s=320x180:r=10:d=4",
		"-c:v", "libx264", "-preset", "ultrafast", "-crf", "40",
		"-pix_fmt", "yuv420p", inputPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("could not generate test video: %v\n%s", err, out)
	}
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		t.Fatalf("read input: %v", err)
	}

	code, body := doConvert(t, ts, "gif_from_video",
		map[string][]byte{"input.mp4": inputData},
		map[string]string{"width": "240", "fps": "10", "start": "1", "duration": "1"}, "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d; body: %s", code, body)
	}
	var resp map[string]any
	_ = json.Unmarshal(body, &resp)

	dlResp, err := http.Get(ts.URL + resp["output"].(string))
	if err != nil {
		t.Fatal(err)
	}
	defer dlResp.Body.Close()
	gifBytes, _ := io.ReadAll(dlResp.Body)
	gifPath := tmpDir + "/trimmed.gif"
	if err := os.WriteFile(gifPath, gifBytes, 0o644); err != nil {
		t.Fatalf("write gif: %v", err)
	}

	probe := exec.Command(ffprobePath,
		"-v", "error", "-select_streams", "v:0",
		"-show_entries", "stream=duration,nb_read_frames",
		"-count_frames",
		"-of", "json", gifPath)
	probeOut, err := probe.Output()
	if err != nil {
		t.Fatalf("ffprobe failed: %v", err)
	}
	var probed struct {
		Streams []struct {
			Duration     string `json:"duration"`
			NbReadFrames string `json:"nb_read_frames"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(probeOut, &probed); err != nil {
		t.Fatalf("parse ffprobe: %v", err)
	}
	if len(probed.Streams) == 0 {
		t.Fatalf("ffprobe found no video stream in trimmed gif")
	}
	// At fps=10 for 1 s we expect ~10 frames. Allow a small tolerance for
	// keyframe alignment on the -ss side.
	frames := probed.Streams[0].NbReadFrames
	if frames == "" {
		t.Fatalf("ffprobe returned empty nb_read_frames: %s", probeOut)
	}
	// Parse manually to avoid pulling in another dep. Frame count should
	// land in [8, 12] for a 1-second 10 fps trim.
	var frameCount int
	for _, c := range frames {
		if c < '0' || c > '9' {
			t.Fatalf("non-numeric nb_read_frames: %q", frames)
		}
		frameCount = frameCount*10 + int(c-'0')
	}
	if frameCount < 8 || frameCount > 12 {
		t.Errorf("trim regression: want ~10 frames for 1s @ 10fps, got %d (full input would be 40)", frameCount)
	}
}

// ── /billing/me (billing disabled) ───────────────────────────────────────────

func TestBillingMe_BillingDisabled(t *testing.T) {
	ts := newFastServer(t, nil)
	resp, err := http.Get(ts.URL + "/billing/me")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	var info BillingInfo
	_ = json.NewDecoder(resp.Body).Decode(&info)
	if info.LoggedIn {
		t.Error("expected logged_in=false when billing disabled")
	}
	if info.Tier != "free" {
		t.Errorf("want tier=free, got %q", info.Tier)
	}
	if info.DailyOpsMax != -1 {
		t.Errorf("want daily_ops_max=-1, got %d", info.DailyOpsMax)
	}
}

func TestBillingConfig_PublishableKey(t *testing.T) {
	ts := newFastServer(t, nil)
	resp, err := http.Get(ts.URL + "/billing/config")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	var body map[string]string
	_ = json.NewDecoder(resp.Body).Decode(&body)
	// Without billing enabled, key should be empty string.
	if _, ok := body["publishable_key"]; !ok {
		t.Error("expected publishable_key field in /billing/config")
	}
}
