package main

import (
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"golang.org/x/term"
)

// terminalSize returns the size of the terminal on stdout. ok is false when
// stdout is not a terminal.
func terminalSize() (cols, rows int, ok bool) {
	fd := int(os.Stdout.Fd())
	if !term.IsTerminal(fd) {
		return 0, 0, false
	}
	cols, rows, err := term.GetSize(fd)
	return cols, rows, err == nil
}

// play shows the frames once. Any key shows the last frame and returns. With
// hold, the last frame stays until a key press. The terminal comes back to
// its old mode however playback ends.
func play(frames []string, fps float64, hold bool) {
	out := os.Stdout
	in := int(os.Stdin.Fd())
	keys := make(chan struct{}, 1)
	var restore func()

	if term.IsTerminal(in) {
		if old, err := term.MakeRaw(in); err == nil {
			restore = func() { _ = term.Restore(in, old) }
			go func() {
				b := make([]byte, 1)
				if n, _ := os.Stdin.Read(b); n > 0 {
					keys <- struct{}{}
				}
			}()
		}
	}
	finish := func() {
		out.WriteString("\x1b[?25h")
		if restore != nil {
			restore()
		}
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGHUP, syscall.SIGINT)
	go func() {
		<-signals
		finish()
		os.Exit(130)
	}()

	// Raw mode turns off the newline translation, so each line needs its own
	// carriage return.
	show := func(frame string) {
		out.WriteString("\x1b[H" + strings.ReplaceAll(frame, "\n", "\r\n") + "\r\n")
	}
	delay := time.Duration(float64(time.Second) / fps)

	out.WriteString("\x1b[?25l\x1b[2J")
	for i, frame := range frames {
		show(frame)
		if i == len(frames)-1 {
			break
		}
		select {
		case <-keys:
			show(frames[len(frames)-1])
			finish()
			return
		case <-time.After(delay):
		}
	}
	if hold && restore != nil {
		<-keys
	}
	finish()
}
