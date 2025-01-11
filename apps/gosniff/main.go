package main

import (
	"fmt"
	"log"
	"math"
	"os"
	"os/signal"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/google/gopacket/pcap"
	"github.com/nsf/termbox-go"
)

// =======================
// Configuration Constants
// =======================

// at these values, two devices hang around at 1.00m. like, exactly. odd
// DecayInterval   = 100 * time.Millisecond // Interval for heatbar decay
// DecayRate       = 200                     // Bytes to decay each interval

// sudo go run main.go

const (
	MaxBytes        = 150000                  // Maximum bytes for heatbar scaling
	DecayInterval   = 500 * time.Millisecond  // Interval for heatbar decay
	DecayRate       = 500                     // Bytes to decay each interval
	UIRefreshRate   = 5 * time.Millisecond    // UI refresh rate
	HeatbarMaxWidth = 0                       // 0 indicates dynamic calculation based on terminal width
	IPColumnWidth   = 16                      // Fixed width for the IP address column
	Separator       = " | "                   // Separator between IP and heatbar
	InterfaceName   = "en0"                   // Network interface to capture packets from
	BPFFilter       = "ip"                    // BPF filter for packet capture
	MaxHeatDisplay  = 1000000                 // Maximum heat value to display
)

// =======================
// Heatbar Data Structures
// =======================

type DeviceHeat struct {
	IP    string
	Heat  float64
	Mutex sync.Mutex
}

var (
	devices      = make(map[string]*DeviceHeat)
	devicesMutex sync.Mutex
)

// =======================
// Helper Functions
// =======================

// padRight pads the string s with spaces on the right to make it length n.
// If s is longer than n, it truncates and adds "..." at the end.
func padRight(s string, n int) string {
	if len(s) > n {
		if n > 3 {
			return s[:n-3] + "..."
		}
		return s[:n]
	}
	for len(s) < n {
		s += " "
	}
	return s
}

// formatHeat formats the heat value with appropriate units.
func formatHeat(heat float64) string {
	if heat < 1000 {
		return fmt.Sprintf("%.0f", heat)
	} else if heat < 1000000 {
		return fmt.Sprintf("%.1fk", heat/1000)
	} else {
		return fmt.Sprintf("%.1fM", heat/1000000)
	}
}


// =======================
// Main Function
// =======================

func main() {
	// Initialize Termbox
	err := termbox.Init()
	if err != nil {
		log.Fatalf("Failed to initialize termbox: %v", err)
	}
	defer termbox.Close()

	// Create a channel to listen for interrupt signals
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)

	// Create a channel to signal the program to exit
	done := make(chan bool, 1)

	// Handle Interrupt Signals to gracefully exit
	go func() {
		<-sigs
		done <- true
	}()

	// Start Packet Sniffer
	go packetSniffer()

	// Start Heatbar Decay
	go heatbarDecay()

	// Start UI Loop
	go uiLoop()

	// Wait for interrupt signal
	<-done

	// Clean up and exit
	termbox.Close()
	fmt.Println("\nPacket sniffer terminated gracefully.")
}

// =======================
// Packet Sniffer
// =======================

func packetSniffer() {
	// Open the device for capturing
	handle, err := pcap.OpenLive(InterfaceName, 1600, true, pcap.BlockForever)
	if err != nil {
		log.Fatalf("Error opening device %s: %v", InterfaceName, err)
	}
	defer handle.Close()

	// Set BPF filter
	if err := handle.SetBPFFilter(BPFFilter); err != nil {
		log.Fatalf("Error setting BPF filter: %v", err)
	}

	// Create packet source
	packetSource := gopacket.NewPacketSource(handle, handle.LinkType())

	for packet := range packetSource.Packets() {
		processPacket(packet)
	}
}

func processPacket(packet gopacket.Packet) {
	networkLayer := packet.NetworkLayer()
	if networkLayer == nil {
		return
	}

	srcIP, dstIP := getIPAddresses(networkLayer)
	if srcIP == "" || dstIP == "" {
		return
	}

	packetSize := len(packet.Data())

	// Update source IP heat
	updateHeat(srcIP, packetSize)
	// Optionally, update destination IP heat
	updateHeat(dstIP, packetSize)
}

func getIPAddresses(networkLayer gopacket.NetworkLayer) (string, string) {
	switch layer := networkLayer.(type) {
	case *layers.IPv4:
		return layer.SrcIP.String(), layer.DstIP.String()
	case *layers.IPv6:
		return layer.SrcIP.String(), layer.DstIP.String()
	default:
		return "", ""
	}
}

func updateHeat(ip string, size int) {
	devicesMutex.Lock()
	device, exists := devices[ip]
	if !exists {
		device = &DeviceHeat{IP: ip, Heat: 0}
		devices[ip] = device
	}
	devicesMutex.Unlock()

	device.Mutex.Lock()
	device.Heat += float64(size)
	if device.Heat > MaxHeatDisplay {
		device.Heat = MaxHeatDisplay // Cap the heat value
	}
	device.Mutex.Unlock()
}

// =======================
// Heatbar Decay
// =======================

func heatbarDecay() {
	ticker := time.NewTicker(DecayInterval)
	defer ticker.Stop()

	for range ticker.C {
		devicesMutex.Lock()
		for _, device := range devices {
			device.Mutex.Lock()
			device.Heat -= float64(DecayRate)
			if device.Heat < 0 {
				device.Heat = 0
			}
			device.Mutex.Unlock()
		}
		devicesMutex.Unlock()
	}
}

// =======================
// UI Loop
// =======================

func uiLoop() {
	for {
		drawUI()
		time.Sleep(UIRefreshRate)
	}
}

func drawUI() {
	termbox.Clear(termbox.ColorDefault, termbox.ColorDefault)

	// Get the current terminal size
	width, height := termbox.Size()

	// Dynamically set HeatbarMaxWidth if it's not set (0)
	heatbarWidth := HeatbarMaxWidth
	if heatbarWidth <= 0 {
		// Calculate available width: total width - IPColumnWidth - Separator - HeatValueWidth (assume 10)
		heatbarWidth = width - IPColumnWidth - len(Separator) - 10
		if heatbarWidth < 10 { // Minimum width to display heatbar
			heatbarWidth = 10
		}
	}

	devicesList := getSortedDevices()

	for idx, device := range devicesList {
		// Prevent writing beyond the terminal height
		if idx >= height {
			break
		}

		// Prepare IP string with fixed width
		device.Mutex.Lock()
		heatValue := device.Heat
		ipStr := device.IP
		device.Mutex.Unlock()
		parts := strings.Split(ipStr, ".")

		if len(parts) == 4 {
			for i, part := range parts {
				// Ensure each part is exactly 3 characters
				if len(part) < 3 {
					parts[i] = padRight(part, 3) // Pad with spaces on the right
				} else if len(part) > 3 {
					parts[i] = part[:3] // Truncate to 3 characters
				}
			}
			// Join the parts with "." as the separator to maintain exact width
			ipStr = strings.Join(parts, ".")
		} else {
			// Handle unexpected IP formats gracefully by padding/truncating the entire string
			if len(ipStr) > IPColumnWidth {
				ipStr = padRight(ipStr[:IPColumnWidth], IPColumnWidth)
			} else {
				ipStr = padRight(ipStr, IPColumnWidth)
			}
		}

		// Calculate heatbar length
		heatRatio := heatValue / float64(MaxBytes)
		heatRatioTwo := (heatValue - MaxBytes) / float64(MaxBytes * 10)
		if heatRatio > 1 {
				heatRatio = 1
		}
		if heatRatioTwo > 1 {
				heatRatioTwo = 1
		}
		heatWidth := int(math.Round(heatRatio * float64(heatbarWidth)))
		heatWidthTwo := int(math.Round(heatRatioTwo * float64(heatbarWidth)))
		if heatRatioTwo < 0 {
			heatWidthTwo = 0
		}

		// Determine color: Green if below max, Red if at or above max
		var barColorOne termbox.Attribute = termbox.ColorGreen
		var barColorTwo termbox.Attribute = termbox.ColorRed

		// Prepare heatbar string using 'F'
		heatbar := strings.Repeat("1", heatWidth) + strings.Repeat(" ", heatbarWidth-heatWidth)
		heatbarTwo := strings.Repeat("2", heatWidthTwo)

		// Print IP with fixed width
		for i, ch := range ipStr {
				if i >= IPColumnWidth {
						break
				}
				termbox.SetCell(i, idx, ch, termbox.ColorWhite, termbox.ColorDefault)
		}

		// Print Separator
		sepX := IPColumnWidth
		for i, ch := range Separator {
				x := sepX + i
				if x >= width {
						break
				}
				termbox.SetCell(x, idx, ch, termbox.ColorWhite, termbox.ColorDefault)
		}

		// Print Heatbar with Colors
		heatbarX := sepX + len(Separator)
		for i, ch := range heatbar {
				x := heatbarX + i
				if x >= width {
						break
				}
				// Set color based on the heatValue
				termbox.SetCell(x, idx, ch, barColorOne, termbox.ColorDefault)
		}

		heatbarXTwo := sepX + len(Separator)
		for i, ch := range heatbarTwo {
				if heatRatioTwo < 0 {
					break
				}
				x := heatbarXTwo + i
				if x >= width {
						break
				}
				// Set color based on the heatValue
				termbox.SetCell(x, idx, ch, barColorTwo, termbox.ColorDefault)
		}

		// Optionally, display heat value
		formattedHeat := formatHeat(heatValue)
		if heatValue > MaxHeatDisplay {
				formattedHeat = "MAX"
		}

		heatValueStr := fmt.Sprintf(" %s ", formattedHeat)
		// Ensure heatValueStr does not exceed a reasonable length
		if len(heatValueStr) > 10 {
				heatValueStr = " MAX "
		}

		heatValueX := heatbarX + heatbarWidth + 1
		for i, ch := range heatValueStr {
				x := heatValueX + i
				if x >= width {
						break
				}
				termbox.SetCell(x, idx, ch, termbox.ColorYellow, termbox.ColorDefault)
		}
	}

	// Flush the UI
	termbox.Flush()
}

// getSortedDevices returns a slice of DeviceHeat sorted by IP address.
func getSortedDevices() []*DeviceHeat {
	devicesMutex.Lock()
	defer devicesMutex.Unlock()

	list := make([]*DeviceHeat, 0, len(devices))
	for _, device := range devices {
		list = append(list, device)
	}

	sort.Slice(list, func(i, j int) bool {
		if list[i].Heat == list[j].Heat {
			return list[i].IP < list[j].IP
		}
		return list[i].Heat > list[j].Heat
	})

	// Limit to terminal height
	_, height := termbox.Size()
	if len(list) > height {
		return list[:height]
	}
	return list
}
