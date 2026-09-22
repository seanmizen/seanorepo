<#
.SYNOPSIS
    Test Debian preseed configurations using QEMU on Windows.

.DESCRIPTION
    This script automates testing of Debian preseed files by:
    - Downloading Debian netboot files
    - Embedding the preseed file directly in the initrd (most reliable method)
    - Creating a virtual disk
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
    - Git for Windows (provides gzip) - or install gzip separately
#>

[CmdletBinding()]
param(
    [switch]$Clean,
    [switch]$NoAccel,
    [string]$PreseedFile = "preseed.cfg",
    [int]$Ram = 2048,
    [int]$Cpus = 2,
    [string]$DiskSize = "20G"
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

function Find-Gzip {
    # Check common locations for gzip on Windows
    $searchPaths = @(
        "C:\Program Files\Git\usr\bin\gzip.exe",
        "C:\Program Files (x86)\Git\usr\bin\gzip.exe",
        "$env:LOCALAPPDATA\Programs\Git\usr\bin\gzip.exe"
    )
    
    foreach ($path in $searchPaths) {
        if (Test-Path $path) {
            return $path
        }
    }
    
    # Try PATH
    $gzip = Get-Command "gzip" -ErrorAction SilentlyContinue
    if ($gzip) {
        return $gzip.Source
    }
    
    return $null
}

function Test-WhpxAvailable {
    param([string]$QemuDir)
    
    $output = & "$QemuDir\qemu-system-x86_64.exe" -accel help 2>&1
    return $output -match "whpx"
}

function Add-PreseedToInitrd {
    param(
        [string]$OriginalInitrd,
        [string]$PreseedFile,
        [string]$OutputInitrd,
        [string]$GzipPath
    )
    
    Write-Status "Embedding preseed.cfg into initrd..."
    
    $tempDir = Join-Path $env:TEMP "preseed-initrd-$(Get-Random)"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    
    try {
        # Copy files to temp
        Copy-Item -Path $PreseedFile -Destination (Join-Path $tempDir "preseed.cfg")
        Copy-Item -Path $OriginalInitrd -Destination (Join-Path $tempDir "initrd.gz")
        
        Push-Location $tempDir
        
        # Decompress initrd
        & $GzipPath -d "initrd.gz"
        if ($LASTEXITCODE -ne 0) { throw "gzip decompress failed" }
        
        # Create cpio archive with preseed.cfg
        # Build a minimal cpio newc archive manually (since Windows doesn't have cpio)
        $preseedBytes = [System.IO.File]::ReadAllBytes((Join-Path $tempDir "preseed.cfg"))
        $cpioData = New-Object System.Collections.Generic.List[byte]
        
        # cpio newc header for preseed.cfg
        $filename = "preseed.cfg"
        $filenameBytes = [System.Text.Encoding]::ASCII.GetBytes($filename)
        $filesize = $preseedBytes.Length
        
        # Build header string
        $header = "070701"  # magic (newc format)
        $header += "{0:X8}" -f 1           # ino
        $header += "{0:X8}" -f 0x81A4      # mode (regular file, 0644)
        $header += "{0:X8}" -f 0           # uid
        $header += "{0:X8}" -f 0           # gid
        $header += "{0:X8}" -f 1           # nlink
        $header += "{0:X8}" -f 0           # mtime
        $header += "{0:X8}" -f $filesize   # filesize
        $header += "{0:X8}" -f 0           # devmajor
        $header += "{0:X8}" -f 0           # devminor
        $header += "{0:X8}" -f 0           # rdevmajor
        $header += "{0:X8}" -f 0           # rdevminor
        $header += "{0:X8}" -f ($filenameBytes.Length + 1)  # namesize (including null)
        $header += "{0:X8}" -f 0           # check
        
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
        $cpioData.AddRange($headerBytes)
        $cpioData.AddRange($filenameBytes)
        $cpioData.Add(0)  # null terminator
        
        # Pad to 4-byte boundary
        while (($cpioData.Count % 4) -ne 0) { $cpioData.Add(0) }
        
        # File content
        $cpioData.AddRange($preseedBytes)
        
        # Pad to 4-byte boundary  
        while (($cpioData.Count % 4) -ne 0) { $cpioData.Add(0) }
        
        # Trailer entry
        $trailerName = "TRAILER!!!"
        $trailerNameBytes = [System.Text.Encoding]::ASCII.GetBytes($trailerName)
        
        $trailer = "070701"
        $trailer += "{0:X8}" -f 0           # ino
        $trailer += "{0:X8}" -f 0           # mode
        $trailer += "{0:X8}" -f 0           # uid
        $trailer += "{0:X8}" -f 0           # gid
        $trailer += "{0:X8}" -f 1           # nlink
        $trailer += "{0:X8}" -f 0           # mtime
        $trailer += "{0:X8}" -f 0           # filesize
        $trailer += "{0:X8}" -f 0           # devmajor
        $trailer += "{0:X8}" -f 0           # devminor
        $trailer += "{0:X8}" -f 0           # rdevmajor
        $trailer += "{0:X8}" -f 0           # rdevminor
        $trailer += "{0:X8}" -f ($trailerNameBytes.Length + 1)  # namesize
        $trailer += "{0:X8}" -f 0           # check
        
        $trailerBytes = [System.Text.Encoding]::ASCII.GetBytes($trailer)
        $cpioData.AddRange($trailerBytes)
        $cpioData.AddRange($trailerNameBytes)
        $cpioData.Add(0)
        
        # Pad to 4-byte boundary
        while (($cpioData.Count % 4) -ne 0) { $cpioData.Add(0) }
        
        # Append cpio archive to initrd
        $initrdPath = Join-Path $tempDir "initrd"
        $initrdBytes = [System.IO.File]::ReadAllBytes($initrdPath)
        $combinedBytes = $initrdBytes + $cpioData.ToArray()
        [System.IO.File]::WriteAllBytes($initrdPath, $combinedBytes)
        
        # Recompress
        & $GzipPath -9 "initrd"
        if ($LASTEXITCODE -ne 0) { throw "gzip compress failed" }
        
        Pop-Location
        
        # Copy result
        Copy-Item (Join-Path $tempDir "initrd.gz") $OutputInitrd -Force
        
        return $true
    }
    catch {
        Pop-Location -ErrorAction SilentlyContinue
        Write-Status "Failed to embed preseed: $_" "WARN"
        return $false
    }
    finally {
        Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
    }
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
    exit 1
}
Write-Status "QEMU found: $QemuDir" "OK"

# Find gzip
$GzipPath = Find-Gzip
if (-not $GzipPath) {
    Write-Status "gzip not found - install Git for Windows" "WARN"
    Write-Host "         winget install Git.Git" -ForegroundColor Gray
} else {
    Write-Status "gzip found: $GzipPath" "OK"
}

# Validate preseed file
$PreseedPath = Resolve-Path $PreseedFile -ErrorAction SilentlyContinue
if (-not $PreseedPath) {
    Write-Status "Preseed file not found: $PreseedFile" "ERROR"
    exit 1
}
Write-Status "Preseed: $PreseedPath" "OK"

# Check WHPX
$accelFlag = @()
if (-not $NoAccel) {
    if (Test-WhpxAvailable -QemuDir $QemuDir) {
        $accelFlag = @("-accel", "whpx")
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
    
    # Use curl.exe explicitly (not PowerShell's curl alias)
    & curl.exe --location --output $netbootTar $NetbootUrl --progress-bar
    
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
    Write-Status "Using existing disk image (use -Clean for fresh install)" "OK"
}

# Build paths
$kernel = Join-Path $WorkDir "tftp\debian-installer\$DebianArch\linux"
$originalInitrd = Join-Path $WorkDir "tftp\debian-installer\$DebianArch\initrd.gz"
$customInitrd = Join-Path $WorkDir "initrd-preseed.gz"

# Determine preseed delivery method
$preseedParam = ""
$initrd = $originalInitrd
$httpJob = $null

if ($GzipPath) {
    # Try to embed preseed in initrd (most reliable)
    $embedded = Add-PreseedToInitrd -OriginalInitrd $originalInitrd -PreseedFile $PreseedPath -OutputInitrd $customInitrd -GzipPath $GzipPath
    
    if ($embedded) {
        $initrd = $customInitrd
        $preseedParam = "file=/preseed.cfg"
        Write-Status "Preseed embedded in initrd" "OK"
    }
}

if (-not $preseedParam) {
    # Fall back to HTTP server
    Write-Status "Using HTTP server for preseed delivery..." "INFO"
    
    $httpPort = 8888
    Copy-Item -Path $PreseedPath -Destination (Join-Path $WorkDir "preseed.cfg") -Force
    
    # Start simple Python HTTP server
    $httpJob = Start-Job -ScriptBlock {
        param($dir, $port)
        Set-Location $dir
        python -m http.server $port
    } -ArgumentList $WorkDir, $httpPort
    
    Start-Sleep -Seconds 2
    $preseedParam = "preseed/url=http://10.0.2.2:$httpPort/preseed.cfg"
    Write-Status "HTTP server started on port $httpPort" "OK"
    Write-Status "If preseed fails, try installing Git for Windows for initrd embedding" "WARN"
}

# Kernel command line
$append = @(
    "auto=true",
    "priority=critical",
    $preseedParam,
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
Write-Host "  Preseed: $preseedParam" -ForegroundColor Gray
Write-Host ""
Write-Host "  Close the QEMU window to stop." -ForegroundColor Yellow
Write-Host "  After install: ssh -p 2222 admin@localhost" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor White
Write-Host ""

try {
    $qemuArgs = $accelFlag + @(
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
    
    & "$QemuDir\qemu-system-x86_64.exe" @qemuArgs
}
finally {
    Write-Host ""
    Write-Status "Cleaning up..."
    if ($httpJob) {
        Stop-Job -Job $httpJob -ErrorAction SilentlyContinue
        Remove-Job -Job $httpJob -ErrorAction SilentlyContinue
    }
    Write-Status "Done" "OK"
}
