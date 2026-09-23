package ascii

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// Track is one setting's keyframes, sorted by frame. Before the first
// keyframe the value holds at the first value. After the last keyframe it
// holds at the last value. Between two keyframes it moves by the easing.
type Track [][2]float64

// Easings maps an easing name to its curve.
var Easings = map[string]func(float64) float64{
	"linear": func(t float64) float64 { return t },
	// Smoothstep: slow out of one keyframe and slow into the next.
	"smooth": func(t float64) float64 { return t * t * (3 - 2*t) },
}

// ParseTrack parses "0:100,20:250,40:80".
func ParseTrack(text string) (Track, error) {
	var t Track
	for _, part := range strings.Split(text, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		fv := strings.SplitN(part, ":", 2)
		bad := fmt.Errorf("bad keyframe %q: use frame:value, e.g. 20:250", part)
		if len(fv) != 2 {
			return nil, bad
		}
		f, err1 := strconv.Atoi(fv[0])
		v, err2 := strconv.ParseFloat(fv[1], 64)
		if err1 != nil || err2 != nil || f < 0 || math.IsInf(v, 0) || math.IsNaN(v) {
			return nil, bad
		}
		t = append(t, [2]float64{float64(f), v})
	}
	return normalise(t)
}

// TrackFromJSON accepts {"0": 100, "20": 250} or [[0, 100], [20, 250]].
func TrackFromJSON(v any) (Track, error) {
	var t Track
	switch j := v.(type) {
	case map[string]any:
		for k, val := range j {
			f, err := strconv.Atoi(k)
			n, ok := val.(float64)
			if err != nil || !ok || f < 0 {
				return nil, fmt.Errorf("bad keyframe %q: %v", k, val)
			}
			t = append(t, [2]float64{float64(f), n})
		}
	case []any:
		for _, pair := range j {
			p, ok := pair.([]any)
			if !ok || len(p) != 2 {
				return nil, fmt.Errorf("bad keyframe %v: use [frame, value]", pair)
			}
			f, ok1 := p[0].(float64)
			n, ok2 := p[1].(float64)
			if !ok1 || !ok2 || f < 0 || f != math.Trunc(f) {
				return nil, fmt.Errorf("bad keyframe %v", pair)
			}
			t = append(t, [2]float64{f, n})
		}
	default:
		return nil, fmt.Errorf("keyframes must be an object or a list of pairs")
	}
	return normalise(t)
}

func normalise(t Track) (Track, error) {
	if len(t) == 0 {
		return nil, fmt.Errorf("a track needs at least one keyframe")
	}
	sort.Slice(t, func(i, j int) bool { return t[i][0] < t[j][0] })
	for i := 1; i < len(t); i++ {
		if t[i][0] == t[i-1][0] {
			return nil, fmt.Errorf("frame %v has two keyframes", t[i][0])
		}
	}
	return t, nil
}

// ValueAt returns the value of a track at a frame.
func (t Track) ValueAt(frame float64, ease func(float64) float64) float64 {
	if frame <= t[0][0] {
		return t[0][1]
	}
	last := t[len(t)-1]
	if frame >= last[0] {
		return last[1]
	}
	i := 1
	for t[i][0] < frame {
		i++
	}
	f0, v0 := t[i-1][0], t[i-1][1]
	f1, v1 := t[i][0], t[i][1]
	return v0 + (v1-v0)*ease((frame-f0)/(f1-f0))
}

// FrameCount returns the count that shows every keyframe: the last keyframe
// of any track, plus one.
func FrameCount(tracks map[string]Track) int {
	n := 1
	for _, t := range tracks {
		if c := int(t[len(t)-1][0]) + 1; c > n {
			n = c
		}
	}
	return n
}
