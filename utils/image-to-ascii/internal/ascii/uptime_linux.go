package ascii

import (
	"os"
	"strconv"
	"strings"
)

// uptimeSeconds reads the first field of /proc/uptime.
func uptimeSeconds() float64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	f, _ := strconv.ParseFloat(strings.Fields(string(data))[0], 64)
	return f
}
