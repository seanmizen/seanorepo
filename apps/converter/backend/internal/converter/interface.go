package converter

import "context"

// Options holds per-conversion parameters (e.g. video bitrate, quality level).
type Options map[string]string

// ProgressFunc is called with a percentage (0–100) as conversion proceeds.
type ProgressFunc func(pct int)

// Converter converts files from one format to another.
// Implementations must be safe for concurrent use.
type Converter interface {
	// Name returns a unique identifier, e.g. "ffmpeg".
	Name() string
	// AcceptsInput returns true if this converter can handle the given file extension (with dot).
	AcceptsInput(ext string) bool
	// OutputFormats returns the formats this converter can produce for the given input extension.
	OutputFormats(inputExt string) []string
	// Convert reads inputPath and writes outputPath in outputFormat.
	// It reports progress via progress (may be nil).
	// It must respect ctx cancellation.
	Convert(ctx context.Context, inputPath, outputPath, outputFormat string, opts Options, progress ProgressFunc) error
}
