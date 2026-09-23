// Command image-to-ascii prints an image as ASCII art, or renders and plays
// an animation made from keyframes.
//
// Where: your computer, to try looks. A debbie machine, at SSH login.
// When:  on demand, or from the managed .zshrc at login.
// Why:   one standalone binary, with no runtime or node_modules on the machine.
//
// Run `image-to-ascii --help` for the flags.
package main

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/seanmizen/seanorepo/utils/image-to-ascii/internal/ascii"
)

const help = `image-to-ascii IMAGE [flags]

Image settings (the asciiart.eu sliders, with the site's defaults):
  --width 100          --brightness 100     --contrast 100
  --saturation 100     --sepia 0            --hue 0
  --grayscale 0        --invert 0           --spaceDensity 1
  --sharpen            --sharpness 9        (sharpness needs --sharpen)
  --edges              --edgeIntensity 1    (edgeIntensity needs --edges)
  --threshold N        (0-255, off by default)
  --dithering none|FloydSteinberg|JJN|Stucki|Atkinson
  --charset normal|minimalist|normal2|alphabetic|alphanumeric|numerical|
            extended|math|arrow|grayscale|codepage437|blockelement
  --chars STRING       your own characters, darkest first. Overrides --charset.
  --reverse            flip the charset, for a dark terminal

Animation:
  --key name=F:V,F:V,...   keyframes for one numeric setting. Repeat the flag
                           for more settings. Example: --key contrast=0:100,20:250
  --sweep name=A:B         shorthand: from A at frame 0 to B at the last frame
  --frames N               default: the last keyframe plus one
  --ease linear|smooth     default: linear
  --pingpong               play forward, then back
  --clear-from N           blank the image from frame N. Text layers stay.
  --margin N               N spaces around every frame
  --spec FILE.json         read all of the above from a file. Flags override it.
                           The file uses the flag names, flat. Only "keyframes"
                           and "text" are nested.

Text (in a --spec file only):
  "text": [{ "text": "{hostname}", "anchor": "bottom-left", "from": 20, "to": 60 }]
  Anchors: center, top-left, top-right, bottom-left, bottom-right.
  --var name=value         set a variable. {hostname} and {uptime} default to
                           this machine's values.

Output (an animation needs at least one):
  --out DIR                write frames as DIR/0000.txt, DIR/0001.txt, ...
  --play                   play the frames in this terminal
  --fps 30                 playback speed for --play
  --fit                    with --play, shrink the width to fit the terminal.
                           Skip playback if the terminal is too small.
  --hold                   with --play, keep the last frame until a key press
  Any key during --play shows the last frame and exits.
`

type args struct {
	image, spec, out, ease string
	options                map[string]any
	keys, sweeps           []string
	vars                   map[string]string
	frames, clearFrom      *int
	fps, margin            *float64
	play, pingpong, fit    bool
	hold, help             bool
}

// callerDir is the folder the user ran the command from. `yarn` sets INIT_CWD
// when it runs a script from another folder.
func callerDir() string {
	if d := os.Getenv("INIT_CWD"); d != "" {
		return d
	}
	d, _ := os.Getwd()
	return d
}

func fromCaller(p string) string {
	if p == "" || filepath.IsAbs(p) {
		return p
	}
	return filepath.Join(callerDir(), p)
}

func parseArgs(argv []string) (*args, error) {
	a := &args{options: map[string]any{}, vars: map[string]string{}}
	for i := 0; i < len(argv); i++ {
		tok := argv[i]
		if !strings.HasPrefix(tok, "--") {
			a.image = tok
			continue
		}
		name := tok[2:]
		switch name {
		case "play":
			a.play = true
			continue
		case "pingpong":
			a.pingpong = true
			continue
		case "fit":
			a.fit = true
			continue
		case "hold":
			a.hold = true
			continue
		case "help":
			a.help = true
			continue
		}
		if ascii.IsBool(name) {
			a.options[name] = true
			continue
		}
		if i+1 >= len(argv) {
			return nil, fmt.Errorf("--%s needs a value", name)
		}
		i++
		val := argv[i]
		switch {
		case name == "key":
			a.keys = append(a.keys, val)
		case name == "sweep":
			a.sweeps = append(a.sweeps, val)
		case name == "var":
			k, v, ok := strings.Cut(val, "=")
			if !ok || k == "" {
				return nil, fmt.Errorf("--var needs name=value, got %q", val)
			}
			a.vars[k] = v
		case name == "spec":
			a.spec = val
		case name == "out":
			a.out = val
		case name == "ease":
			a.ease = val
		case name == "frames" || name == "clear-from":
			n, err := strconv.Atoi(val)
			if err != nil {
				return nil, fmt.Errorf("--%s needs a whole number", name)
			}
			if name == "frames" {
				a.frames = &n
			} else {
				a.clearFrom = &n
			}
		case name == "fps" || name == "margin":
			f, err := strconv.ParseFloat(val, 64)
			if err != nil {
				return nil, fmt.Errorf("--%s needs a number", name)
			}
			if name == "fps" {
				a.fps = &f
			} else {
				a.margin = &f
			}
		case ascii.IsNumeric(name):
			f, err := strconv.ParseFloat(val, 64)
			if err != nil {
				return nil, fmt.Errorf("--%s needs a number", name)
			}
			a.options[name] = f
		case ascii.IsOption(name):
			a.options[name] = val
		default:
			return nil, fmt.Errorf("unknown flag --%s. Run with --help", name)
		}
	}
	a.image, a.spec, a.out = fromCaller(a.image), fromCaller(a.spec), fromCaller(a.out)
	return a, nil
}

func run() error {
	a, err := parseArgs(os.Args[1:])
	if err != nil {
		return err
	}
	if a.help {
		fmt.Print(help)
		return nil
	}
	spec := &ascii.Spec{Options: map[string]any{}, Tracks: map[string]ascii.Track{}, Vars: map[string]string{}}
	if a.spec != "" {
		if spec, err = ascii.ReadSpec(a.spec); err != nil {
			return err
		}
	}
	vars := ascii.MachineVars()
	for k, v := range spec.Vars {
		vars[k] = v
	}
	for k, v := range a.vars {
		vars[k] = v
	}

	image := a.image
	if image == "" {
		image = spec.Image
	}
	if image == "" {
		return fmt.Errorf(`no image. Pass IMAGE, or "image" in --spec`)
	}
	opts := ascii.Defaults()
	for _, src := range []map[string]any{spec.Options, a.options} {
		for k, v := range src {
			if err := opts.Set(k, v); err != nil {
				return err
			}
		}
	}

	tracks := map[string]ascii.Track{}
	for k, v := range spec.Tracks {
		tracks[k] = v
	}
	for _, text := range a.keys {
		name, rest, _ := strings.Cut(text, "=")
		t, err := ascii.ParseTrack(rest)
		if err != nil {
			return err
		}
		tracks[name] = t
	}
	frames := a.frames
	if frames == nil {
		frames = spec.Frames
	}
	for _, text := range a.sweeps {
		name, rng, _ := strings.Cut(text, "=")
		from, to, _ := strings.Cut(rng, ":")
		f, err1 := strconv.ParseFloat(from, 64)
		t, err2 := strconv.ParseFloat(to, 64)
		if err1 != nil || err2 != nil {
			return fmt.Errorf("bad --sweep %q: use name=from:to", text)
		}
		last := 59.0
		if frames != nil {
			last = float64(*frames - 1)
		}
		tracks[name] = ascii.Track{{0, f}, {last, t}}
	}
	for name := range tracks {
		if !ascii.IsNumeric(name) {
			return fmt.Errorf("%q is not a numeric setting, so it cannot have keyframes", name)
		}
	}

	img, err := ascii.Load(image)
	if err != nil {
		return err
	}
	margin := 0
	if a.margin != nil {
		margin = int(math.Max(0, math.Round(*a.margin)))
	} else if spec.Margin != nil {
		margin = int(math.Max(0, math.Round(*spec.Margin)))
	}
	if a.fit && a.play {
		cols, rows, ok := terminalSize()
		if !ok {
			return nil
		}
		// Rows are 0.55 * width / aspect. Keep one row free for the prompt.
		byRows := math.Floor(float64(rows-1-2*margin) / 0.55 * img.Aspect)
		width := math.Min(opts.Width, math.Min(float64(cols-2*margin), byRows))
		if width < 20 {
			return nil // too small to be worth showing
		}
		opts.Width = width
	}
	layered := func(frame string, n int) string {
		return ascii.AddMargin(ascii.StampLayers(frame, spec.Text, n, vars), margin)
	}

	if len(tracks) == 0 && !a.play {
		frame, err := img.Convert(opts)
		if err != nil {
			return err
		}
		fmt.Println(layered(frame, 0))
		return nil
	}

	easeName := a.ease
	if easeName == "" {
		easeName = spec.Ease
	}
	if easeName == "" {
		easeName = "linear"
	}
	ease, ok := ascii.Easings[easeName]
	if !ok {
		return fmt.Errorf("unknown ease %q: use linear or smooth", easeName)
	}
	lastText := 0
	for _, l := range spec.Text {
		if n := max(l.From, l.To) + 1; n > lastText {
			lastText = n
		}
	}
	count := 1
	if len(tracks) > 0 {
		count = ascii.FrameCount(tracks)
	}
	count = max(count, lastText)
	if frames != nil {
		count = *frames
	}
	clearFrom := a.clearFrom
	if clearFrom == nil {
		clearFrom = spec.ClearFrom
	}

	rendered := make([]string, 0, count)
	for f := 0; f < count; f++ {
		o := opts
		for name, t := range tracks {
			if err := o.Set(name, t.ValueAt(float64(f), ease)); err != nil {
				return err
			}
		}
		frame, err := img.Convert(o)
		if err != nil {
			return err
		}
		// From clearFrom on, the image is blank and only the text layers show.
		if clearFrom != nil && f >= *clearFrom {
			frame = ascii.Blank(frame)
		}
		rendered = append(rendered, layered(frame, f))
	}
	pingpong := a.pingpong || (spec.Pingpong != nil && *spec.Pingpong)
	if pingpong && len(rendered) > 2 {
		for i := len(rendered) - 2; i >= 1; i-- {
			rendered = append(rendered, rendered[i])
		}
	}

	out := a.out
	if out == "" {
		out = spec.Out
	}
	if out == "" && !a.play {
		return fmt.Errorf("an animation needs --out DIR, --play, or both")
	}
	if out != "" {
		if err := os.MkdirAll(out, 0o755); err != nil {
			return err
		}
		for i, frame := range rendered {
			name := filepath.Join(out, fmt.Sprintf("%04d.txt", i))
			if err := os.WriteFile(name, []byte(frame+"\n"), 0o644); err != nil {
				return err
			}
		}
		fmt.Fprintf(os.Stderr, "wrote %d frames to %s\n", len(rendered), out)
	}
	if a.play {
		fps := 30.0
		if spec.FPS != nil {
			fps = *spec.FPS
		}
		if a.fps != nil {
			fps = *a.fps
		}
		hold := a.hold || (spec.Hold != nil && *spec.Hold)
		play(rendered, fps, hold)
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "image-to-ascii: %v\n", err)
		os.Exit(1)
	}
}
