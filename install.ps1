#!/usr/bin/env pwsh
# Install TACO (Token Accumulator Counter) for OpenCode
# https://github.com/bulga138/taco
#
# Usage:
#   .\install.ps1                    # Install to ~/.taco
#   .\install.ps1 -System           # System-wide install (requires admin)
#   .\install.ps1 -Help             # Show help

param(
    [switch]$System,
    [switch]$Help,
    [switch]$PreferSource
)

# --- Remote bootstrap: detect piped execution (irm | iex) ---
# When piped, $MyInvocation.MyCommand.Path is empty — no local repo files exist.
# Download the requested (or latest) release archive and re-invoke from the extracted dir.
#
# Install specific version (set env var before piping):
#   $env:TACO_VERSION="v0.1.4"; irm https://raw.githubusercontent.com/bulga138/taco/master/install.ps1 | iex
# Install latest:
#   irm https://raw.githubusercontent.com/bulga138/taco/master/install.ps1 | iex
if (-not $MyInvocation.MyCommand.Path) {
    $Repo = "bulga138/taco"

    # Allow caller to pin a version via environment variable
    $LatestTag = $env:TACO_VERSION
    if ($LatestTag) {
        # Normalise: ensure it starts with 'v'
        if (-not $LatestTag.StartsWith('v')) { $LatestTag = "v$LatestTag" }
        Write-Host "Installing TACO $LatestTag (pinned)..."
    } else {
        # Discover latest tag via git ls-remote — no API rate limits
        Write-Host "Fetching latest TACO release..."
        try {
            $GitOutput = & git ls-remote --tags "https://github.com/$Repo.git" 2>$null
            $LatestTag = $GitOutput `
                | Select-String -Pattern 'v(\d+\.\d+\.\d+)$' `
                | ForEach-Object { $_.Matches[0].Value } `
                | Sort-Object { [version]($_ -replace '^v','') } `
                | Select-Object -Last 1
        } catch {
            $LatestTag = $null
        }
        if (-not $LatestTag) {
            Write-Host "Error: Could not determine latest release. Check your internet connection." -ForegroundColor Red
            Write-Host "To install a specific version, run:" -ForegroundColor Yellow
            Write-Host '  $env:TACO_VERSION="v0.1.4"; irm https://raw.githubusercontent.com/bulga138/taco/master/install.ps1 | iex'
            return
        }
        Write-Host "Latest release: $LatestTag"
    }

    $Version = $LatestTag -replace '^v', ''
    $ArchiveUrl = "https://github.com/$Repo/releases/download/$LatestTag/taco-release-$Version.tar.gz"
    $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "taco-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

    try {
        Write-Host "Downloading TACO $LatestTag..."
        $ArchivePath = Join-Path $TempDir "taco-release.tar.gz"
        Invoke-WebRequest -Uri $ArchiveUrl -OutFile $ArchivePath -ErrorAction Stop

        if (Get-Command tar -ErrorAction SilentlyContinue) {
            tar -xzf $ArchivePath -C $TempDir
            } else {
                Write-Host "Error: 'tar' not found. Please install tar or use PowerShell 7+." -ForegroundColor Red
                return
            }

        $ExtractedScript = Join-Path $TempDir "install.ps1"
        if (Test-Path $ExtractedScript) {
            $ScriptArgs = @()
            if ($System) { $ScriptArgs += "-System" }
            & $ExtractedScript @ScriptArgs
        } else {
            Write-Host "Error: install.ps1 not found in downloaded archive" -ForegroundColor Red
            return
        }
    } finally {
        Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
} else {
    if ($Help) {
    Write-Host @"
Usage: .\install.ps1 [OPTIONS]

Install TACO CLI for OpenCode telemetry tracking.

Options:
  -System         Install system-wide (requires admin, goes to C:\Program Files\taco)
  -PreferSource   Build from source instead of downloading binary
  -Help           Show this help message

Examples:
  .\install.ps1              # User install to ~/.taco (recommended)
  .\install.ps1 -System     # System-wide install
  .\install.ps1 -PreferSource  # Build from source
"@
    return
}

# Colors
$Bold = "`e[1m"
$Green = "`e[0;32m"
$Yellow = "`e[0;33m"
$Cyan = "`e[0;36m"
$Red = "`e[0;31m"
$Reset = "`e[0m"

function Info { param($msg) Write-Host "${Cyan}  ->${Reset} $msg" }
function Success { param($msg) Write-Host "${Green}  [OK]${Reset} $msg" }
function Warn { param($msg) Write-Host "${Yellow}  [WARN]${Reset} $msg" }
function Error { param($msg) Write-Host "${Red}  [ERROR]${Reset} $msg" -ForegroundColor Red; throw "Installation failed" }

# Offer to install Bun if not already present
function Prompt-InstallBun {
    # Already installed — nothing to do
    if (Get-Command bun -ErrorAction SilentlyContinue) { return }

    # Non-interactive — skip silently
    if (-not [Environment]::UserInteractive) { return }

    Write-Host ""
    Write-Host "${Bold}Bun not detected${Reset}"
    Write-Host "Bun provides faster startup and built-in SQLite (no native compilation needed)."
    Write-Host ""
    $InstallBun = Read-Host "Would you like to install Bun? [Y/n]"
    if ([string]::IsNullOrWhiteSpace($InstallBun)) { $InstallBun = "Y" }

    if ($InstallBun -notmatch '^[Yy]$') {
        Info "Skipping Bun installation — continuing with Node.js"
        return
    }

    Write-Host ""
    Write-Host "${Bold}Choose install method:${Reset}"
    Write-Host "  1) irm bun.sh/install.ps1 | iex  (Recommended)"
    Write-Host "  2) npm install -g bun"
    $BunMethod = Read-Host "Select [1/2]"
    if ([string]::IsNullOrWhiteSpace($BunMethod)) { $BunMethod = "1" }

    try {
        switch ($BunMethod) {
            "1" { Invoke-Expression "& ([scriptblock]::Create((Invoke-RestMethod 'https://bun.sh/install.ps1')))" }
            "2" { npm install -g bun }
            default { Warn "Invalid choice — skipping Bun install"; return }
        }
    } catch {
        Warn "Bun installation encountered an error — continuing with Node.js"
        Warn "You can install Bun manually: https://bun.com/docs/installation"
        return
    }

    # Add freshly-installed Bun to current session PATH so runtime detection finds it
    $BunBinPath = "$env:USERPROFILE\.bun\bin"
    if (Test-Path $BunBinPath) {
        $env:PATH = "$BunBinPath;$env:PATH"
    }

    # Verify
    if (Get-Command bun -ErrorAction SilentlyContinue) {
        $BunVer = & bun --version 2>$null
        Success "Bun $BunVer installed successfully"
    } else {
        Warn "Bun installation may have failed — continuing with Node.js"
        Warn "You can install Bun manually: https://bun.com/docs/installation"
    }
}

# --- Detect Architecture ---
function Get-Architecture {
    $arch = $env:PROCESSOR_ARCHITECTURE
    switch ($arch) {
        "AMD64" { return "x64" }
        "ARM64" { return "arm64" }
        default { return "unknown" }
    }
}

$OS = "windows"
$Arch = Get-Architecture
$Ext = ".exe"

# --- Try to download pre-built binary ---
function Download-Binary {
    param($Version, $InstallDir)
    
    $Repo = "bulga138/taco"
    
    $VersionNoV = $Version -replace '^v', ''
    $BinaryName = "taco-$VersionNoV-$OS-$Arch$Ext"
    $BinaryUrl = "https://github.com/$Repo/releases/download/$Version/$BinaryName"
    $ChecksumUrl = "https://github.com/$Repo/releases/download/$Version/$BinaryName.sha256"
    Info "Checking for pre-built binary: $BinaryName..."
    
    try {
        # Check if binary exists
        $response = Invoke-WebRequest -Uri $BinaryUrl -Method Head -ErrorAction Stop -TimeoutSec 10
        if ($response.StatusCode -eq 200) {
            Info "Downloading pre-built binary..."
            $TmpFile = Join-Path $InstallDir "$BinaryName.tmp"
            
            try {
                Invoke-WebRequest -Uri $BinaryUrl -OutFile $TmpFile -ErrorAction Stop -TimeoutSec 300
                
                # Download and verify checksum if available
                $ChecksumFile = Join-Path $InstallDir "$BinaryName.sha256"
                try {
                    Invoke-WebRequest -Uri $ChecksumUrl -OutFile $ChecksumFile -ErrorAction Stop -TimeoutSec 30
                    Info "Verifying checksum..."
                    
                    $ExpectedChecksum = (Get-Content $ChecksumFile -Raw).Trim().Split()[0]
                    $ActualChecksum = (Get-FileHash $TmpFile -Algorithm SHA256).Hash.ToLower()
                    
                    if ($ExpectedChecksum -eq $ActualChecksum) {
                        Success "Checksum verified"
                    } else {
                        Warn "Checksum mismatch! Expected: $ExpectedChecksum, Got: $ActualChecksum"
                        Warn "Binary may be corrupted, falling back to source build"
                        Remove-Item $TmpFile -Force -ErrorAction SilentlyContinue
                        Remove-Item $ChecksumFile -Force -ErrorAction SilentlyContinue
                        return $false
                    }
                    Remove-Item $ChecksumFile -Force -ErrorAction SilentlyContinue
                } catch {
                    Info "No checksum file available, skipping verification"
                }
                
                $FinalPath = Join-Path $InstallDir "taco.exe"
                Move-Item -Path $TmpFile -Destination $FinalPath -Force
                Success "Binary installed: $FinalPath"
                return $true
            } catch {
                Warn "Download failed: $_. Will build from source instead"
                if (Test-Path $TmpFile) { Remove-Item $TmpFile -Force }
                return $false
            }
        }
    } catch {
        Info "No pre-built binary for ${OS}-${Arch} (HTTP error), building from source"
        return $false
    }
    
    return $false
}

Write-Host ""
Write-Host "${Bold}🌮 Installing TACO${Reset}"
Write-Host ""
Info "Detected platform: ${OS}-${Arch}"

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Check Node.js
Info "Checking Node.js version..."
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
    # Try common Windows locations
    $PossiblePaths = @(
        "C:\Program Files\nodejs\node.exe",
        "C:\Program Files (x86)\nodejs\node.exe",
        "$env:LOCALAPPDATA\nodejs\node.exe",
        "$env:APPDATA\npm\node.exe"
    )
    
    foreach ($Path in $PossiblePaths) {
        if (Test-Path $Path) {
            $env:PATH = "$([System.IO.Path]::GetDirectoryName($Path));$env:PATH"
            $NodeCmd = Get-Command node -ErrorAction SilentlyContinue
            if ($NodeCmd) { break }
        }
    }
}

if (-not $NodeCmd) {
    Error "Node.js is required but not installed. Please install Node.js 18+ from https://nodejs.org"
}

$NodeVersion = & node --version
$NodeVersion = $NodeVersion -replace '^v', ''
$NodeMajor = [int]($NodeVersion -split '\.')[0]

if ($NodeMajor -lt 22) {
    Error "Node.js 22+ is required. Found: $NodeVersion"
}

Success "Node.js $NodeVersion detected"

# Offer Bun installation
Prompt-InstallBun

# Determine install directory
if ($System) {
    $InstallDir = "C:\Program Files\taco"
} else {
    $InstallDir = "$env:USERPROFILE\.taco"
}

Info "Installation directory: $InstallDir"

# --- Try binary download first ---
$BinaryInstalled = $false
if (-not $PreferSource -and $LatestTag) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    if (Download-Binary -Version $LatestTag -InstallDir $InstallDir) {
        $BinaryInstalled = $true
    }
}

# --- Build from source (fallback) ---
if (-not $BinaryInstalled) {
    if ($PreferSource) {
        Info "Building from source (--PreferSource specified)..."
    } else {
        Info "Building from source..."
    }

    if (Test-Path "$ScriptDir\tsconfig.json") {
        $PnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
        $NpmCmd  = Get-Command npm  -ErrorAction SilentlyContinue

        if ($PnpmCmd) {
            $BuildCmd = "pnpm run build"
        } elseif ($NpmCmd) {
            $BuildCmd = "npm run build"
        } else {
            Error "Neither pnpm nor npm found. Please install pnpm: https://pnpm.io/installation"
        }

        Push-Location $ScriptDir
        try {
            Invoke-Expression $BuildCmd
            if ($LASTEXITCODE -ne 0) { Error "Build failed" }
        } finally {
            Pop-Location
        }
        Success "Built successfully"
    } elseif (-not (Test-Path "$ScriptDir\dist")) {
        Error "No dist/ folder and no source to build from. Please build first: pnpm run build"
    }
}

# Install
Write-Host ""
Write-Host "${Bold}[1/2] Installing taco...${Reset}"

# Create install directory
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# If we have a standalone binary, we're done
if ($BinaryInstalled) {
    Info "Pre-built binary installed, setting up runtime..."
    
    # Copy minimal files needed for the binary to work
    Copy-Item -Path "$ScriptDir\package.json" -Destination $InstallDir -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "$ScriptDir\uninstall.ps1" -Destination $InstallDir -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "$ScriptDir\uninstall.sh" -Destination $InstallDir -Force -ErrorAction SilentlyContinue
    
    # Install runtime dependencies non-interactively
    $NpmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($NpmCmd) {
        Push-Location $InstallDir
        try {
            $null = npm install --omit=dev --silent --no-audit --no-fund 2>&1
        } catch {
            # Non-fatal
        } finally {
            Pop-Location
        }
    }
    
    Success "Installed to $InstallDir\taco.exe"
} else {
    # Need runtime wrapper (Node.js/Bun)
    
    # Check for Bun
    $BunCmd = Get-Command bun -ErrorAction SilentlyContinue
    $NodeCmd = Get-Command node -ErrorAction SilentlyContinue

    if ($BunCmd) {
        Info "Bun detected - using Bun for faster performance"
        $Runtime = "bun"
        $RunCmd = "bun run"
    } elseif ($NodeCmd) {
        $Runtime = "node"
        $RunCmd = "node"
    } else {
        Error "Neither Bun nor Node.js found. Please install Bun: https://bun.sh or Node.js: https://nodejs.org"
    }

    # Create wrapper scripts
    $TacoWrapper = "$InstallDir\taco.cmd"
    $TacoPs1 = "$InstallDir\taco.ps1"
    $TacoSh = "$InstallDir\taco"

    # CMD wrapper (for Windows Command Prompt)
    @"
@echo off
$RunCmd "$InstallDir\dist\bin\taco.js" %*
"@ | Set-Content -Path $TacoWrapper -Encoding ASCII

    # PowerShell wrapper
    @"
#!/usr/bin/env pwsh
$RunCmd '$InstallDir\dist\bin\taco.js' @args
"@ | Set-Content -Path $TacoPs1 -Encoding UTF8

    # Shell wrapper (for Git Bash)
    @"
#!/bin/sh
exec $RunCmd "$InstallDir/dist/bin/taco.js" "`$@"
"@ | Set-Content -Path $TacoSh -Encoding UTF8

    # Remove stale dist before copying so no old compiled files survive a rename/delete.
    if (Test-Path "$InstallDir\dist") {
        Remove-Item -Path "$InstallDir\dist" -Recurse -Force
    }
    Copy-Item -Path "$ScriptDir\dist" -Destination $InstallDir -Recurse -Force
    # Remove dist/package.json so version is read from the correct $InstallDir/package.json
    Remove-Item -Path "$InstallDir\dist\package.json" -Force -ErrorAction SilentlyContinue

    # Copy package.json, uninstall scripts, and install dependencies
    Copy-Item -Path "$ScriptDir\package.json" -Destination $InstallDir -Force
    if (Test-Path "$ScriptDir\uninstall.ps1") {
        Copy-Item -Path "$ScriptDir\uninstall.ps1" -Destination $InstallDir -Force
    }
    if (Test-Path "$ScriptDir\uninstall.sh") {
        Copy-Item -Path "$ScriptDir\uninstall.sh" -Destination $InstallDir -Force
    }
    Info "Installing dependencies..."
    Push-Location $InstallDir
    try {
        $null = npm install --omit=dev --silent 2>&1
        Info "Dependencies installed"
    } catch {
        Warn "Failed to install dependencies, TACO may not work properly"
    } finally {
        Pop-Location
    }

    Success "Installed to $InstallDir"
}

Success "Installed to $InstallDir"

# Add to PATH
if (-not $System) {
    $UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($UserPath -notlike "*$InstallDir*") {
        [Environment]::SetEnvironmentVariable("PATH", "$UserPath;$InstallDir", "User")
        Info "Added $InstallDir to your user PATH"
    }
    
    # Also add to current session so it works immediately
    $env:PATH = "$InstallDir;$env:PATH"
    Info "Added to current session PATH - taco is ready to use now!"
}

# OpenCode integration info
Write-Host ""
Write-Host "${Bold}[2/2] OpenCode Integration${Reset}"
Write-Host ""
Write-Host "${Cyan}Use TACO in OpenCode with zero LLM tokens:${Reset}"
Write-Host ""
Write-Host "  !taco overview     # Show usage stats"
Write-Host "  !taco today        # Today's usage"
Write-Host "  !taco sessions     # Recent sessions"
Write-Host "  !taco view         # Full dashboard"
Write-Host ""
Write-Host "${Yellow}Note:${Reset} The '!' prefix runs commands locally without sending to AI."
Write-Host ""
Write-Host "${Cyan}API Gateway Integration (optional):${Reset}"
Write-Host ""
Write-Host "  If your AI traffic goes through a proxy (LiteLLM, OpenRouter, etc.),"
Write-Host "  configure TACO to show real gateway costs alongside local estimates:"
Write-Host ""
Write-Host "    taco config gateway --setup"
Write-Host ""
Write-Host "  Works with any JSON endpoint — no hard-coded format."

# Done
Write-Host ""
Write-Host "${Green}${Bold}All done!${Reset}"
Write-Host ""
Write-Host "Try these commands:"
Write-Host "  taco           # Overview with charts"
Write-Host "  taco models    # Which models you use"
Write-Host "  taco today     # Today's usage"
Write-Host "  taco --help    # All commands"
Write-Host ""
Write-Host "${Cyan}Use in OpenCode (zero LLM tokens):${Reset}"
Write-Host "  !taco overview     # Show usage stats"
Write-Host "  !taco today        # Today's usage"
Write-Host "  !taco sessions     # Recent sessions"
Write-Host "  !taco view         # Full dashboard"
Write-Host ""

# --- Post-install verification ---
Write-Host ""
Write-Host "${Bold}Post-install verification${Reset}"

# Determine which executable to check
if ($BinaryInstalled) {
    $TacoExe = "$InstallDir\taco.exe"
} else {
    $TacoExe = "$InstallDir\taco.cmd"
}

if (Test-Path $TacoExe) {
    try {
        # Capture the output as a single string
        $RawVersionOutput = (& $TacoExe --version 2>$null) | Out-String
        # Use Regex to find the version number (e.g., v0.1.1)
        if ($RawVersionOutput -match 'v(\d+\.\d+\.\d+)') {
            $TacoVersion = $matches[1]
            Success "taco v$TacoVersion is working"
        } else {
            Warn "taco installed but --version check failed"
        }
    } catch {
        Warn "Could not run taco at $TacoExe"
    }
} else {
    Warn "taco not found at $TacoExe"
}

if (Get-Command bun -ErrorAction SilentlyContinue) {
    $BunVer = & bun --version 2>$null
    Info "Runtime: Bun $BunVer"
} else {
    $NodeVer = & node --version 2>$null
    Info "Runtime: Node.js $NodeVer"
}

# Warm the cache so the first real 'taco' run is instant.
# 'overview --format json' is the only command that writes the heatmap cache and
# takes the lightest code path (single SQLite aggregation, no streaming).
Info "Warming cache..."
try {
    if ($BinaryInstalled) {
        & $TacoExe overview --format json 2>&1 | Out-Null
    } else {
        & $TacoExe overview --format json 2>&1 | Out-Null
    }
    Success "Cache ready"
} catch {
    # Non-fatal — cache will be built on first use
}

if (-not (Get-Command taco -ErrorAction SilentlyContinue)) {
    Info "Restart your terminal, then try: taco"
}

Write-Host ""
}
