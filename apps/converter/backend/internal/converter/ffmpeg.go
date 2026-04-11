package converter

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

var videoFormats = []string{"mp4", "webm", "mkv", "avi", "mov", "flv", "gif"}
var audioFormats = []string{"mp3", "aac", "ogg", "flac", "wav", "opus", "m4a"}
var imageFormats = []string{"jpg", "jpeg", "png", "webp", "avif", "bmp", "tiff"}

func mediaType(ext string) string {
	ext = strings.ToLower(strings.TrimPrefix(ext, "."))
	for _, f := range videoFormats {
		if ext == f {
			return "video"
		}
	}
	for _, f := range audioFormats {
		if ext == f {
			return "audio"
		}
	}
	for _, f := range imageFormats {
		if ext == f {
			return "image"
		}
	}
	return ""
}

// FFmpegConverter wraps the system ffmpeg binary.
type FFmpegConverter struct{}

func NewFFmpegConverter() *FFmpegConverter { return &FFmpegConverter{} }

func (c *FFmpegConverter) Name() string { return "ffmpeg" }

func (c *FFmpegConverter) AcceptsInput(ext string) bool {
	return mediaType(ext) != ""
}

func (c *FFmpegConverter) OutputFormats(inputExt string) []string {
	switch mediaType(inputExt) {
	case "video":
		return videoFormats
	case "audio":
		return audioFormats
	case "image":
		return imageFormats
	}
	return nil
}

func (c *FFmpegConverter) Convert(
	ctx context.Context,
	inputPath, outputPath, outputFormat string,
	_ Options,
	progress ProgressFunc,
) error {
	// Get total duration upfront for progress calculation (best-effort).
	totalSec, _ := probeDuration(ctx, inputPath)

	args := []string{
		"-hide_banner", "-loglevel", "quiet",
		"-progress", "pipe:2", // structured progress → stderr
		"-i", inputPath,
		"-y", // overwrite output without prompting
	}

	// Format-specific encoding presets.
	switch strings.ToLower(outputFormat) {
	case "mp4":
		args = append(args, "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-c:a", "aac")
	case "webm":
		args = append(args, "-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-c:a", "libopus")
	case "mkv":
		args = append(args, "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-c:a", "aac")
	case "gif":
		args = append(args,
			"-vf", "fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
		)
	case "mp3":
		args = append(args, "-c:a", "libmp3lame", "-q:a", "2")
	case "ogg":
		args = append(args, "-c:a", "libvorbis", "-q:a", "4")
	case "opus":
		args = append(args, "-c:a", "libopus", "-b:a", "128k")
	case "flac":
		args = append(args, "-c:a", "flac")
	case "wav":
		args = append(args, "-c:a", "pcm_s16le")
	}

	args = append(args, outputPath)

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)

	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("pipe stderr: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start ffmpeg: %w", err)
	}

	// Parse progress lines from stderr.
	go func() {
		scanner := bufio.NewScanner(stderrPipe)
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "out_time_us=") {
				continue
			}
			if progress == nil || totalSec <= 0 {
				continue
			}
			us, err := strconv.ParseInt(strings.TrimPrefix(line, "out_time_us="), 10, 64)
			if err != nil {
				continue
			}
			pct := int(float64(us) / float64(totalSec*1_000_000) * 100)
			if pct < 0 {
				pct = 0
			}
			if pct > 99 {
				pct = 99 // 100 is set by the caller on success
			}
			progress(pct)
		}
	}()

	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("ffmpeg: %w", err)
	}
	return nil
}

// probeDuration returns the total duration in seconds of a media file via ffprobe.
func probeDuration(ctx context.Context, path string) (float64, error) {
	ctx2, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx2, "ffprobe",
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "csv=p=0",
		path,
	).Output()
	if err != nil {
		return 0, err
	}
	return strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
}

// MIMEType returns the Content-Type for a given file extension (with or without dot).
func MIMEType(ext string) string {
	switch strings.ToLower(strings.TrimPrefix(ext, ".")) {
	case "mp4":
		return "video/mp4"
	case "webm":
		return "video/webm"
	case "mkv":
		return "video/x-matroska"
	case "avi":
		return "video/x-msvideo"
	case "mov":
		return "video/quicktime"
	case "flv":
		return "video/x-flv"
	case "gif":
		return "image/gif"
	case "mp3":
		return "audio/mpeg"
	case "aac":
		return "audio/aac"
	case "ogg":
		return "audio/ogg"
	case "flac":
		return "audio/flac"
	case "wav":
		return "audio/wav"
	case "opus":
		return "audio/opus"
	case "m4a":
		return "audio/mp4"
	case "jpg", "jpeg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "webp":
		return "image/webp"
	case "avif":
		return "image/avif"
	case "bmp":
		return "image/bmp"
	case "tiff":
		return "image/tiff"
	}
	return "application/octet-stream"
}

// OutputExt returns the canonical file extension (with dot) for an output format name.
func OutputExt(format string) string {
	switch strings.ToLower(format) {
	case "jpeg":
		return ".jpg"
	default:
		return "." + strings.ToLower(format)
	}
}
