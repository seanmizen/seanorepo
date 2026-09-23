package ascii

import (
	"time"

	"golang.org/x/sys/unix"
)

// uptimeSeconds is the time since kern.boottime.
func uptimeSeconds() float64 {
	tv, err := unix.SysctlTimeval("kern.boottime")
	if err != nil {
		return 0
	}
	return time.Since(time.Unix(tv.Unix())).Seconds()
}
