package ascii

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTrackParsesSortsAndRejects(t *testing.T) {
	tr, err := ParseTrack("20:250,0:100")
	if err != nil || tr[0] != [2]float64{0, 100} || tr[1] != [2]float64{20, 250} {
		t.Fatalf("got %v %v", tr, err)
	}
	if _, err := ParseTrack("0:100,0:200"); err == nil || !strings.Contains(err.Error(), "two keyframes") {
		t.Fatalf("want a duplicate error, got %v", err)
	}
	if _, err := ParseTrack("x:1"); err == nil || !strings.Contains(err.Error(), "bad keyframe") {
		t.Fatalf("want a bad keyframe error, got %v", err)
	}
	j, err := TrackFromJSON(map[string]any{"40": 80.0, "0": 100.0})
	if err != nil || j[0][0] != 0 || j[1][0] != 40 {
		t.Fatalf("got %v %v", j, err)
	}
}

func TestValuesHoldAndInterpolate(t *testing.T) {
	tr, _ := ParseTrack("10:100,20:200,40:0")
	lin, smooth := Easings["linear"], Easings["smooth"]
	for _, c := range []struct{ f, want float64 }{{0, 100}, {15, 150}, {30, 100}, {99, 0}} {
		if got := tr.ValueAt(c.f, lin); got != c.want {
			t.Errorf("frame %v: got %v, want %v", c.f, got, c.want)
		}
	}
	if tr.ValueAt(15, smooth) != 150 || tr.ValueAt(12, smooth) >= tr.ValueAt(12, lin) {
		t.Error("smooth easing is wrong")
	}
	a, _ := ParseTrack("0:1,80:2")
	b, _ := ParseTrack("0:1,50:2")
	if n := FrameCount(map[string]Track{"a": a, "b": b}); n != 81 {
		t.Errorf("frame count %d, want 81", n)
	}
}

func TestGlyphs(t *testing.T) {
	o := Defaults()
	o.Charset = "minimalist"
	g, _ := Glyphs(o)
	if strings.Join(g, "") != "#+-. " || GlyphFor(g, 0) != "#" || GlyphFor(g, 255) != " " {
		t.Fatalf("got %q", g)
	}
	o.Reverse = true
	g, _ = Glyphs(o)
	if GlyphFor(g, 0) != " " {
		t.Error("reverse does not flip")
	}
	o.Charset = "alphabetical"
	if _, err := Glyphs(o); err == nil || !strings.Contains(err.Error(), "unknown charset") {
		t.Errorf("want an unknown charset error, got %v", err)
	}
	o.Chars, o.SpaceDensity, o.Reverse = "ab", 0, false
	if g, _ = Glyphs(o); strings.Join(g, "") != "ab" {
		t.Errorf("chars: got %q", g)
	}
}

func TestLayersAnchorsAndTiming(t *testing.T) {
	blank := strings.TrimSuffix(strings.Repeat(strings.Repeat(".", 20)+"\n", 5), "\n")
	layers := []Layer{
		{Text: "{hostname}", Anchor: "bottom-left", To: -1},
		{Text: "up {uptime}", Anchor: "bottom-right", To: -1},
		{Text: "hi", Anchor: "center", From: 3, To: 4},
	}
	vars := map[string]string{"hostname": "asus", "uptime": "2h 5m"}
	f0 := strings.Split(StampLayers(blank, layers, 0, vars), "\n")
	if f0[4] != "asus"+strings.Repeat(".", 8)+"up 2h 5m" || f0[2] != strings.Repeat(".", 20) {
		t.Fatalf("frame 0: %q", f0)
	}
	f3 := strings.Split(StampLayers(blank, layers, 3, vars), "\n")
	if f3[2] != strings.Repeat(".", 9)+"hi"+strings.Repeat(".", 9) {
		t.Errorf("frame 3 centre: %q", f3[2])
	}
	if strings.Split(StampLayers(blank, layers, 5, vars), "\n")[2] != strings.Repeat(".", 20) {
		t.Error("layer shows after its last frame")
	}
}

func TestUptimeVarsMarginBlank(t *testing.T) {
	if got := FormatUptime(300*86400 + 2*3600 + 34*60 + 9); got != "300d 2h 34m" {
		t.Errorf("uptime %q", got)
	}
	if FormatUptime(2*3600+60) != "2h 1m" || FormatUptime(59) != "0m" {
		t.Error("uptime units")
	}
	if FillVars("{a} {b}", map[string]string{"a": "1"}) != "1 {b}" {
		t.Error("fill vars")
	}
	if AddMargin("ab\nc", 1) != "    \n ab \n c  \n    " || AddMargin("ab", 0) != "ab" {
		t.Errorf("margin %q", AddMargin("ab\nc", 1))
	}
	if Blank("ab\n█c") != "  \n  " {
		t.Errorf("blank %q", Blank("ab\n█c"))
	}
}

func TestSpecErrors(t *testing.T) {
	dir := t.TempDir()
	write := func(body string) string {
		p := filepath.Join(dir, "spec.json")
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	if _, err := ReadSpec(write(`{"image":"x.jpg","options":{"width":10}}`)); err == nil ||
		!strings.Contains(err.Error(), `"options" is gone`) {
		t.Errorf("options: %v", err)
	}
	if _, err := ReadSpec(write(`{"image":"x.jpg","widht":10}`)); err == nil ||
		!strings.Contains(err.Error(), `unknown key "widht"`) {
		t.Errorf("typo: %v", err)
	}
	s, err := ReadSpec(write(`{"image":"x.jpg","width":10,"clearFrom":5,"hold":true,
		"text":[{"text":"hi","anchor":"top-left"}]}`))
	if err != nil || s.Image != filepath.Join(dir, "x.jpg") || s.Options["width"] != 10.0 ||
		*s.ClearFrom != 5 || !*s.Hold || s.Text[0].To != -1 {
		t.Errorf("flat spec: %+v %v", s, err)
	}
}

func TestConvertShape(t *testing.T) {
	// Left half black, right half white, 200x100.
	img := image.NewNRGBA(image.Rect(0, 0, 200, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 200; x++ {
			v := uint8(0)
			if x >= 100 {
				v = 255
			}
			img.Set(x, y, color.NRGBA{v, v, v, 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	im, err := Decode(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	o := Defaults()
	o.Width, o.Charset = 20, "minimalist"
	out, err := im.Convert(o)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(out, "\n")
	// Rows: floor(0.55 * floor(20 / 2)) = 5.
	if len(lines) != 5 {
		t.Fatalf("%d rows, want 5", len(lines))
	}
	for _, l := range lines {
		if len(l) != 20 || !strings.HasPrefix(l, "#####") || !strings.HasSuffix(l, "     ") {
			t.Fatalf("line %q", l)
		}
	}
	o.Threshold = math.NaN()
	if _, err := im.Convert(o); err != nil {
		t.Fatal(err)
	}
}
