package main

// Tests for the job lifecycle that the website depends on: async jobs,
// the upload limit, and the one-hour file sweep. No ffmpeg needed.

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestConvert_Async_ReturnsAtOnceThenCompletes(t *testing.T) {
	ts := newFastServer(t, nil)
	code, body := doConvert(t, ts, "image_to_jpg",
		map[string][]byte{"a.png": []byte("x")}, map[string]string{"async": "1"}, "")
	if code != http.StatusAccepted {
		t.Fatalf("want 202, got %d: %s", code, body)
	}
	var start struct {
		JobID string `json:"job_id"`
	}
	_ = json.Unmarshal(body, &start)

	deadline := time.Now().Add(5 * time.Second)
	for {
		resp, err := http.Get(ts.URL + "/jobs/" + start.JobID)
		if err != nil {
			t.Fatal(err)
		}
		var j Job
		_ = json.NewDecoder(resp.Body).Decode(&j)
		_ = resp.Body.Close()
		if j.Status == StatusDone {
			break
		}
		if j.Status == StatusError || time.Now().After(deadline) {
			t.Fatalf("job did not finish: %+v", j)
		}
		time.Sleep(20 * time.Millisecond)
	}

	resp, err := http.Get(ts.URL + "/jobs/" + start.JobID + "/output")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("output: want 200, got %d", resp.StatusCode)
	}
}

func TestConvert_UploadLimit(t *testing.T) {
	h := &Handler{
		Store: NewStore(t.TempDir()), Jobs: NewJobTracker(), Ops: synthOps(),
		MaxUploadBytes: 1 << 10,
	}
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("op", "image_to_jpg")
	fw, _ := mw.CreateFormFile("file", "big.png")
	_, _ = fw.Write(bytes.Repeat([]byte("x"), 4<<10))
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/convert", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()
	h.Convert(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("want 413, got %d: %s", rec.Code, rec.Body)
	}
}

func TestStore_Sweep_RemovesOldDirsButNotBusyOnes(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	old := time.Now().Add(-2 * time.Hour)
	for _, id := range []string{"old", "busy", "new"} {
		if err := os.MkdirAll(filepath.Join(dir, id), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []string{"old", "busy"} {
		if err := os.Chtimes(filepath.Join(dir, id), old, old); err != nil {
			t.Fatal(err)
		}
	}

	n := s.Sweep(time.Now().Add(-time.Hour), func(id string) bool { return id == "busy" })
	if n != 1 {
		t.Fatalf("want 1 dir removed, got %d", n)
	}
	for id, want := range map[string]bool{"old": false, "busy": true, "new": true} {
		_, err := os.Stat(filepath.Join(dir, id))
		if got := err == nil; got != want {
			t.Errorf("%s: exists=%v, want %v", id, got, want)
		}
	}
}

func TestJobTracker_PruneKeepsRunningJobs(t *testing.T) {
	jt := NewJobTracker()
	done := jt.Create("x")
	running := jt.Create("x")
	jt.Update(done.ID, func(j *Job) { j.Status = StatusDone })
	jt.Update(running.ID, func(j *Job) { j.Status = StatusRunning })

	jt.Prune(time.Now().Add(time.Second))

	if _, ok := jt.Get(done.ID); ok {
		t.Error("done job was not pruned")
	}
	if _, ok := jt.Get(running.ID); !ok {
		t.Error("running job was pruned")
	}
}

func TestFfmpegVersion(t *testing.T) {
	for in, want := range map[string][2]int{
		"ffmpeg version 7.0.2-static https://johnvansickle.com": {7, 0},
		"ffmpeg version n8.1.3-20260923 Copyright":              {8, 1},
		"ffmpeg version 6.1.1-3ubuntu5 Copyright":               {6, 1},
	} {
		major, minor, ok := ffmpegVersion(in)
		if !ok || major != want[0] || minor != want[1] {
			t.Errorf("%q: got %d.%d ok=%v", in, major, minor, ok)
		}
	}
	if _, _, ok := ffmpegVersion("ffmpeg version N-118000-gabc"); ok {
		t.Error("git build: want ok=false")
	}
}

func TestAPIPrefix_ServesTheSameRoutes(t *testing.T) {
	store := NewStore(t.TempDir())
	h := &Handler{Store: store, Jobs: NewJobTracker(), Ops: synthOps()}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", h.Health)
	mux.HandleFunc("/uploads", h.Uploads)
	ts := httptest.NewServer(withAPIPrefix(mux))
	defer ts.Close()
	for _, p := range []string{"/health", "/api/health"} {
		resp, err := http.Get(ts.URL + p)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("GET %s: want 200, got %d", p, resp.StatusCode)
		}
	}
	resp, err := http.Post(ts.URL+"/api/uploads", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Errorf("POST /api/uploads: want 201, got %d", resp.StatusCode)
	}
}

func TestWithHEIFDecode_UsesTheDecoderForHEICOnly(t *testing.T) {
	dir := t.TempDir()
	// A fake decoder: writes "decoded" to its second argument.
	fake := filepath.Join(dir, "fake-heif-dec")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\necho decoded > \"$2\"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	old := heifDecoder
	heifDecoder = fake
	defer func() { heifDecoder = old }()

	var got string
	run := withHEIFDecode(func(_ context.Context, oc OpContext) error {
		data, _ := os.ReadFile(oc.Inputs[0])
		got = oc.Inputs[0] + ":" + string(data)
		return nil
	})
	for in, want := range map[string]string{
		"IMG_0001.HEIC": filepath.Join(dir, "heif-decoded.png") + ":decoded\n",
		"photo.heif":    filepath.Join(dir, "heif-decoded.png") + ":decoded\n",
		"photo.png":     filepath.Join(dir, "photo.png") + ":original",
	} {
		path := filepath.Join(dir, in)
		_ = os.WriteFile(path, []byte("original"), 0o644)
		if err := run(context.Background(), OpContext{Inputs: []string{path}, Output: filepath.Join(dir, "out.jpg")}); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("%s: got %q, want %q", in, got, want)
		}
	}
}

func TestHEIFPrimaryOutput_PicksThePrimaryOfSeveral(t *testing.T) {
	dir := t.TempDir()
	png := filepath.Join(dir, "heif-decoded.png")
	for _, name := range []string{"heif-decoded-1.png", "heif-decoded-2.png"} {
		_ = os.WriteFile(filepath.Join(dir, name), []byte(name), 0o644)
	}
	// A fake heif-info that marks the second image as primary.
	bin := t.TempDir()
	info := "#!/bin/sh\necho 'image: 320x212 (id=1)'\necho 'image: 1280x854 (id=2), primary'\n"
	_ = os.WriteFile(filepath.Join(bin, "heif-info"), []byte(info), 0o755)
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	got, err := heifPrimaryOutput(context.Background(), "in.heic", png)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(dir, "heif-decoded-2.png"); got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}
