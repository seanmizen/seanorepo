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
