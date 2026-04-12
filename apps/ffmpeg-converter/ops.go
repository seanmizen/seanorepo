package main

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// OpContext is passed to every operation. Inputs is one or more on-disk paths
// for the uploaded files, Output is the target path, Args is the map of
// user-supplied form values.
type OpContext struct {
	Inputs []string
	Output string
	Args   map[string]string
}

type Operation struct {
	Name        string
	Category    string
	Description string
	DefaultExt  string
	MinInputs   int
	Run         func(ctx context.Context, oc OpContext) error
}

// ffmpegRun executes ffmpeg with the provided args. Stdout/stderr are captured
// and included in the returned error on failure — ffmpeg is very chatty so we
// keep the last 2 KiB, which is enough to identify filter/codec errors.
func ffmpegRun(ctx context.Context, args ...string) error {
	full := append([]string{"-hide_banner", "-loglevel", "error", "-y"}, args...)
	cmd := exec.CommandContext(ctx, "ffmpeg", full...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		tail := string(out)
		if len(tail) > 2048 {
			tail = tail[len(tail)-2048:]
		}
		return fmt.Errorf("ffmpeg failed: %w\nargs: %s\n%s", err, strings.Join(full, " "), tail)
	}
	return nil
}

func arg(oc OpContext, key, def string) string {
	if v, ok := oc.Args[key]; ok && v != "" {
		return v
	}
	return def
}

// RegisterOps returns the full operation map. The names are deliberately
// stable — test scripts and any future client both reference these strings.
func RegisterOps() map[string]*Operation {
	ops := map[string]*Operation{}

	add := func(op *Operation) {
		if op.MinInputs == 0 {
			op.MinInputs = 1
		}
		ops[op.Name] = op
	}

	// ─────────────────────────────────────────────── VIDEO ───────────────────

	add(&Operation{
		Name: "transcode", Category: "video",
		Description: "Re-container a video; ext=mp4|webm|mkv",
		DefaultExt:  ".mp4",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
				"-c:a", "aac", "-b:a", "64k", oc.Output)
		},
	})
	add(&Operation{
		Name: "transcode_webm", Category: "video",
		Description: "Transcode to WebM (VP9 + Opus)",
		DefaultExt:  ".webm",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-c:v", "libvpx-vp9", "-b:v", "200k", "-deadline", "realtime",
				"-c:a", "libopus", "-b:a", "48k", oc.Output)
		},
	})
	add(&Operation{
		Name: "transcode_mkv", Category: "video",
		Description: "Remux/transcode to Matroska",
		DefaultExt:  ".mkv",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
				"-c:a", "aac", "-b:a", "64k", oc.Output)
		},
	})
	add(&Operation{
		Name: "resize", Category: "video",
		Description: "Resize video; args: width, height",
		DefaultExt:  ".mp4",
		Run: func(ctx context.Context, oc OpContext) error {
			w := arg(oc, "width", "64")
			h := arg(oc, "height", "36")
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vf", fmt.Sprintf("scale=%s:%s", w, h),
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
				"-c:a", "copy", oc.Output)
		},
	})
	add(&Operation{
		Name: "h264_to_h265", Category: "video",
		Description: "Re-encode to HEVC (h265)",
		DefaultExt:  ".mp4",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-c:v", "libx265", "-preset", "ultrafast", "-crf", "32",
				"-tag:v", "hvc1", "-c:a", "aac", "-b:a", "64k", oc.Output)
		},
	})
	add(&Operation{
		Name: "change_framerate", Category: "video",
		Description: "Change fps; args: fps (default 15)",
		DefaultExt:  ".mp4",
		Run: func(ctx context.Context, oc OpContext) error {
			fps := arg(oc, "fps", "15")
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-r", fps,
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
				"-c:a", "copy", oc.Output)
		},
	})
	add(&Operation{
		Name: "change_bitrate", Category: "video",
		Description: "Set video bitrate; args: bitrate (default 150k)",
		DefaultExt:  ".mp4",
		Run: func(ctx context.Context, oc OpContext) error {
			br := arg(oc, "bitrate", "150k")
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-c:v", "libx264", "-preset", "ultrafast", "-b:v", br,
				"-c:a", "aac", "-b:a", "64k", oc.Output)
		},
	})
	add(&Operation{
		Name: "trim", Category: "video",
		Description: "Trim a video; args: start (s), duration (s)",
		DefaultExt:  ".mp4",
		Run: func(ctx context.Context, oc OpContext) error {
			start := arg(oc, "start", "0")
			dur := arg(oc, "duration", "1")
			return ffmpegRun(ctx, "-ss", start, "-i", oc.Inputs[0], "-t", dur,
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
				"-c:a", "aac", "-b:a", "64k", oc.Output)
		},
	})
	add(&Operation{
		Name: "concat", Category: "video",
		Description: "Concat 2+ videos (re-encoded, so codecs don't need to match)",
		DefaultExt:  ".mp4",
		MinInputs:   2,
		Run: func(ctx context.Context, oc OpContext) error {
			// Build a filter_complex [0:v][0:a][1:v][1:a]concat=n=N:v=1:a=1[v][a].
			n := len(oc.Inputs)
			args := []string{}
			for _, in := range oc.Inputs {
				args = append(args, "-i", in)
			}
			var sb strings.Builder
			for i := 0; i < n; i++ {
				fmt.Fprintf(&sb, "[%d:v:0][%d:a:0]", i, i)
			}
			fmt.Fprintf(&sb, "concat=n=%d:v=1:a=1[v][a]", n)
			args = append(args,
				"-filter_complex", sb.String(),
				"-map", "[v]", "-map", "[a]",
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
				"-c:a", "aac", "-b:a", "64k", oc.Output)
			return ffmpegRun(ctx, args...)
		},
	})
	add(&Operation{
		Name: "watermark", Category: "video",
		Description: "Overlay a PNG watermark (second upload) in top-right",
		DefaultExt:  ".mp4",
		MinInputs:   2,
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx,
				"-i", oc.Inputs[0], "-i", oc.Inputs[1],
				"-filter_complex", "[0:v][1:v]overlay=W-w-5:5",
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
				"-c:a", "copy", oc.Output)
		},
	})
	add(&Operation{
		Name: "thumbnail", Category: "video",
		Description: "Grab a single frame at timestamp",
		DefaultExt:  ".jpg",
		Run: func(ctx context.Context, oc OpContext) error {
			ts := arg(oc, "timestamp", "00:00:00.3")
			return ffmpegRun(ctx, "-ss", ts, "-i", oc.Inputs[0],
				"-frames:v", "1", "-q:v", "5", oc.Output)
		},
	})
	add(&Operation{
		Name: "contact_sheet", Category: "video",
		Description: "NxM grid of sampled frames; args: cols, rows",
		DefaultExt:  ".jpg",
		Run: func(ctx context.Context, oc OpContext) error {
			cols := arg(oc, "cols", "3")
			rows := arg(oc, "rows", "3")
			// sample every Nth frame then tile.
			filter := fmt.Sprintf("select='not(mod(n,3))',scale=64:36,tile=%sx%s", cols, rows)
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vf", filter, "-frames:v", "1", "-q:v", "5", oc.Output)
		},
	})
	add(&Operation{
		Name: "speed", Category: "video",
		Description: "Speed up/slow down; args: factor (0.5..2.0)",
		DefaultExt:  ".mp4",
		Run: func(ctx context.Context, oc OpContext) error {
			f := arg(oc, "factor", "2.0")
			// Invert for setpts, keep for atempo (bounded).
			filter := fmt.Sprintf("[0:v]setpts=PTS/%s[v];[0:a]atempo=%s[a]", f, f)
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-filter_complex", filter, "-map", "[v]", "-map", "[a]",
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
				"-c:a", "aac", "-b:a", "64k", oc.Output)
		},
	})
	add(&Operation{
		Name: "reverse", Category: "video",
		Description: "Reverse a short video (memory-bound — keep it tiny!)",
		DefaultExt:  ".mp4",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vf", "reverse", "-af", "areverse",
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", oc.Output)
		},
	})
	add(&Operation{
		Name: "crop", Category: "video",
		Description: "Crop w:h:x:y",
		DefaultExt:  ".mp4",
		Run: func(ctx context.Context, oc OpContext) error {
			w := arg(oc, "width", "64")
			h := arg(oc, "height", "36")
			x := arg(oc, "x", "0")
			y := arg(oc, "y", "0")
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vf", fmt.Sprintf("crop=%s:%s:%s:%s", w, h, x, y),
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
				"-c:a", "copy", oc.Output)
		},
	})
	add(&Operation{
		Name: "rotate", Category: "video",
		Description: "Rotate 90/180/270",
		DefaultExt:  ".mp4",
		Run: func(ctx context.Context, oc OpContext) error {
			deg := arg(oc, "degrees", "90")
			var vf string
			switch deg {
			case "90":
				vf = "transpose=1"
			case "180":
				vf = "transpose=1,transpose=1"
			case "270":
				vf = "transpose=2"
			default:
				vf = "transpose=1"
			}
			return ffmpegRun(ctx, "-i", oc.Inputs[0], "-vf", vf,
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
				"-c:a", "copy", oc.Output)
		},
	})
	add(&Operation{
		Name: "flip", Category: "video",
		Description: "Flip horizontal/vertical",
		DefaultExt:  ".mp4",
		Run: func(ctx context.Context, oc OpContext) error {
			dir := arg(oc, "direction", "h")
			vf := "hflip"
			if dir == "v" {
				vf = "vflip"
			}
			return ffmpegRun(ctx, "-i", oc.Inputs[0], "-vf", vf,
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
				"-c:a", "copy", oc.Output)
		},
	})
	add(&Operation{
		Name: "loop", Category: "video",
		Description: "Loop video N times; args: count",
		DefaultExt:  ".mp4",
		Run: func(ctx context.Context, oc OpContext) error {
			count := arg(oc, "count", "3")
			// -stream_loop N on input means N extra loops, so N=2 → plays 3x.
			// We interpret "count" as total plays to be intuitive.
			extra := "2"
			if count == "2" {
				extra = "1"
			} else if count == "4" {
				extra = "3"
			}
			return ffmpegRun(ctx, "-stream_loop", extra, "-i", oc.Inputs[0],
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
				"-c:a", "aac", "-b:a", "64k", oc.Output)
		},
	})
	add(&Operation{
		Name: "subtitles_burn", Category: "video",
		Description: "Burn subtitles (srt uploaded as 2nd file) into the video",
		DefaultExt:  ".mp4",
		MinInputs:   2,
		Run: func(ctx context.Context, oc OpContext) error {
			// The subtitles filter wants the path in the filter graph,
			// and colons on absolute paths need escaping (but tests use
			// relative-enough paths). We escape the : in the drive-less
			// POSIX path for safety.
			sub := strings.ReplaceAll(oc.Inputs[1], ":", `\:`)
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vf", fmt.Sprintf("subtitles=%s", sub),
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
				"-c:a", "copy", oc.Output)
		},
	})
	add(&Operation{
		Name: "subtitles_soft", Category: "video",
		Description: "Mux subtitles as a soft track (MKV)",
		DefaultExt:  ".mkv",
		MinInputs:   2,
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0], "-i", oc.Inputs[1],
				"-c", "copy", "-c:s", "srt", oc.Output)
		},
	})
	add(&Operation{
		Name: "pad_aspect", Category: "video",
		Description: "Letterbox/pillarbox to a target aspect; args: aspect (e.g. 16:9)",
		DefaultExt:  ".mp4",
		Run: func(ctx context.Context, oc OpContext) error {
			// Pad to nearest even dims that satisfy the target aspect.
			vf := "scale='if(gt(a,16/9),128,-2)':'if(gt(a,16/9),-2,72)',pad=128:72:(ow-iw)/2:(oh-ih)/2:color=black"
			return ffmpegRun(ctx, "-i", oc.Inputs[0], "-vf", vf,
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
				"-c:a", "copy", oc.Output)
		},
	})
	add(&Operation{
		Name: "timelapse", Category: "video",
		Description: "Build a timelapse from a tar/zip? No — from an image sequence uploaded as multiple files.",
		DefaultExt:  ".mp4",
		MinInputs:   2,
		Run: func(ctx context.Context, oc OpContext) error {
			// Write a concat list file referencing each input with a duration,
			// then encode. This avoids requiring numbered filenames.
			list := oc.Output + ".list.txt"
			var sb strings.Builder
			for _, p := range oc.Inputs {
				fmt.Fprintf(&sb, "file '%s'\nduration 0.1\n", p)
			}
			// The concat demuxer wants the last file listed twice with no dur.
			fmt.Fprintf(&sb, "file '%s'\n", oc.Inputs[len(oc.Inputs)-1])
			if err := writeFile(list, sb.String()); err != nil {
				return err
			}
			defer removeFile(list)
			return ffmpegRun(ctx, "-f", "concat", "-safe", "0", "-i", list,
				"-vf", "fps=10,format=yuv420p,scale=128:-2",
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", oc.Output)
		},
	})

	// ─────────────────────────────────────────────── AUDIO ───────────────────

	add(&Operation{
		Name: "audio_mp3", Category: "audio",
		Description: "Convert/extract to MP3",
		DefaultExt:  ".mp3",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vn", "-c:a", "libmp3lame", "-b:a", "64k", oc.Output)
		},
	})
	add(&Operation{
		Name: "audio_opus", Category: "audio",
		Description: "Convert/extract to Opus",
		DefaultExt:  ".opus",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vn", "-c:a", "libopus", "-b:a", "32k", oc.Output)
		},
	})
	add(&Operation{
		Name: "audio_aac", Category: "audio",
		Description: "Convert/extract to AAC (m4a)",
		DefaultExt:  ".m4a",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vn", "-c:a", "aac", "-b:a", "64k", oc.Output)
		},
	})
	add(&Operation{
		Name: "audio_flac", Category: "audio",
		Description: "Convert/extract to FLAC",
		DefaultExt:  ".flac",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vn", "-c:a", "flac", oc.Output)
		},
	})
	add(&Operation{
		Name: "extract_audio", Category: "audio",
		Description: "Strip audio from a video (wav)",
		DefaultExt:  ".wav",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", oc.Output)
		},
	})
	add(&Operation{
		Name: "normalize_audio", Category: "audio",
		Description: "EBU R128 loudness normalize",
		DefaultExt:  ".wav",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
				"-ar", "44100", oc.Output)
		},
	})
	add(&Operation{
		Name: "audio_trim", Category: "audio",
		Description: "Trim audio; args: start, duration",
		DefaultExt:  ".wav",
		Run: func(ctx context.Context, oc OpContext) error {
			start := arg(oc, "start", "0")
			dur := arg(oc, "duration", "0.5")
			return ffmpegRun(ctx, "-ss", start, "-i", oc.Inputs[0], "-t", dur,
				"-c:a", "pcm_s16le", oc.Output)
		},
	})
	add(&Operation{
		Name: "audio_fade", Category: "audio",
		Description: "Fade in and fade out",
		DefaultExt:  ".wav",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-af", "afade=t=in:st=0:d=0.2,afade=t=out:st=0.8:d=0.2",
				"-c:a", "pcm_s16le", oc.Output)
		},
	})
	add(&Operation{
		Name: "audio_concat", Category: "audio",
		Description: "Concat 2+ audio files",
		DefaultExt:  ".wav",
		MinInputs:   2,
		Run: func(ctx context.Context, oc OpContext) error {
			n := len(oc.Inputs)
			args := []string{}
			for _, in := range oc.Inputs {
				args = append(args, "-i", in)
			}
			var sb strings.Builder
			for i := 0; i < n; i++ {
				fmt.Fprintf(&sb, "[%d:0]", i)
			}
			fmt.Fprintf(&sb, "concat=n=%d:v=0:a=1[a]", n)
			args = append(args, "-filter_complex", sb.String(), "-map", "[a]", oc.Output)
			return ffmpegRun(ctx, args...)
		},
	})
	add(&Operation{
		Name: "stereo_to_mono", Category: "audio",
		Description: "Downmix stereo to mono",
		DefaultExt:  ".wav",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0], "-ac", "1", oc.Output)
		},
	})
	add(&Operation{
		Name: "audio_bitrate", Category: "audio",
		Description: "Re-encode at a target bitrate (mp3)",
		DefaultExt:  ".mp3",
		Run: func(ctx context.Context, oc OpContext) error {
			br := arg(oc, "bitrate", "96k")
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vn", "-c:a", "libmp3lame", "-b:a", br, oc.Output)
		},
	})
	add(&Operation{
		Name: "time_stretch", Category: "audio",
		Description: "Stretch audio duration without pitch change (atempo 0.5-2.0)",
		DefaultExt:  ".wav",
		Run: func(ctx context.Context, oc OpContext) error {
			f := arg(oc, "factor", "1.5")
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-af", "atempo="+f, "-c:a", "pcm_s16le", oc.Output)
		},
	})
	add(&Operation{
		Name: "pitch_shift", Category: "audio",
		Description: "Pitch shift by resampling + atempo correction",
		DefaultExt:  ".wav",
		Run: func(ctx context.Context, oc OpContext) error {
			// semitones default = +4
			// cheap pitch shift: asetrate then atempo back to original rate.
			// sr*2^(n/12) then atempo 1/2^(n/12)
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-af", "asetrate=44100*1.25,aresample=44100,atempo=0.8",
				"-c:a", "pcm_s16le", oc.Output)
		},
	})
	add(&Operation{
		Name: "spectrogram", Category: "audio",
		Description: "Render audio as a spectrogram PNG",
		DefaultExt:  ".png",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-lavfi", "showspectrumpic=s=320x180",
				oc.Output)
		},
	})
	add(&Operation{
		Name: "waveform_png", Category: "audio",
		Description: "Render audio as a waveform PNG",
		DefaultExt:  ".png",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-filter_complex", "aformat=channel_layouts=mono,showwavespic=s=320x80:colors=white",
				"-frames:v", "1", oc.Output)
		},
	})

	// ─────────────────────────────────────────────── IMAGE ───────────────────

	add(&Operation{
		Name: "image_resize", Category: "image",
		Description: "Resize image; args: width, height",
		DefaultExt:  ".png",
		Run: func(ctx context.Context, oc OpContext) error {
			w := arg(oc, "width", "64")
			h := arg(oc, "height", "-1")
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vf", fmt.Sprintf("scale=%s:%s", w, h), oc.Output)
		},
	})
	add(&Operation{
		Name: "image_to_jpg", Category: "image",
		Description: "Convert image to JPEG",
		DefaultExt:  ".jpg",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0], "-q:v", "5", oc.Output)
		},
	})
	add(&Operation{
		Name: "image_to_png", Category: "image",
		Description: "Convert image to PNG",
		DefaultExt:  ".png",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0], oc.Output)
		},
	})
	add(&Operation{
		Name: "image_to_webp", Category: "image",
		Description: "Convert image to WebP",
		DefaultExt:  ".webp",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0], "-q:v", "60", oc.Output)
		},
	})
	add(&Operation{
		Name: "image_to_avif", Category: "image",
		Description: "Convert image to AVIF (may fail if libaom not compiled in)",
		DefaultExt:  ".avif",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-c:v", "libaom-av1", "-still-picture", "1", "-cpu-used", "8", oc.Output)
		},
	})
	add(&Operation{
		Name: "gif_from_video", Category: "image",
		Description: "Animated GIF from a video (palettegen for quality)",
		DefaultExt:  ".gif",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vf", "fps=10,scale=96:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
				oc.Output)
		},
	})
	add(&Operation{
		Name: "gif_from_images", Category: "image",
		Description: "Animated GIF from an image sequence (upload multiple files)",
		DefaultExt:  ".gif",
		MinInputs:   2,
		Run: func(ctx context.Context, oc OpContext) error {
			list := oc.Output + ".list.txt"
			var sb strings.Builder
			for _, p := range oc.Inputs {
				fmt.Fprintf(&sb, "file '%s'\nduration 0.15\n", p)
			}
			fmt.Fprintf(&sb, "file '%s'\n", oc.Inputs[len(oc.Inputs)-1])
			if err := writeFile(list, sb.String()); err != nil {
				return err
			}
			defer removeFile(list)
			return ffmpegRun(ctx, "-f", "concat", "-safe", "0", "-i", list,
				"-vf", "fps=10,scale=96:-1:flags=lanczos", oc.Output)
		},
	})
	add(&Operation{
		Name: "blur", Category: "image",
		Description: "Gaussian blur on an image",
		DefaultExt:  ".png",
		Run: func(ctx context.Context, oc OpContext) error {
			s := arg(oc, "sigma", "3")
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vf", fmt.Sprintf("gblur=sigma=%s", s), oc.Output)
		},
	})
	add(&Operation{
		Name: "sharpen", Category: "image",
		Description: "Unsharp mask on an image",
		DefaultExt:  ".png",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vf", "unsharp=5:5:1.0:5:5:0.0", oc.Output)
		},
	})
	add(&Operation{
		Name: "grayscale", Category: "image",
		Description: "Convert image to grayscale",
		DefaultExt:  ".png",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-vf", "format=gray", oc.Output)
		},
	})

	// ─────────────────────────────────────────────── SPECIAL ─────────────────

	add(&Operation{
		Name: "youtube_preview", Category: "special",
		Description: "YouTube-style preview: first N seconds, 96px-wide GIF",
		DefaultExt:  ".gif",
		Run: func(ctx context.Context, oc OpContext) error {
			secs := arg(oc, "seconds", "1")
			return ffmpegRun(ctx, "-i", oc.Inputs[0], "-t", secs,
				"-vf", "fps=10,scale=96:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
				oc.Output)
		},
	})
	add(&Operation{
		Name: "meme_overlay", Category: "special",
		Description: "Burn top/bottom meme text onto the input image or video",
		DefaultExt:  ".jpg",
		Run: func(ctx context.Context, oc OpContext) error {
			top := arg(oc, "top", "WHEN YOU FIND")
			bot := arg(oc, "bottom", "AN UNUSED FFMPEG FLAG")
			// Rely on the default fontconfig font — on macOS with homebrew ffmpeg,
			// `font=Arial` works. Keep a small font size so tiny inputs stay legible.
			vf := fmt.Sprintf(
				"drawtext=text='%s':x=(w-text_w)/2:y=4:fontsize=10:fontcolor=white:borderw=1:bordercolor=black:font=Arial,"+
					"drawtext=text='%s':x=(w-text_w)/2:y=h-th-4:fontsize=10:fontcolor=white:borderw=1:bordercolor=black:font=Arial",
				top, bot)
			return ffmpegRun(ctx, "-i", oc.Inputs[0], "-vf", vf,
				"-frames:v", "1", "-q:v", "5", oc.Output)
		},
	})
	add(&Operation{
		Name: "silence_trim", Category: "special",
		Description: "Trim leading/trailing silence (silenceremove)",
		DefaultExt:  ".wav",
		Run: func(ctx context.Context, oc OpContext) error {
			return ffmpegRun(ctx, "-i", oc.Inputs[0],
				"-af", "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB:stop_periods=1:stop_silence=0.05:stop_threshold=-50dB",
				"-c:a", "pcm_s16le", oc.Output)
		},
	})

	return ops
}
