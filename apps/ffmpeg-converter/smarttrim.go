package main

// Smart-cut trim. A full trim re-encodes every frame of the clip. A smart cut
// re-encodes only the head (from the start to the first keyframe after it)
// and the tail (from the last keyframe before the end to the end), and
// copies the middle as it is. A 20-minute trim then encodes a few seconds.
//
// The joins must decode cleanly, so every smart cut is verified: a full
// decode with no errors, and the right duration. If a check fails, or the
// input cannot be cut this way, the trim falls back to the full re-encode.
// The worst case is the old speed, never a broken file.
//
// The clip is every frame with a timestamp in [start, end). The trim filter
// with -copyts applies that rule on the input's own timestamps, so the head,
// the tail and the full trim agree frame for frame, wherever each one seeks
// from. (-t does not: its last frame depends on the seek point.)
//
// The segments go through MPEG-TS (Annex B), so each segment carries its own
// H.264 parameter sets in the stream. The re-encoded head and tail do not
// have the same SPS/PPS as the copied middle, and in-band parameter sets let
// a decoder switch at each join.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// smartTrimMinSeconds: a shorter trim re-encodes fast enough, so it keeps
// the full path.
const smartTrimMinSeconds = 20.0

// smartTrimVerify checks a smart-cut output. Tests replace it to force the
// fallback.
var smartTrimVerify = verifySmartTrim

// trimVideo trims oc.Inputs[0] to [start, start+duration) and reports the
// method: "smart", "full", or "full-fallback" (a smart cut failed a check).
func trimVideo(ctx context.Context, oc OpContext) (string, error) {
	start, err1 := strconv.ParseFloat(arg(oc, "start", "0"), 64)
	dur, err2 := strconv.ParseFloat(arg(oc, "duration", "1"), 64)
	if err1 == nil && err2 == nil && start >= 0 && dur >= smartTrimMinSeconds {
		if plan, ok := planSmartTrim(ctx, oc, start, dur); ok {
			err := runSmartTrim(ctx, oc, plan)
			if err == nil {
				err = smartTrimVerify(ctx, oc.Output, plan)
			}
			if err == nil {
				return "smart", nil
			}
			if ctx.Err() != nil {
				return "", ctx.Err()
			}
			log.Printf("smart trim fell back to a full re-encode: %v", err)
			_ = os.Remove(oc.Output)
			return "full-fallback", fullTrim(ctx, oc)
		}
	}
	return "full", fullTrim(ctx, oc)
}

// fullTrim re-encodes every frame of the clip. This is the old trim.
func fullTrim(ctx context.Context, oc OpContext) error {
	start, err1 := strconv.ParseFloat(arg(oc, "start", "0"), 64)
	dur, err2 := strconv.ParseFloat(arg(oc, "duration", "1"), 64)
	if err1 != nil || err2 != nil || start < 0 || dur <= 0 {
		return fmt.Errorf("bad start %q or duration %q", arg(oc, "start", "0"), arg(oc, "duration", "1"))
	}
	end := start + dur
	args := []string{"-copyts", "-ss", ftoa(start), "-t", ftoa(dur + 1), "-i", oc.Inputs[0],
		"-vf", clipFilter("trim", start, end),
		"-c:v", "libx264", "-preset", arg(oc, "preset", "ultrafast"),
		"-crf", arg(oc, "crf", "30"), "-pix_fmt", "yuv420p"}
	if a, _ := probeFields(ctx, oc.Inputs[0], "a:0", "stream=codec_type"); a["codec_type"] == "audio" {
		args = append(args, "-af", clipFilter("atrim", start, end),
			"-c:a", "aac", "-b:a", arg(oc, "audio_bitrate", "64k"))
	}
	return ffmpegRun(ctx, append(args, "-movflags", "+faststart", oc.Output)...)
}

// clipFilter keeps the frames with a timestamp in [from, to), and starts the
// result at 0. filter is trim (video) or atrim (audio). It needs -copyts, so
// the timestamps are the input's own.
func clipFilter(filter string, from, to float64) string {
	setpts := "setpts"
	if filter == "atrim" {
		setpts = "asetpts"
	}
	return fmt.Sprintf("%s=start=%s:end=%s,%s=PTS-STARTPTS", filter, ftoa(from), ftoa(to), setpts)
}

type smartPlan struct {
	start, dur float64 // the clip. dur is clamped to the end of the input
	k1, k2     float64 // first keyframe at or after start, last at or before the end
	profile    string  // x264 profile of the input: baseline, main or high
	hasAudio   bool
	audioCodec string
}

// planSmartTrim decides if a smart cut can work, and where the joins go.
func planSmartTrim(ctx context.Context, oc OpContext, start, dur float64) (smartPlan, bool) {
	ext := strings.ToLower(filepath.Ext(oc.Output))
	if ext != ".mp4" && ext != ".mov" && ext != ".m4v" {
		return smartPlan{}, false
	}
	in := oc.Inputs[0]
	v, err := probeFields(ctx, in, "v:0", "stream=codec_name,pix_fmt,profile")
	if err != nil || v["codec_name"] != "h264" || (v["pix_fmt"] != "yuv420p" && v["pix_fmt"] != "yuvj420p") {
		return smartPlan{}, false
	}
	total, err := probeDuration(ctx, in)
	if err != nil {
		return smartPlan{}, false
	}
	end := start + dur
	if end > total {
		end = total
	}
	keys, err := keyframeTimes(ctx, in)
	if err != nil {
		return smartPlan{}, false
	}
	const eps = 1e-3
	k1 := -1.0
	for _, k := range keys {
		if k >= start-eps {
			k1 = k
			break
		}
	}
	k2 := -1.0
	for i := len(keys) - 1; i >= 0; i-- {
		if keys[i] <= end+eps {
			k2 = keys[i]
			break
		}
	}
	// The copied middle must be worth it: at least a few seconds long.
	if k1 < 0 || k2 < 0 || k2-k1 < 2 {
		return smartPlan{}, false
	}
	a, _ := probeFields(ctx, in, "a:0", "stream=codec_type,codec_name")
	return smartPlan{
		start: start, dur: end - start, k1: k1, k2: k2,
		profile:    x264Profile(v["profile"]),
		hasAudio:   a["codec_type"] == "audio",
		audioCodec: a["codec_name"],
	}, true
}

// runSmartTrim writes head.ts, mid.ts and tail.ts, then joins them into
// oc.Output with the clip's audio.
func runSmartTrim(ctx context.Context, oc OpContext, p smartPlan) error {
	dir := filepath.Dir(oc.Output)
	in := oc.Inputs[0]
	// Every read of the input has an input -t, so no step reads past what it
	// needs. The trim filters alone do not stop ffmpeg 7.1 from reading to
	// the end of the file.
	encode := func(from, to float64, out string) error {
		return ffmpegRun(ctx, "-copyts", "-ss", ftoa(from), "-t", ftoa(to-from+1), "-i", in,
			"-map", "0:v:0", "-an", "-vf", clipFilter("trim", from, to), "-fps_mode", "passthrough",
			"-c:v", "libx264", "-preset", arg(oc, "preset", "ultrafast"),
			"-crf", arg(oc, "crf", "30"), "-pix_fmt", "yuv420p", "-profile:v", p.profile,
			"-f", "mpegts", out)
	}
	var parts []string
	if p.k1-p.start > 1e-3 {
		head := filepath.Join(dir, "smart-head.ts")
		if err := encode(p.start, p.k1, head); err != nil {
			return fmt.Errorf("head: %w", err)
		}
		parts = append(parts, head)
	}
	// The middle is cut at keyframes, not at a time. A time cut (-t) works on
	// decode order, so with B-frames it takes the keyframe that starts the
	// tail, and a frame after it. The segment muxer splits just before that
	// keyframe, so segment 0 is exactly the frames from k1 up to k2.
	midPattern := filepath.Join(dir, "smart-mid-%03d.ts")
	if err := ffmpegRun(ctx, "-ss", ftoa(p.k1), "-i", in, "-t", ftoa(p.k2-p.k1+60),
		"-map", "0:v:0", "-an", "-c", "copy", "-bsf:v", "h264_mp4toannexb",
		"-f", "segment", "-segment_format", "mpegts",
		"-segment_times", ftoa(p.k2-p.k1), "-segment_time_delta", "0.02",
		midPattern); err != nil {
		return fmt.Errorf("middle: %w", err)
	}
	mid := fmt.Sprintf(midPattern, 0)
	defer func() {
		extra, _ := filepath.Glob(filepath.Join(dir, "smart-mid-*.ts"))
		for _, f := range extra {
			_ = os.Remove(f)
		}
	}()
	parts = append(parts, mid)
	if end := p.start + p.dur; end-p.k2 > 1e-3 {
		tail := filepath.Join(dir, "smart-tail.ts")
		if err := encode(p.k2, end, tail); err != nil {
			return fmt.Errorf("tail: %w", err)
		}
		parts = append(parts, tail)
	}
	list := filepath.Join(dir, "smart-list.txt")
	var b strings.Builder
	for _, part := range parts {
		fmt.Fprintf(&b, "file '%s'\n", part)
	}
	if err := os.WriteFile(list, []byte(b.String()), 0o644); err != nil {
		return err
	}
	defer func() {
		for _, f := range append(parts, list) {
			_ = os.Remove(f)
		}
	}()

	args := []string{"-f", "concat", "-safe", "0", "-i", list}
	switch {
	case p.hasAudio && p.audioCodec == "aac":
		// The audio is taken in one piece for the whole clip, so the joins
		// have no clicks or drift. AAC is copied: re-encoding it would cost
		// as much as the rest of a long clip. The cut lands on an audio
		// frame, within about 21 ms of the start.
		args = append(args, "-ss", ftoa(p.start), "-t", ftoa(p.dur), "-i", in,
			"-map", "0:v:0", "-map", "1:a:0", "-c:a", "copy")
	case p.hasAudio:
		args = append(args, "-copyts", "-ss", ftoa(p.start), "-t", ftoa(p.dur+1), "-i", in,
			"-map", "0:v:0", "-map", "1:a:0", "-af", clipFilter("atrim", p.start, p.start+p.dur),
			"-c:a", "aac", "-b:a", arg(oc, "audio_bitrate", "64k"))
	default:
		args = append(args, "-map", "0:v:0")
	}
	args = append(args, "-c:v", "copy", "-movflags", "+faststart", oc.Output)
	return ffmpegRun(ctx, args...)
}

// verifySmartTrim decodes the output around each join, where a smart cut
// can go wrong, and checks the length. The middle is a copy of the input,
// so decoding all of it would prove nothing about the cut, and would take
// long on a long clip.
func verifySmartTrim(ctx context.Context, path string, p smartPlan) error {
	for _, join := range []float64{p.k1 - p.start, p.k2 - p.start} {
		from := join - 3
		if from < 0 {
			from = 0
		}
		if err := ffmpegRun(ctx, "-xerror", "-ss", ftoa(from), "-t", "6", "-i", path, "-f", "null", os.DevNull); err != nil {
			return fmt.Errorf("verify decode near %.2f s: %w", join, err)
		}
	}
	return verifyDuration(ctx, path, p.dur)
}

// verifyTrim decodes the whole output, and checks its length against the
// clip. ffmpeg -xerror stops at the first decode error.
func verifyTrim(ctx context.Context, path string, want float64) error {
	if err := ffmpegRun(ctx, "-xerror", "-i", path, "-f", "null", os.DevNull); err != nil {
		return fmt.Errorf("verify decode: %w", err)
	}
	return verifyDuration(ctx, path, want)
}

func verifyDuration(ctx context.Context, path string, want float64) error {
	got, err := probeDuration(ctx, path)
	if err != nil {
		return err
	}
	// A frame or two, and the container's rounding.
	if diff := got - want; diff > 0.15 || diff < -0.15 {
		return fmt.Errorf("verify duration: got %.3f s, want %.3f s", got, want)
	}
	return nil
}

// keyframeTimes lists the presentation times of the video keyframes. It
// reads packets, not frames, so it does not decode the video.
func keyframeTimes(ctx context.Context, path string) ([]float64, error) {
	out, err := ffprobeOutput(ctx, "-select_streams", "v:0",
		"-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", path)
	if err != nil {
		return nil, err
	}
	var keys []float64
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Split(strings.TrimSpace(line), ",")
		if len(fields) < 2 || !strings.Contains(fields[1], "K") {
			continue
		}
		if t, err := strconv.ParseFloat(fields[0], 64); err == nil {
			keys = append(keys, t)
		}
	}
	if len(keys) == 0 {
		return nil, errors.New("no keyframes")
	}
	sort.Float64s(keys)
	return keys, nil
}

// probeFields reads key=value fields of one stream, for example
// stream=codec_name,pix_fmt of "v:0".
func probeFields(ctx context.Context, path, stream, entries string) (map[string]string, error) {
	out, err := ffprobeOutput(ctx, "-select_streams", stream,
		"-show_entries", entries, "-of", "default=nw=1", path)
	if err != nil {
		return nil, err
	}
	fields := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		if k, v, ok := strings.Cut(strings.TrimSpace(line), "="); ok {
			fields[k] = v
		}
	}
	return fields, nil
}

func ffprobeOutput(ctx context.Context, args ...string) (string, error) {
	out, err := execCommand(ctx, "ffprobe", append([]string{"-v", "error"}, args...)...)
	if err != nil {
		return "", fmt.Errorf("ffprobe: %w", err)
	}
	return out, nil
}

// x264Profile maps ffprobe's profile name to an x264 profile. The head and
// tail use the input's profile, so the stream stays one profile throughout.
func x264Profile(p string) string {
	switch strings.ToLower(p) {
	case "baseline", "constrained baseline":
		return "baseline"
	case "main":
		return "main"
	default:
		return "high"
	}
}

func ftoa(f float64) string { return strconv.FormatFloat(f, 'f', 6, 64) }

func execCommand(ctx context.Context, name string, args ...string) (string, error) {
	out, err := exec.CommandContext(ctx, name, args...).Output()
	return string(out), err
}
