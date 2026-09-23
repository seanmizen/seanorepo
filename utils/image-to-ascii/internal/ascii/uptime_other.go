//go:build !linux && !darwin

package ascii

// uptimeSeconds is unknown on this platform.
func uptimeSeconds() float64 { return 0 }
