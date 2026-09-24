package main

// Smart-cut trim, with real ffmpeg. Every test input carries its frame
// number in the picture: 16 black or white bars across the top, one bit
// each. Lossy encoding cannot blur bars 40 pixels wide, so the test reads the
// number back from every frame of the output, and compares the sequence
// with a frame-exact reference cut of the same input. One frame too many,
// too few or out of place, at a join or anywhere, fails the test.

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// stampedSource is a lavfi source: the moving test pattern with the frame
// number stamped on top.
func stampedSource(size string, fps, seconds int) string {
	return fmt.Sprintf("testsrc2=s=%s:r=%d:d=%d,format=yuv420p,"+
		"geq=lum='if(lt(Y\\,40)\\,if(mod(floor(N/pow(2\\,floor(X/40)))\\,2)\\,235\\,16)\\,lum(X\\,Y))'"+
		":cb='if(lt(Y\\,40)\\,128\\,cb(X\\,Y))':cr='if(lt(Y\\,40)\\,128\\,cr(X\\,Y))'",
		size, fps, seconds)
}

func needFFmpeg(t *testing.T) {
	t.Helper()
	for _, bin := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(bin); err != nil {
			t.Skip(bin + " is not on PATH")
		}
	}
	if testing.Short() {
		t.Skip("encodes video: not in -short mode")
	}
}

// makeInput encodes a stamped test video with the given encoder arguments.
func makeInput(t *testing.T, name, size string, seconds int, vf string, enc ...string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	src := stampedSource(size, 30, seconds)
	if vf != "" {
		src += "," + vf
	}
	args := []string{"-f", "lavfi", "-i", src, "-f", "lavfi", "-i", fmt.Sprintf("sine=d=%d", seconds)}
	args = append(args, enc...)
	args = append(args, "-c:a", "aac", "-shortest", path)
	if err := ffmpegRun(context.Background(), args...); err != nil {
		t.Fatal(err)
	}
	return path
}

// frameNumbers decodes a video and reads the stamp of every frame.
func frameNumbers(t *testing.T, path string) []int {
	t.Helper()
	out, err := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path,
		"-vf", "crop=640:20:0:10,scale=16:1:flags=area,format=gray", "-fps_mode", "passthrough",
		"-f", "rawvideo", "-").Output()
	if err != nil {
		t.Fatalf("read stamps of %s: %v", path, err)
	}
	nums := make([]int, 0, len(out)/16)
	for f := 0; f+16 <= len(out); f += 16 {
		n := 0
		for bit := 0; bit < 16; bit++ {
			if out[f+bit] > 128 {
				n |= 1 << bit
			}
		}
		nums = append(nums, n)
	}
	return nums
}

// referenceNumbers is the frame-exact answer: a slow, lossless trim with
// the trim filter.
func referenceNumbers(t *testing.T, in string, start, dur float64) []int {
	t.Helper()
	ref := filepath.Join(t.TempDir(), "ref.mkv")
	// The clip's definition: every frame with a timestamp in [start, end).
	if err := ffmpegRun(context.Background(), "-copyts", "-ss", ftoa(start), "-i", in,
		"-map", "0:v:0", "-vf", clipFilter("trim", start, start+dur),
		"-fps_mode", "passthrough", "-c:v", "ffv1", ref); err != nil {
		t.Fatal(err)
	}
	return frameNumbers(t, ref)
}

func trimArgs(start, dur float64) map[string]string {
	// The site's trim settings (web/src/tools.ts).
	return map[string]string{"start": ftoa(start), "duration": ftoa(dur),
		"crf": "20", "preset": "veryfast", "audio_bitrate": "160k"}
}

// checkTrim trims, and checks the method, a clean decode, the duration and
// every frame against the reference.
func checkTrim(t *testing.T, in string, start, dur float64, wantMethod string) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "out.mp4")
	method, err := trimVideo(context.Background(), OpContext{Inputs: []string{in}, Output: out, Args: trimArgs(start, dur)})
	if err != nil {
		t.Fatalf("trim: %v", err)
	}
	if method != wantMethod {
		t.Fatalf("method: got %q, want %q", method, wantMethod)
	}
	if err := verifyTrim(context.Background(), out, dur); err != nil {
		t.Fatalf("output does not verify: %v", err)
	}
	// The audio, when the input has it, covers the clip.
	if a, _ := probeFields(context.Background(), in, "a:0", "stream=codec_type"); a["codec_type"] == "audio" {
		oa, err := probeFields(context.Background(), out, "a:0", "stream=duration")
		if err != nil || oa["duration"] == "" {
			t.Fatalf("output has no audio track")
		}
		var ad float64
		fmt.Sscan(oa["duration"], &ad)
		if ad < dur-0.1 || ad > dur+0.1 {
			t.Fatalf("audio is %.3f s, want %.3f s", ad, dur)
		}
	}
	got, want := frameNumbers(t, out), referenceNumbers(t, in, start, dur)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("frames differ from the frame-exact reference:\n%s", diffFrames(got, want))
	}
	return out
}

// diffFrames shows the first place where two frame sequences differ.
func diffFrames(got, want []int) string {
	n := len(got)
	if len(want) < n {
		n = len(want)
	}
	for i := 0; i < n; i++ {
		if got[i] != want[i] {
			lo, hi := max(0, i-3), min(n, i+4)
			return fmt.Sprintf("  first difference at output frame %d\n  got  %v\n  want %v\n  (%d vs %d frames)",
				i, got[lo:hi], want[lo:hi], len(got), len(want))
		}
	}
	return fmt.Sprintf("  same frames, but %d vs %d frames", len(got), len(want))
}

func TestSmartTrim_X264HighWithBFrames(t *testing.T) {
	needFFmpeg(t)
	in := makeInput(t, "high.mp4", "640x360", 40, "",
		"-c:v", "libx264", "-profile:v", "high", "-bf", "3", "-g", "60", "-keyint_min", "60",
		"-sc_threshold", "0", "-preset", "veryfast", "-crf", "20")
	checkTrim(t, in, 3.4, 30, "smart")
}

func TestSmartTrim_X264MainNoBFrames(t *testing.T) {
	needFFmpeg(t)
	in := makeInput(t, "main.mp4", "640x360", 40, "",
		"-c:v", "libx264", "-profile:v", "main", "-bf", "0", "-g", "90", "-preset", "veryfast", "-crf", "20")
	checkTrim(t, in, 5.05, 25, "smart")
}

func TestSmartTrim_LongKeyframeGap(t *testing.T) {
	needFFmpeg(t)
	// A keyframe every 10 s, as some screen recorders write.
	in := makeInput(t, "longgop.mp4", "640x360", 60, "",
		"-c:v", "libx264", "-g", "300", "-keyint_min", "300", "-sc_threshold", "0", "-preset", "veryfast", "-crf", "20")
	checkTrim(t, in, 2.5, 50, "smart")
}

func TestSmartTrim_VariableFrameRate(t *testing.T) {
	needFFmpeg(t)
	// Drop every fourth frame and keep the timestamps: irregular gaps, like
	// a screen recording that only writes when the screen changes.
	in := makeInput(t, "vfr.mp4", "640x360", 40, "select='not(eq(mod(n\\,4)\\,0))'",
		"-fps_mode", "vfr", "-c:v", "libx264", "-g", "45", "-preset", "veryfast", "-crf", "20")
	checkTrim(t, in, 4.2, 30, "smart")
}

func TestSmartTrim_NoAudio(t *testing.T) {
	needFFmpeg(t)
	in := filepath.Join(t.TempDir(), "silent.mp4")
	if err := ffmpegRun(context.Background(), "-f", "lavfi", "-i", stampedSource("640x360", 30, 30),
		"-c:v", "libx264", "-g", "60", "-preset", "veryfast", in); err != nil {
		t.Fatal(err)
	}
	checkTrim(t, in, 1.3, 25, "smart")
}

func TestSmartTrim_ShortClipKeepsTheFullPath(t *testing.T) {
	needFFmpeg(t)
	in := makeInput(t, "short.mp4", "640x360", 30, "", "-c:v", "libx264", "-g", "60", "-preset", "veryfast")
	checkTrim(t, in, 2, 10, "full")
}

func TestSmartTrim_HEVCKeepsTheFullPath(t *testing.T) {
	needFFmpeg(t)
	if out, _ := exec.Command("ffmpeg", "-hide_banner", "-encoders").Output(); !strings.Contains(string(out), "libx265") {
		t.Skip("no libx265")
	}
	in := makeInput(t, "hevc.mp4", "640x360", 40, "", "-c:v", "libx265", "-preset", "ultrafast", "-tag:v", "hvc1")
	checkTrim(t, in, 3, 30, "full")
}

func TestSmartTrim_FailedCheckFallsBackToAFullTrim(t *testing.T) {
	needFFmpeg(t)
	old := smartTrimVerify
	smartTrimVerify = func(context.Context, string, smartPlan) error { return fmt.Errorf("forced for the test") }
	defer func() { smartTrimVerify = old }()
	in := makeInput(t, "fallback.mp4", "640x360", 40, "", "-c:v", "libx264", "-g", "60", "-preset", "veryfast")
	checkTrim(t, in, 3.4, 30, "full-fallback")
}

func TestSmartTrim_IsMuchFasterThanAFullTrim(t *testing.T) {
	needFFmpeg(t)
	in := makeInput(t, "speed.mp4", "1280x720", 90, "", "-c:v", "libx264", "-g", "60", "-preset", "ultrafast")
	args := trimArgs(2.2, 80)

	t0 := time.Now()
	method, err := trimVideo(context.Background(), OpContext{Inputs: []string{in}, Output: filepath.Join(t.TempDir(), "smart.mp4"), Args: args})
	smart := time.Since(t0)
	if err != nil || method != "smart" {
		t.Fatalf("smart trim: method %q, err %v", method, err)
	}
	t0 = time.Now()
	if err := fullTrim(context.Background(), OpContext{Inputs: []string{in}, Output: filepath.Join(t.TempDir(), "full.mp4"), Args: args}); err != nil {
		t.Fatal(err)
	}
	full := time.Since(t0)
	t.Logf("80 s of 720p: smart %v, full %v", smart.Round(time.Millisecond), full.Round(time.Millisecond))
	// 2x on 80 s of 720p. The gap grows with the clip: the smart cut
	// encodes a few seconds whatever the length.
	if smart*2 > full {
		t.Fatalf("smart trim is not 2 times faster: smart %v, full %v", smart, full)
	}
}

func TestMain(m *testing.M) {
	// The tests write only in t.TempDir. Nothing here needs setup, but a
	// TestMain keeps "go test -run SmartTrim" output quiet about logs.
	os.Exit(m.Run())
}
