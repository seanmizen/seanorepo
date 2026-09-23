package ascii

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
)

// Spec is a spec file: the flags, flat, with the same names. keyframes and
// text are the only nested keys. Paths are relative to the file.
type Spec struct {
	Image     string
	Options   map[string]any // setting name -> float64, string or bool
	Tracks    map[string]Track
	Text      []Layer
	Vars      map[string]string
	Frames    *int
	FPS       *float64
	Ease      string
	Pingpong  *bool
	Hold      *bool
	ClearFrom *int
	Margin    *float64
	Out       string
}

// specKeys are the keys a spec may hold beside the settings.
var specKeys = []string{
	"image", "keyframes", "text", "vars", "frames", "fps", "ease",
	"pingpong", "hold", "clearFrom", "margin", "out",
}

// ReadSpec reads and checks a spec file.
func ReadSpec(path string) (*Spec, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if _, ok := raw["options"]; ok {
		return nil, fmt.Errorf(`%s: "options" is gone. Move its keys to the top level of the spec`, path)
	}
	for k := range raw {
		if !IsOption(k) && !contains(specKeys, k) {
			return nil, fmt.Errorf("%s: unknown key %q. Valid keys: %s", path, k,
				strings.Join(append(append([]string{}, OptionNames...), specKeys...), ", "))
		}
	}
	base := filepath.Dir(path)
	rel := func(p string) string {
		if p == "" || filepath.IsAbs(p) {
			return p
		}
		return filepath.Join(base, p)
	}

	s := &Spec{Options: map[string]any{}, Tracks: map[string]Track{}, Vars: map[string]string{}}
	for k, v := range raw {
		if IsOption(k) {
			s.Options[k] = v
		}
	}
	if v, ok := raw["image"].(string); ok {
		s.Image = rel(v)
	}
	if v, ok := raw["out"].(string); ok {
		s.Out = rel(v)
	}
	if v, ok := raw["ease"].(string); ok {
		s.Ease = v
	}
	if kf, ok := raw["keyframes"].(map[string]any); ok {
		for name, v := range kf {
			t, err := TrackFromJSON(v)
			if err != nil {
				return nil, fmt.Errorf("%s: keyframes.%s: %w", path, name, err)
			}
			s.Tracks[name] = t
		}
	}
	if vars, ok := raw["vars"].(map[string]any); ok {
		for k, v := range vars {
			s.Vars[k] = fmt.Sprint(v)
		}
	}
	if list, ok := raw["text"].([]any); ok {
		for _, item := range list {
			m, ok := item.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("%s: each text layer must be an object", path)
			}
			l := Layer{Anchor: "center", To: -1}
			l.Text, _ = m["text"].(string)
			if a, ok := m["anchor"].(string); ok {
				l.Anchor = a
			}
			if f, ok := m["from"].(float64); ok {
				l.From = int(f)
			}
			if t, ok := m["to"].(float64); ok {
				l.To = int(t)
			}
			if err := CheckLayer(l); err != nil {
				return nil, fmt.Errorf("%s: %w", path, err)
			}
			s.Text = append(s.Text, l)
		}
	}
	s.Frames = intPtr(raw["frames"])
	s.ClearFrom = intPtr(raw["clearFrom"])
	s.FPS = floatPtr(raw["fps"])
	s.Margin = floatPtr(raw["margin"])
	s.Pingpong = boolPtr(raw["pingpong"])
	s.Hold = boolPtr(raw["hold"])
	return s, nil
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func intPtr(v any) *int {
	if f, ok := v.(float64); ok {
		n := int(math.Round(f))
		return &n
	}
	return nil
}

func floatPtr(v any) *float64 {
	if f, ok := v.(float64); ok {
		return &f
	}
	return nil
}

func boolPtr(v any) *bool {
	if b, ok := v.(bool); ok {
		return &b
	}
	return nil
}
