#!/usr/bin/env pwsh
# Install TACO (Token Accumulator Counter) for OpenCode
# https://github.com/bulga138/token-accumulator-counter-opencode
#
# Usage:
#   .\install.ps1                    # Install to ~/.taco
#   .\install.ps1 -System           # System-wide install (requires admin)
#   .\install.ps1 -Help             # Show help

param(
    [switch]$System,
    [switch]$Help
)

# --- Remote bootstrap: detect piped execution (irm | iex) ---
# When piped, $MyInvocation.MyCommand.Path is empty — no local repo files exist.
# Download the latest release archive and re-invoke from the extracted dir.
if (-not $MyInvocation.MyCommand.Path) {
    $Repo = "bulga138/token-accumulator-counter-opencode"
    $ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"

    try {
        Write-Host "Fetching latest TACO release..."
        $Release = Invoke-RestMethod -Uri $ApiUrl -ErrorAction Stop
        $LatestTag = $Release.tag_name
    } catch {
        Write-Host "Error: Could not determine latest release from GitHub" -ForegroundColor Red
        exit 1
    }

    $ArchiveUrl = "https://github.com/$Repo/releases/download/$LatestTag/taco-release-$LatestTag.tar.gz"
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
            exit 1
        }

        $ExtractedScript = Join-Path $TempDir "install.ps1"
        if (Test-Path $ExtractedScript) {
            $ScriptArgs = @()
            if ($System) { $ScriptArgs += "-System" }
            & $ExtractedScript @ScriptArgs
        } else {
            Write-Host "Error: install.ps1 not found in downloaded archive" -ForegroundColor Red
            exit 1
        }
    } finally {
        Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    exit $LASTEXITCODE
}

if ($Help) {
    Write-Host @"
Usage: .\install.ps1 [OPTIONS]

Install TACO CLI for OpenCode telemetry tracking.

Options:
  -System    Install system-wide (requires admin, goes to C:\Program Files\taco)
  -Help      Show this help message

Examples:
  .\install.ps1              # User install to ~/.taco (recommended)
  .\install.ps1 -System     # System-wide install
"@
    exit 0
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
function Error { param($msg) Write-Host "${Red}  [ERROR]${Reset} $msg" -ForegroundColor Red; exit 1 }

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

Write-Host ""
Write-Host "${Bold}🌮 Installing TACO${Reset}"
Write-Host ""

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

if ($NodeMajor -lt 18) {
    Error "Node.js 18+ is required. Found: $NodeVersion"
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

# Build from source
# Always rebuild when running from a repo checkout (tsconfig.json present).
# This prevents the stale-install problem where dist/ exists from a previous
# build but the source has since been edited — the old guard
# `-not (Test-Path dist)` would silently copy stale compiled output.
# If running from a pre-built release archive (no tsconfig.json), use the
# dist/ that shipped with the archive, failing if it is missing.
if (Test-Path "$ScriptDir\tsconfig.json") {
    Info "Building from source..."

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

# Install
Write-Host ""
Write-Host "${Bold}[1/2] Installing taco...${Reset}"

# Create install directory
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

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

# Copy package.json, uninstall script, and install dependencies
Copy-Item -Path "$ScriptDir\package.json" -Destination $InstallDir -Force
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

$TacoExe = "$InstallDir\taco.cmd"
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
        Warn "Could not run taco wrapper at $TacoExe"
    }
} else {
    Warn "taco wrapper not found at $TacoExe"
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
    & $TacoExe overview --format json 2>&1 | Out-Null
    Success "Cache ready"
} catch {
    # Non-fatal — cache will be built on first use
}

if (-not (Get-Command taco -ErrorAction SilentlyContinue)) {
    Info "Restart your terminal, then try: taco"
}

Write-Host ""
