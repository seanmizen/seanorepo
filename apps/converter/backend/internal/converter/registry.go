package converter

import "fmt"

// Registry maps file extensions to suitable converters.
type Registry struct {
	converters []Converter
}

func NewRegistry() *Registry {
	return &Registry{}
}

// Register adds a converter to the registry.
func (r *Registry) Register(c Converter) {
	r.converters = append(r.converters, c)
}

// FindConverter returns the first converter that accepts the given input extension.
func (r *Registry) FindConverter(inputExt string) (Converter, error) {
	for _, c := range r.converters {
		if c.AcceptsInput(inputExt) {
			return c, nil
		}
	}
	return nil, fmt.Errorf("no converter registered for %q", inputExt)
}
