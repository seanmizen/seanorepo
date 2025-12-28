<#
.SYNOPSIS
    Test Debian preseed configurations using QEMU on Windows.

.DESCRIPTION
    This script automates testing of Debian preseed files by:
    - Downloading Debian netboot files
    - Creating a virtual disk
    - Starting an HTTP server for the preseed file
    - Launching QEMU with proper acceleration

.PARAMETER Clean
    Remove cached downloads and disk images before starting.

.PARAMETER PreseedFile
    Path to the preseed.cfg file. Default: preseed.cfg in current directory.

.PARAMETER NoAccel
    Disable WHPX acceleration (slower but more compatible).

.PARAMETER Ram
    VM RAM in megabytes. Default: 2048.

.PARAMETER DiskSize
    VM disk size. Default: 20G.

.EXAMPLE
    .\test-preseed.ps1
    Run with defaults.

.EXAMPLE
    .\test-preseed.ps1 -Clean
    Fresh start with cleaned cache.

.EXAMPLE
    .\test-preseed.ps1 -PreseedFile .\custom-preseed.cfg -Ram 4096
    Test custom preseed with 4GB RAM.

.NOTES
    Requirements:
    - QEMU for Windows: winget install SoftwareFreedomConservancy.QEMU
    - Windows Hypervisor Platform enabled (optional, for acceleration)
    - Python 3 (for HTTP server)
#>

[CmdletBinding()]
param(
    [switch]$Clean,
    [switch]$NoAccel,
    [string]$PreseedFile = "preseed.cfg",
    [int]$Ram = 2048,
    [int]$Cpus = 2,
    [string]$DiskSize = "20G",
    [int]$HttpPort = 8888
)

$ErrorActionPreference = "Stop"

# Configuration
$DebianVersion = "trixie"
$DebianArch = "amd64"
$WorkDir = Join-Path $PSScriptRoot "preseed-test"
$DiskFile = "debian-test.qcow2"

# URLs
$NetbootUrl = "https://deb.debian.org/debian/dists/$DebianVersion/main/installer-$DebianArch/current/images/netboot/netboot.tar.gz"

function Write-Status {
    param([string]$Message, [string]$Type = "INFO")
    $color = switch ($Type) {
        "OK"    { "Green" }
        "WARN"  { "Yellow" }
        "ERROR" { "Red" }
        default { "Cyan" }
    }
    $prefix = switch ($Type) {
        "OK"    { "[OK]   " }
        "WARN"  { "[WARN] " }
        "ERROR" { "[ERROR]" }
        default { "[INFO] " }
    }
    Write-Host "$prefix $Message" -ForegroundColor $color
}

function Find-Qemu {
    $searchPaths = @(
        "C:\Program Files\qemu\qemu-system-x86_64.exe",
        "$env:LOCALAPPDATA\Programs\qemu\qemu-system-x86_64.exe",
        "$env:ProgramFiles\qemu\qemu-system-x86_64.exe"
    )
    
    foreach ($path in $searchPaths) {
        if (Test-Path $path) {
            return Split-Path $path -Parent
        }
    }
    
    # Try PATH
    $qemu = Get-Command "qemu-system-x86_64.exe" -ErrorAction SilentlyContinue
    if ($qemu) {
        return Split-Path $qemu.Source -Parent
    }
    
    return $null
}

function Test-WhpxAvailable {
    param([string]$QemuDir)
    
    $output = & "$QemuDir\qemu-system-x86_64.exe" -accel help 2>&1
    return $output -match "whpx"
}

function Stop-HttpServer {
    param([int]$Port)
    
    $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        if ($conn.OwningProcess -ne 0) {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}

function Start-PreseedHttpServer {
    param([string]$Directory, [int]$Port)
    
    Stop-HttpServer -Port $Port
    Start-Sleep -Milliseconds 500
    
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCmd) {
        $pythonCmd = Get-Command python3 -ErrorAction SilentlyContinue
    }
    if (-not $pythonCmd) {
        throw "Python not found. Install Python 3 or add it to PATH."
    }
    
    $job = Start-Job -ScriptBlock {
        param($dir, $port)
        Set-Location $dir
        & python -m http.server $port 2>&1
    } -ArgumentList $Directory, $Port
    
    Start-Sleep -Seconds 2
    
    if ($job.State -eq "Failed") {
        throw "Failed to start HTTP server"
    }
    
    return $job
}

# ============================================================================
# Main Script
# ============================================================================

Write-Host ""
Write-Host "========================================" -ForegroundColor White
Write-Host " Debian Preseed Test (Windows)" -ForegroundColor White
Write-Host "========================================" -ForegroundColor White
Write-Host ""

# Find QEMU
$QemuDir = Find-Qemu
if (-not $QemuDir) {
    Write-Status "QEMU not found!" "ERROR"
    Write-Host ""
    Write-Host "Install QEMU for Windows:" -ForegroundColor Yellow
    Write-Host "  winget install SoftwareFreedomConservancy.QEMU" -ForegroundColor Gray
    Write-Host "  - or -"
    Write-Host "  Download from https://qemu.weilnetz.de/w64/" -ForegroundColor Gray
    exit 1
}
Write-Status "QEMU found: $QemuDir" "OK"

# Validate preseed file
$PreseedPath = Resolve-Path $PreseedFile -ErrorAction SilentlyContinue
if (-not $PreseedPath) {
    Write-Status "Preseed file not found: $PreseedFile" "ERROR"
    exit 1
}
Write-Status "Preseed: $PreseedPath" "OK"

# Check WHPX
$accelFlag = ""
if (-not $NoAccel) {
    if (Test-WhpxAvailable -QemuDir $QemuDir) {
        $accelFlag = "-accel whpx"
        Write-Status "WHPX acceleration available" "OK"
    } else {
        Write-Status "WHPX not available - VM will be slower" "WARN"
        Write-Host "         Enable 'Windows Hypervisor Platform' in Windows Features" -ForegroundColor Gray
    }
} else {
    Write-Status "Acceleration disabled by -NoAccel" "INFO"
}

Write-Host ""

# Setup work directory
if ($Clean -and (Test-Path $WorkDir)) {
    Write-Status "Cleaning work directory..."
    Remove-Item -Recurse -Force $WorkDir
}

if (-not (Test-Path $WorkDir)) {
    New-Item -ItemType Directory -Path $WorkDir | Out-Null
}

# Download netboot files
$tftpDir = Join-Path $WorkDir "tftp\debian-installer"
if (-not (Test-Path $tftpDir)) {
    Write-Status "Downloading Debian netboot files..."
    $netbootTar = Join-Path $WorkDir "netboot.tar.gz"
    
    $ProgressPreference = 'SilentlyContinue'  # Speed up Invoke-WebRequest
    Invoke-WebRequest -Uri $NetbootUrl -OutFile $netbootTar
    $ProgressPreference = 'Continue'
    
    Write-Status "Extracting netboot files..."
    $extractDir = Join-Path $WorkDir "tftp"
    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
    tar -xzf $netbootTar -C $extractDir
    Remove-Item $netbootTar
    Write-Status "Netboot files ready" "OK"
} else {
    Write-Status "Using cached netboot files" "OK"
}

# Create disk image
$diskPath = Join-Path $WorkDir $DiskFile
if (-not (Test-Path $diskPath)) {
    Write-Status "Creating disk image: $DiskFile ($DiskSize)"
    & "$QemuDir\qemu-img.exe" create -f qcow2 $diskPath $DiskSize
} else {
    Write-Status "Using existing disk image" "OK"
}

# Copy preseed file
Copy-Item -Path $PreseedPath -Destination (Join-Path $WorkDir "preseed.cfg") -Force

# Start HTTP server
Write-Host ""
Write-Status "Starting HTTP server on port $HttpPort..."
$httpJob = Start-PreseedHttpServer -Directory $WorkDir -Port $HttpPort
Write-Status "HTTP server started" "OK"

# Build paths
$kernel = Join-Path $WorkDir "tftp\debian-installer\$DebianArch\linux"
$initrd = Join-Path $WorkDir "tftp\debian-installer\$DebianArch\initrd.gz"
$preseedUrl = "http://10.0.2.2:$HttpPort/preseed.cfg"

# Kernel command line
$append = @(
    "auto=true",
    "priority=critical",
    "preseed/url=$preseedUrl",
    "debian-installer/locale=en_GB.UTF-8",
    "keyboard-configuration/xkb-keymap=gb",
    "netcfg/choose_interface=auto",
    "netcfg/get_hostname=debian-test",
    "netcfg/get_domain=local"
) -join " "

Write-Host ""
Write-Host "========================================" -ForegroundColor White
Write-Host " Starting QEMU" -ForegroundColor White
Write-Host "========================================" -ForegroundColor White
Write-Host "  RAM: ${Ram}MB, CPUs: $Cpus" -ForegroundColor Gray
Write-Host "  Disk: $DiskSize" -ForegroundColor Gray
Write-Host "  Preseed URL: $preseedUrl" -ForegroundColor Gray
Write-Host ""
Write-Host "  Close the QEMU window to stop." -ForegroundColor Yellow
Write-Host "  After install: ssh -p 2222 admin@localhost" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor White
Write-Host ""

try {
    $qemuArgs = @(
        "-m", $Ram
        "-smp", $Cpus
        "-drive", "file=$diskPath,format=qcow2,if=virtio"
        "-netdev", "user,id=net0,hostfwd=tcp::2222-:22"
        "-device", "virtio-net-pci,netdev=net0"
        "-kernel", $kernel
        "-initrd", $initrd
        "-append", $append
        "-display", "gtk"
    )
    
    if ($accelFlag) {
        $qemuArgs = @("-accel", "whpx") + $qemuArgs
    }
    
    & "$QemuDir\qemu-system-x86_64.exe" @qemuArgs
}
finally {
    Write-Host ""
    Write-Status "Stopping HTTP server..."
    Stop-HttpServer -Port $HttpPort
    if ($httpJob) {
        Stop-Job -Job $httpJob -ErrorAction SilentlyContinue
        Remove-Job -Job $httpJob -ErrorAction SilentlyContinue
    }
    Write-Status "Done" "OK"
}