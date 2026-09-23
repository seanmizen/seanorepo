// Package ascii turns an image into ASCII art.
//
// The pipeline is the one asciiart.eu/image-to-ascii runs in the browser.
// The steps and their order match the site:
//  1. Resize to Width columns. A text cell is about twice as tall as it is
//     wide, so the row count is scaled by 0.55.
//  2. Apply the CSS filter functions in the site's order.
//  3. Optionally apply edge detection, sharpen and a threshold.
//  4. Take luminance, optionally with error-diffusion dithering.
//  5. Map luminance to a character. Dark pixels get earlier characters.
package ascii

import (
	"bytes"
	"fmt"
	"image"
	"image/draw"
	_ "image/jpeg" // registers the JPEG decoder
	_ "image/png"  // registers the PNG decoder
	"math"
	"os"
	"strings"
)

// Charsets are the site's character sets. Dark pixels map to the first
// character.
var Charsets = map[string]string{
	"minimalist":   "#+-.",
	"normal":       "@%#*+=-:.",
	"normal2":      "&$Xx+;:.",
	"alphabetic":   "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
	"alphanumeric": "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyz",
	"numerical":    "0896452317",
	"extended":     "@%#{}[]()<>^*+=~-:.",
	"math":         "+-×÷=≠≈∞√π",
	"arrow":        "↑↗→↘↓↙←↖",
	"grayscale":    "@$BWM#*oahkbdpwmZO0QCJYXzcvnxrjft/|()1{}[]-_+~<>i!lI;:,\"^`'.",
	"codepage437":  "█▓▒░",
	"blockelement": "█",
}

// CharsetNames lists the charsets in the order the site shows them.
var CharsetNames = []string{
	"minimalist", "normal", "normal2", "alphabetic", "alphanumeric",
	"numerical", "extended", "math", "arrow", "grayscale", "codepage437",
	"blockelement",
}

// Options holds one frame's image settings. The defaults are the site's, from
// its "reset filters" button.
type Options struct {
	Width         float64
	Charset       string
	Chars         string // literal characters, darkest first. Wins over Charset.
	Brightness    float64
	Contrast      float64
	Saturation    float64
	Sepia         float64
	Hue           float64
	Grayscale     float64
	Invert        float64
	Sharpen       bool
	Sharpness     float64
	Edges         bool
	EdgeIntensity float64
	Threshold     float64 // 0-255. NaN turns it off.
	Dithering     string  // none | FloydSteinberg | JJN | Stucki | Atkinson
	SpaceDensity  float64
	Reverse       bool // not on the site: flips the charset for a dark terminal
}

// Defaults returns the site's defaults.
func Defaults() Options {
	return Options{
		Width: 100, Charset: "normal", Brightness: 100, Contrast: 100,
		Saturation: 100, Sharpness: 9, EdgeIntensity: 1, Threshold: math.NaN(),
		Dithering: "none", SpaceDensity: 1,
	}
}

// numeric maps each numeric setting name to its field. Keyframes can animate
// these.
func (o *Options) numeric() map[string]*float64 {
	return map[string]*float64{
		"width": &o.Width, "brightness": &o.Brightness, "contrast": &o.Contrast,
		"saturation": &o.Saturation, "sepia": &o.Sepia, "hue": &o.Hue,
		"grayscale": &o.Grayscale, "invert": &o.Invert,
		"sharpness": &o.Sharpness, "edgeIntensity": &o.EdgeIntensity,
		"threshold": &o.Threshold, "spaceDensity": &o.SpaceDensity,
	}
}

// OptionNames lists every setting name, in the order the flags list them.
var OptionNames = []string{
	"width", "charset", "chars", "brightness", "contrast", "saturation",
	"sepia", "hue", "grayscale", "invert", "sharpen", "sharpness", "edges",
	"edgeIntensity", "threshold", "dithering", "spaceDensity", "reverse",
}

// IsOption reports whether name is a setting.
func IsOption(name string) bool {
	for _, n := range OptionNames {
		if n == name {
			return true
		}
	}
	return false
}

// IsNumeric reports whether name is a numeric setting.
func IsNumeric(name string) bool {
	var o Options
	_, ok := o.numeric()[name]
	return ok
}

// IsBool reports whether name is an on/off setting.
func IsBool(name string) bool {
	return name == "sharpen" || name == "edges" || name == "reverse"
}

// Set sets one setting by name. value is a float64, a string or a bool.
func (o *Options) Set(name string, value any) error {
	if p, ok := o.numeric()[name]; ok {
		f, ok := value.(float64)
		if !ok {
			return fmt.Errorf("%q needs a number", name)
		}
		*p = f
		return nil
	}
	switch name {
	case "charset", "chars", "dithering":
		s, ok := value.(string)
		if !ok {
			return fmt.Errorf("%q needs a string", name)
		}
		switch name {
		case "charset":
			o.Charset = s
		case "chars":
			o.Chars = s
		default:
			o.Dithering = s
		}
		return nil
	case "sharpen", "edges", "reverse":
		b, ok := value.(bool)
		if !ok {
			return fmt.Errorf("%q needs true or false", name)
		}
		switch name {
		case "sharpen":
			o.Sharpen = b
		case "edges":
			o.Edges = b
		default:
			o.Reverse = b
		}
		return nil
	}
	return fmt.Errorf("unknown setting %q", name)
}

// Glyphs returns the characters for o, darkest first. An unknown charset name
// is an error.
func Glyphs(o Options) ([]string, error) {
	base := o.Chars
	if base == "" {
		cs, ok := Charsets[o.Charset]
		if !ok {
			return nil, fmt.Errorf("unknown charset %q. Use one of: %s. For your own characters, use --chars",
				o.Charset, strings.Join(CharsetNames, ", "))
		}
		base = cs
	}
	var glyphs []string
	for _, r := range base {
		glyphs = append(glyphs, string(r))
	}
	for i := 0; i < int(math.Max(0, jsRound(o.SpaceDensity))); i++ {
		glyphs = append(glyphs, " ")
	}
	if o.Reverse {
		for i, j := 0, len(glyphs)-1; i < j; i, j = i+1, j-1 {
			glyphs[i], glyphs[j] = glyphs[j], glyphs[i]
		}
	}
	return glyphs, nil
}

// GlyphFor returns the character for a luminance of 0-255.
func GlyphFor(glyphs []string, l float64) string {
	l = math.Max(0, math.Min(255, l))
	return glyphs[int(math.Floor(l*float64(len(glyphs)-1)/255))]
}

// Image is a decoded image, ready to convert at any width.
type Image struct {
	src    *image.NRGBA
	Aspect float64 // width / height
	cache  map[[2]int][]float32
}

// Load decodes a JPEG or PNG file.
func Load(path string) (*Image, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("input file is missing: %s", path)
	}
	return Decode(data)
}

// Decode decodes JPEG or PNG bytes.
func Decode(data []byte) (*Image, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("cannot decode the image: %w", err)
	}
	b := img.Bounds()
	src := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(src, src.Bounds(), img, b.Min, draw.Src)
	return &Image{src: src, Aspect: float64(b.Dx()) / float64(b.Dy()), cache: map[[2]int][]float32{}}, nil
}

// resize scales the image to w x h by area averaging, and returns RGBA
// floats. The result is cached, so an animation at a fixed width resizes once.
func (im *Image) resize(w, h int) []float32 {
	key := [2]int{w, h}
	if px, ok := im.cache[key]; ok {
		out := make([]float32, len(px))
		copy(out, px)
		return out
	}
	sw, sh := im.src.Rect.Dx(), im.src.Rect.Dy()
	sx := float64(sw) / float64(w)
	sy := float64(sh) / float64(h)
	px := make([]float32, w*h*4)
	for y := 0; y < h; y++ {
		y0, y1 := float64(y)*sy, float64(y+1)*sy
		for x := 0; x < w; x++ {
			x0, x1 := float64(x)*sx, float64(x+1)*sx
			var acc [4]float64
			var total, alpha float64
			for yy := int(y0); yy < sh && float64(yy) < y1; yy++ {
				wy := math.Min(y1, float64(yy+1)) - math.Max(y0, float64(yy))
				row := yy * im.src.Stride
				for xx := int(x0); xx < sw && float64(xx) < x1; xx++ {
					wx := math.Min(x1, float64(xx+1)) - math.Max(x0, float64(xx))
					wt := wx * wy
					i := row + xx*4
					// Weight colour by alpha, so transparent pixels add no
					// colour at an edge.
					a := float64(im.src.Pix[i+3]) / 255
					for c := 0; c < 3; c++ {
						acc[c] += float64(im.src.Pix[i+c]) * wt * a
					}
					acc[3] += float64(im.src.Pix[i+3]) * wt
					alpha += a * wt
					total += wt
				}
			}
			o := (y*w + x) * 4
			for c := 0; c < 3; c++ {
				if alpha > 0 {
					px[o+c] = float32(acc[c] / alpha)
				}
			}
			px[o+3] = float32(acc[3] / total)
		}
	}
	im.cache[key] = px
	out := make([]float32, len(px))
	copy(out, px)
	return out
}

// ---- CSS filter functions, with the Filter Effects spec formulas ----------

func clamp(v float32) float32 {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return v
}

func applyMatrix(px []float32, m [9]float64) {
	for i := 0; i < len(px); i += 4 {
		r, g, b := float64(px[i]), float64(px[i+1]), float64(px[i+2])
		px[i] = clamp(float32(m[0]*r + m[1]*g + m[2]*b))
		px[i+1] = clamp(float32(m[3]*r + m[4]*g + m[5]*b))
		px[i+2] = clamp(float32(m[6]*r + m[7]*g + m[8]*b))
	}
}

func applyPerChannel(px []float32, f func(float64) float64) {
	for i := 0; i < len(px); i += 4 {
		for c := 0; c < 3; c++ {
			px[i+c] = clamp(float32(f(float64(px[i+c]))))
		}
	}
}

func saturateMatrix(s float64) [9]float64 {
	return [9]float64{
		0.213 + 0.787*s, 0.715 - 0.715*s, 0.072 - 0.072*s,
		0.213 - 0.213*s, 0.715 + 0.285*s, 0.072 - 0.072*s,
		0.213 - 0.213*s, 0.715 - 0.715*s, 0.072 + 0.928*s,
	}
}

func sepiaMatrix(a float64) [9]float64 {
	k := 1 - a
	return [9]float64{
		0.393 + 0.607*k, 0.769 - 0.769*k, 0.189 - 0.189*k,
		0.349 - 0.349*k, 0.686 + 0.314*k, 0.168 - 0.168*k,
		0.272 - 0.272*k, 0.534 - 0.534*k, 0.131 + 0.869*k,
	}
}

func grayscaleMatrix(a float64) [9]float64 {
	k := 1 - a
	return [9]float64{
		0.2126 + 0.7874*k, 0.7152 - 0.7152*k, 0.0722 - 0.0722*k,
		0.2126 - 0.2126*k, 0.7152 + 0.2848*k, 0.0722 - 0.0722*k,
		0.2126 - 0.2126*k, 0.7152 - 0.7152*k, 0.0722 + 0.9278*k,
	}
}

func hueMatrix(deg float64) [9]float64 {
	r := deg * math.Pi / 180
	c, s := math.Cos(r), math.Sin(r)
	return [9]float64{
		0.213 + c*0.787 - s*0.213, 0.715 - c*0.715 - s*0.715, 0.072 - c*0.072 + s*0.928,
		0.213 - c*0.213 + s*0.143, 0.715 + c*0.285 + s*0.14, 0.072 - c*0.072 - s*0.283,
		0.213 - c*0.213 - s*0.787, 0.715 - c*0.715 + s*0.715, 0.072 + c*0.928 + s*0.072,
	}
}

func applyFilters(px []float32, o Options) {
	if o.Brightness != 100 {
		b := o.Brightness / 100
		applyPerChannel(px, func(v float64) float64 { return v * b })
	}
	if o.Contrast != 100 {
		c := o.Contrast / 100
		applyPerChannel(px, func(v float64) float64 { return (v-127.5)*c + 127.5 })
	}
	if o.Saturation != 100 {
		applyMatrix(px, saturateMatrix(o.Saturation/100))
	}
	if o.Sepia != 0 {
		applyMatrix(px, sepiaMatrix(math.Min(o.Sepia, 100)/100))
	}
	if o.Hue != 0 {
		applyMatrix(px, hueMatrix(o.Hue))
	}
	if o.Grayscale != 0 {
		applyMatrix(px, grayscaleMatrix(math.Min(o.Grayscale, 100)/100))
	}
	if o.Invert != 0 {
		a := math.Min(o.Invert, 100) / 100
		applyPerChannel(px, func(v float64) float64 { return v*(1-a) + (255-v)*a })
	}
}

func luminance(px []float32, i int) float64 {
	return 0.3*float64(px[i]) + 0.59*float64(px[i+1]) + 0.11*float64(px[i+2])
}

// applyEdges is Sobel edge detection. The site paints the border white and
// inverts the edges, so edges come out dark on a light field.
func applyEdges(px []float32, w, h int, intensity float64) {
	out := make([]float32, len(px))
	kx := [9]float64{-1, 0, 1, -2, 0, 2, -1, 0, 1}
	ky := [9]float64{-1, -2, -1, 0, 0, 0, 1, 2, 1}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			i := (y*w + x) * 4
			out[i+3] = 255
			if x == 0 || y == 0 || x == w-1 || y == h-1 {
				out[i], out[i+1], out[i+2] = 255, 255, 255
				continue
			}
			var gx, gy float64
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					l := luminance(px, ((y+dy)*w+(x+dx))*4)
					k := (dy+1)*3 + (dx + 1)
					gx += l * kx[k]
					gy += l * ky[k]
				}
			}
			edge := math.Trunc(math.Sqrt(gx*gx+gy*gy) * intensity)
			v := clamp(float32(255 - edge))
			out[i], out[i+1], out[i+2] = v, v, v
		}
	}
	copy(px, out)
}

func applySharpen(px []float32, w, h int, centre float64) {
	k := [9]float64{-1, -1, -1, -1, centre, -1, -1, -1, -1}
	out := make([]float32, len(px))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var r, g, b float64
			for ky := 0; ky < 3; ky++ {
				for kx := 0; kx < 3; kx++ {
					yy, xx := y+ky-1, x+kx-1
					if yy < 0 || yy >= h || xx < 0 || xx >= w {
						continue
					}
					j := (yy*w + xx) * 4
					wt := k[ky*3+kx]
					r += float64(px[j]) * wt
					g += float64(px[j+1]) * wt
					b += float64(px[j+2]) * wt
				}
			}
			i := (y*w + x) * 4
			out[i], out[i+1], out[i+2] = clamp(float32(r)), clamp(float32(g)), clamp(float32(b))
			out[i+3] = px[i+3]
		}
	}
	copy(px, out)
}

// kernels are error-diffusion kernels as {dx, dy, weight}. The site quantises
// to 15 levels. It adds the error to the red channel of each neighbour only.
// That is part of how the site's output looks, so this keeps it.
var kernels = map[string][][3]float64{
	"FloydSteinberg": {{1, 0, 7.0 / 16}, {-1, 1, 3.0 / 16}, {0, 1, 5.0 / 16}, {1, 1, 1.0 / 16}},
	"JJN": scale([][3]float64{{1, 0, 7}, {2, 0, 5}, {-2, 1, 3}, {-1, 1, 5}, {0, 1, 7}, {1, 1, 5},
		{2, 1, 3}, {-2, 2, 1}, {-1, 2, 3}, {0, 2, 5}, {1, 2, 3}, {2, 2, 1}}, 48),
	"Stucki": scale([][3]float64{{1, 0, 8}, {2, 0, 4}, {-2, 1, 2}, {-1, 1, 4}, {0, 1, 8}, {1, 1, 4},
		{2, 1, 2}, {-2, 2, 1}, {-1, 2, 2}, {0, 2, 4}, {1, 2, 2}, {2, 2, 1}}, 42),
	"Atkinson": {{1, 0, 1.0 / 8}, {2, 0, 1.0 / 8}, {-1, 1, 1.0 / 8}, {0, 1, 1.0 / 8}, {1, 1, 1.0 / 8}, {0, 2, 1.0 / 8}},
}

func scale(k [][3]float64, d float64) [][3]float64 {
	for i := range k {
		k[i][2] /= d
	}
	return k
}

// jsRound rounds half up, as JavaScript's Math.round does.
func jsRound(v float64) float64 { return math.Floor(v + 0.5) }

// Convert turns the image into ASCII with one frame's settings. It returns
// the lines joined by "\n".
func (im *Image) Convert(o Options) (string, error) {
	glyphs, err := Glyphs(o)
	if err != nil {
		return "", err
	}
	w := int(math.Max(1, jsRound(o.Width)))
	h := int(math.Max(1, math.Floor(0.55*math.Floor(float64(w)/im.Aspect))))
	px := im.resize(w, h)

	applyFilters(px, o)
	if o.Edges {
		applyEdges(px, w, h, o.EdgeIntensity)
	}
	if o.Sharpen {
		applySharpen(px, w, h, o.Sharpness)
	}
	if !math.IsNaN(o.Threshold) {
		for i := 0; i < len(px); i += 4 {
			v := float32(255)
			if luminance(px, i) < o.Threshold {
				v = 0
			}
			px[i], px[i+1], px[i+2] = v, v, v
		}
	}

	kernel := kernels[o.Dithering]
	var sb strings.Builder
	for y := 0; y < h; y++ {
		if y > 0 {
			sb.WriteByte('\n')
		}
		for x := 0; x < w; x++ {
			i := (y*w + x) * 4
			if px[i+3] < 16 {
				sb.WriteByte(' ')
				continue
			}
			l := luminance(px, i)
			if kernel != nil {
				q := jsRound(l/255*14) / 14 * 255
				e := l - q
				for _, k := range kernel {
					j := ((y+int(k[1]))*w + (x + int(k[0]))) * 4
					if j >= 0 && j < len(px) {
						px[j] += float32(e * k[2])
					}
				}
				l = q
			}
			sb.WriteString(GlyphFor(glyphs, l))
		}
	}
	return sb.String(), nil
}
