#!/usr/bin/env pwsh
# =============================================================================
# TACO — Token Accumulator Counter for OpenCode
# Uninstall script for Windows
# =============================================================================

param(
    [switch]$System,
    [switch]$Help
)

if ($Help) {
    Write-Host @"
Usage: .\uninstall.ps1 [OPTIONS]

Uninstall TACO CLI from your system.

Options:
  -System    Uninstall system-wide installation (from C:\Program Files\taco)
  -Help      Show this help message

Examples:
  .\uninstall.ps1              # Uninstall user installation
  .\uninstall.ps1 -System     # Uninstall system-wide installation
"@
    exit 0
}

# Colors
$Bold = "`e[1m"
$Green = "`e[0;32m"
$Cyan = "`e[0;36m"
$Yellow = "`e[0;33m"
$Reset = "`e[0m"

function Info { param($msg) Write-Host "${Cyan}  ->${Reset} $msg" }
function Success { param($msg) Write-Host "${Green}  [OK]${Reset} $msg" }
function Warn { param($msg) Write-Host "${Yellow}  [WARN]${Reset} $msg" }

Write-Host ""
Write-Host "${Bold}🌮 TACO — Uninstall${Reset}"
Write-Host ""

# Determine installation directory
if ($System) {
    $TacoDir = "C:\Program Files\taco"
} else {
    $TacoDir = "$env:USERPROFILE\.taco"
}

# Remove TACO installation directory
if (Test-Path $TacoDir) {
    try {
        Remove-Item -Path $TacoDir -Recurse -Force
        Success "Removed TACO directory → $TacoDir"
    } catch {
        Warn "Could not remove $TacoDir : $_"
    }
} else {
    Info "TACO directory not found — skipping"
}

# Remove from PATH (user PATH only)
if (-not $System) {
    $UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($UserPath -like "*$TacoDir*") {
        $NewPath = ($UserPath -split ';' | Where-Object { $_ -ne $TacoDir }) -join ';'
        [Environment]::SetEnvironmentVariable("PATH", $NewPath, "User")
        Info "Removed $TacoDir from user PATH"
    }
}

# Remove cache directory
$CacheDir = "$env:USERPROFILE\.cache\taco"
if (Test-Path $CacheDir) {
    try {
        Remove-Item -Path $CacheDir -Recurse -Force
        Success "Removed TACO cache → $CacheDir"
    } catch {
        Warn "Could not remove cache: $_"
    }
}

# Remove config directory
$ConfigDir = "$env:USERPROFILE\.config\taco"
if (Test-Path $ConfigDir) {
    $response = Read-Host "Remove TACO configuration? [y/N]"
    if ($response -match '^[Yy]$') {
        try {
            Remove-Item -Path $ConfigDir -Recurse -Force
            Success "Removed TACO configuration → $ConfigDir"
        } catch {
            Warn "Could not remove config: $_"
        }
    } else {
        Info "Keeping configuration at $ConfigDir"
    }
}

Write-Host ""
Write-Host "${Green}${Bold}Uninstall complete.${Reset}"
Write-Host ""
Write-Host "Note: TACO data in OpenCode's database is preserved."
Write-Host "To remove that data, delete OpenCode's opencode.db file."
Write-Host ""
