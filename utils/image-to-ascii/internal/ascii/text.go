package ascii

import (
	"fmt"
	"os"
	"regexp"
	"strings"
)

// Layer is text stamped on top of the frames. It shows from frame From to
// frame To. To < 0 means to the end.
type Layer struct {
	Text   string
	Anchor string
	From   int
	To     int
}

// Anchors lists the places a layer can sit.
var Anchors = []string{"center", "top-left", "top-right", "bottom-left", "bottom-right"}

// CheckLayer returns an error for a layer with no text or an unknown anchor.
func CheckLayer(l Layer) error {
	if l.Text == "" {
		return fmt.Errorf(`a text layer needs "text"`)
	}
	for _, a := range Anchors {
		if l.Anchor == a {
			return nil
		}
	}
	return fmt.Errorf("unknown anchor %q. Use one of: %s", l.Anchor, strings.Join(Anchors, ", "))
}

// FormatUptime writes seconds as "300d 2h 34m". Leading zero units are left
// out.
func FormatUptime(seconds float64) string {
	s := int64(seconds)
	if s < 0 {
		s = 0
	}
	d, h, m := s/86400, (s%86400)/3600, (s%3600)/60
	switch {
	case d > 0:
		return fmt.Sprintf("%dd %dh %dm", d, h, m)
	case h > 0:
		return fmt.Sprintf("%dh %dm", h, m)
	default:
		return fmt.Sprintf("%dm", m)
	}
}

// MachineVars returns the variables of the machine this runs on.
func MachineVars() map[string]string {
	host, _ := os.Hostname()
	host = strings.SplitN(host, ".", 2)[0]
	return map[string]string{"hostname": host, "uptime": FormatUptime(uptimeSeconds())}
}

var varPattern = regexp.MustCompile(`\{(\w+)\}`)

// FillVars replaces {name} with its value. A name with no value stays as
// written.
func FillVars(text string, vars map[string]string) string {
	return varPattern.ReplaceAllStringFunc(text, func(m string) string {
		if v, ok := vars[m[1:len(m)-1]]; ok {
			return v
		}
		return m
	})
}

// StampLayers writes the layers that show at frame over the frame's
// characters.
func StampLayers(frame string, layers []Layer, n int, vars map[string]string) string {
	lines := strings.Split(frame, "\n")
	rows := make([][]rune, len(lines))
	w := 0
	for i, l := range lines {
		rows[i] = []rune(l)
		if len(rows[i]) > w {
			w = len(rows[i])
		}
	}
	for i := range rows {
		for len(rows[i]) < w {
			rows[i] = append(rows[i], ' ')
		}
	}
	h := len(rows)
	for _, l := range layers {
		if n < l.From || (l.To >= 0 && n > l.To) {
			continue
		}
		text := []rune(FillVars(l.Text, vars))
		if len(text) > w {
			text = text[:w]
		}
		row := h / 2
		if strings.HasPrefix(l.Anchor, "top") {
			row = 0
		} else if strings.HasPrefix(l.Anchor, "bottom") {
			row = h - 1
		}
		col := (w - len(text)) / 2
		if strings.HasSuffix(l.Anchor, "left") {
			col = 0
		} else if strings.HasSuffix(l.Anchor, "right") {
			col = w - len(text)
		}
		copy(rows[row][col:], text)
	}
	out := make([]string, h)
	for i, r := range rows {
		out[i] = string(r)
	}
	return strings.Join(out, "\n")
}

// AddMargin pads a frame with n spaces on each side and n blank lines above
// and below.
func AddMargin(frame string, n int) string {
	if n < 1 {
		return frame
	}
	lines := strings.Split(frame, "\n")
	w := 0
	for _, l := range lines {
		if c := len([]rune(l)); c > w {
			w = c
		}
	}
	side := strings.Repeat(" ", n)
	blank := strings.Repeat(" ", w+2*n)
	out := make([]string, 0, len(lines)+2*n)
	for i := 0; i < n; i++ {
		out = append(out, blank)
	}
	for _, l := range lines {
		out = append(out, side+l+strings.Repeat(" ", w-len([]rune(l)))+side)
	}
	for i := 0; i < n; i++ {
		out = append(out, blank)
	}
	return strings.Join(out, "\n")
}

// Blank replaces every character of a frame with a space, and keeps the line
// breaks.
func Blank(frame string) string {
	lines := strings.Split(frame, "\n")
	for i, l := range lines {
		lines[i] = strings.Repeat(" ", len([]rune(l)))
	}
	return strings.Join(lines, "\n")
}
