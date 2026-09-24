package main

// Chunked uploads (uploads.go). The server under test has a 10-byte chunk
// size and a 50-byte upload limit, and a "copy" op that writes its input to
// its output, so each test can check the joined file byte for byte.

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func newUploadServer(t *testing.T) (*httptest.Server, *Store) {
	t.Helper()
	store := NewStore(t.TempDir())
	ops := map[string]*Operation{
		"copy": {Name: "copy", DefaultExt: ".bin", MinInputs: 1,
			Run: func(_ context.Context, oc OpContext) error {
				data, err := os.ReadFile(oc.Inputs[0])
				if err != nil {
					return err
				}
				return os.WriteFile(oc.Output, data, 0o644)
			}},
	}
	h := &Handler{Store: store, Jobs: NewJobTracker(), Ops: ops, ChunkBytes: 10, MaxUploadBytes: 50}
	mux := http.NewServeMux()
	mux.HandleFunc("/convert", h.Convert)
	mux.HandleFunc("/uploads", h.Uploads)
	mux.HandleFunc("/uploads/", h.Uploads)
	mux.HandleFunc("/jobs/", h.JobOrOutput)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return ts, store
}

func startUpload(t *testing.T, ts *httptest.Server) (string, int64) {
	t.Helper()
	resp, err := http.Post(ts.URL+"/uploads", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /uploads: want 201, got %d", resp.StatusCode)
	}
	var body struct {
		UploadID  string `json:"upload_id"`
		ChunkSize int64  `json:"chunk_size"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&body)
	return body.UploadID, body.ChunkSize
}

func putChunk(t *testing.T, ts *httptest.Server, id string, n int, data []byte) int {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/uploads/"+id+"/"+strconv.Itoa(n), bytes.NewReader(data))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

// convertUpload posts /convert for an upload and returns the status and body.
func convertUpload(t *testing.T, ts *httptest.Server, id string, chunks int) (int, []byte) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range map[string]string{"op": "copy", "upload_id": id, "chunks": strconv.Itoa(chunks), "filename": "movie.mov"} {
		_ = mw.WriteField(k, v)
	}
	_ = mw.Close()
	resp, err := http.Post(ts.URL+"/convert", mw.FormDataContentType(), &buf)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, body
}

func output(t *testing.T, ts *httptest.Server, body []byte) []byte {
	t.Helper()
	var job struct {
		JobID string `json:"job_id"`
	}
	_ = json.Unmarshal(body, &job)
	resp, err := http.Get(ts.URL + "/jobs/" + job.JobID + "/output")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return data
}

func TestChunkedUpload_OutOfOrderChunksJoinInOrder(t *testing.T) {
	ts, store := newUploadServer(t)
	id, size := startUpload(t, ts)
	if size != 10 {
		t.Fatalf("chunk_size: want 10, got %d", size)
	}
	chunks := [][]byte{[]byte("0123456789"), []byte("abcdefghij"), []byte("XYZ")}
	for _, n := range []int{2, 0, 1} {
		if code := putChunk(t, ts, id, n, chunks[n]); code != http.StatusNoContent {
			t.Fatalf("chunk %d: want 204, got %d", n, code)
		}
	}
	code, body := convertUpload(t, ts, id, 3)
	if code != http.StatusOK {
		t.Fatalf("convert: want 200, got %d: %s", code, body)
	}
	if got := string(output(t, ts, body)); got != "0123456789abcdefghijXYZ" {
		t.Fatalf("joined file: got %q", got)
	}
	if _, err := os.Stat(store.uploadDir(id)); !os.IsNotExist(err) {
		t.Error("the upload directory stays after the join")
	}
	// The upload is used up. A second convert gets 404.
	if code, _ := convertUpload(t, ts, id, 3); code != http.StatusNotFound {
		t.Errorf("reuse: want 404, got %d", code)
	}
}

func TestChunkedUpload_RetriedChunkReplacesTheFirst(t *testing.T) {
	ts, _ := newUploadServer(t)
	id, _ := startUpload(t, ts)
	putChunk(t, ts, id, 0, []byte("wrongwrong"))
	putChunk(t, ts, id, 0, []byte("rightright"))
	putChunk(t, ts, id, 1, []byte("!"))
	code, body := convertUpload(t, ts, id, 2)
	if code != http.StatusOK {
		t.Fatalf("convert: want 200, got %d: %s", code, body)
	}
	if got := string(output(t, ts, body)); got != "rightright!" {
		t.Fatalf("joined file: got %q", got)
	}
}

func TestChunkedUpload_MissingChunk(t *testing.T) {
	ts, _ := newUploadServer(t)
	id, _ := startUpload(t, ts)
	putChunk(t, ts, id, 0, []byte("0123456789"))
	putChunk(t, ts, id, 2, []byte("XYZ"))
	if code, body := convertUpload(t, ts, id, 3); code != http.StatusBadRequest || !bytes.Contains(body, []byte("chunk 1 is missing")) {
		t.Fatalf("want 400 chunk 1 is missing, got %d: %s", code, body)
	}
}

func TestChunkedUpload_ChunkOverTheChunkSize(t *testing.T) {
	ts, _ := newUploadServer(t)
	id, _ := startUpload(t, ts)
	if code := putChunk(t, ts, id, 0, []byte("01234567890")); code != http.StatusRequestEntityTooLarge {
		t.Fatalf("11-byte chunk: want 413, got %d", code)
	}
}

func TestChunkedUpload_TotalOverTheLimit(t *testing.T) {
	ts, _ := newUploadServer(t)
	id, _ := startUpload(t, ts)
	for n := 0; n < 5; n++ {
		if code := putChunk(t, ts, id, n, []byte("0123456789")); code != http.StatusNoContent {
			t.Fatalf("chunk %d (total %d): want 204, got %d", n, (n+1)*10, code)
		}
	}
	// Byte 51 is over the 50-byte limit.
	if code := putChunk(t, ts, id, 5, []byte("x")); code != http.StatusRequestEntityTooLarge {
		t.Fatalf("chunk over the total: want 413, got %d", code)
	}
}

func TestChunkedUpload_BadRequests(t *testing.T) {
	ts, _ := newUploadServer(t)
	id, _ := startUpload(t, ts)
	for name, c := range map[string]struct {
		id   string
		n    string
		want int
	}{
		"unknown id":   {"0123456789abcdef", "0", http.StatusNotFound},
		"not a hex id": {"not-a-hex-id!!!!", "0", http.StatusBadRequest},
		// The router decodes %2f and cleans the path, so this never reaches
		// the handler.
		"path in the id":   {"..%2f..%2fetc", "0", http.StatusNotFound},
		"negative index":   {id, "-1", http.StatusBadRequest},
		"index too large":  {id, strconv.Itoa(maxChunks), http.StatusBadRequest},
		"index not number": {id, "one", http.StatusBadRequest},
	} {
		req, _ := http.NewRequest(http.MethodPut, ts.URL+"/uploads/"+c.id+"/"+c.n, bytes.NewReader([]byte("x")))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != c.want {
			t.Errorf("%s: want %d, got %d", name, c.want, resp.StatusCode)
		}
	}
	if code, _ := convertUpload(t, ts, "0123456789abcdef", 1); code != http.StatusNotFound {
		t.Errorf("convert with unknown id: want 404, got %d", code)
	}
}

func TestChunkedUpload_SweepRemovesAnAbandonedUpload(t *testing.T) {
	ts, store := newUploadServer(t)
	id, _ := startUpload(t, ts)
	putChunk(t, ts, id, 0, []byte("0123456789"))
	old := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(store.uploadDir(id), old, old); err != nil {
		t.Fatal(err)
	}
	if n := store.Sweep(time.Now().Add(-time.Hour), func(string) bool { return false }); n != 1 {
		t.Fatalf("sweep: want 1 removed, got %d", n)
	}
	if _, err := os.Stat(filepath.Join(store.DataDir, "up-"+id)); !os.IsNotExist(err) {
		t.Error("the abandoned upload is still there")
	}
}
