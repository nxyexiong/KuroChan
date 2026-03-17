#Requires -Version 5.1
<#
.SYNOPSIS
    Builds KuroChan into a distributable NSIS installer and portable .exe.

.DESCRIPTION
    Steps performed:
      1.  Verify Node.js / npm are on PATH.
      2.  Build the whisper_kuro.dll native addon (skipped only when -SkipWhisper is passed).
      3.  Run `npm install` to ensure all Node dependencies are present.
      4.  Bundle the renderer with webpack in production mode.
      5.  Package with electron-builder -> release\
            KuroChan-<version>-setup.exe      (NSIS installer)
            KuroChan-<version>-portable.exe   (self-contained portable)

.PARAMETER SkipWhisper
    Skip the whisper DLL build entirely (useful on machines without MSVC/CMake).

.PARAMETER NpmInstall
    Force `npm install` even when node_modules is already present.

.EXAMPLE
    .\build.ps1
    .\build.ps1 -SkipWhisper
#>
[CmdletBinding()]
param(
    [switch]$SkipWhisper,
    [switch]$NpmInstall
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Step([string]$msg) {
    Write-Host ''
    Write-Host "  >> $msg" -ForegroundColor Cyan
}

function Write-OK([string]$msg) {
    Write-Host "     $msg" -ForegroundColor Green
}

function Assert-ExitCode([int]$code, [string]$step) {
    if ($code -ne 0) { throw "$step failed (exit $code)." }
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

Write-Host ''
Write-Host '======================================' -ForegroundColor Magenta
Write-Host '   KuroChan  --  Release Build        ' -ForegroundColor Magenta
Write-Host '======================================' -ForegroundColor Magenta
Write-Host ''

# ---------------------------------------------------------------------------
# 1. Verify Node / npm
# ---------------------------------------------------------------------------

Write-Step 'Checking prerequisites...'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js not found on PATH. Install from https://nodejs.org/'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm not found on PATH. Install Node.js from https://nodejs.org/'
}

$nodeVer = node --version
$npmVer  = npm  --version
Write-OK "Node.js $nodeVer  /  npm $npmVer"

# ---------------------------------------------------------------------------
# 2. Whisper DLL
# ---------------------------------------------------------------------------

$DllDest = Join-Path $Root 'resources\whisper\whisper_kuro.dll'

if ($SkipWhisper) {
    Write-Step 'Whisper DLL build -- SKIPPED (-SkipWhisper flag set).'
} else {
    Write-Step 'Building Whisper DLL (this may take several minutes the first time)...'
    $whisperScript = Join-Path $Root 'scripts\build-whisper.ps1'
    & $whisperScript
    Assert-ExitCode $LASTEXITCODE 'Whisper DLL build'
    Write-OK 'whisper_kuro.dll built successfully.'
}

# ---------------------------------------------------------------------------
# 3. npm install
# ---------------------------------------------------------------------------

Write-Step 'Installing Node dependencies...'

$nodeModules = Join-Path $Root 'node_modules'
if ((Test-Path $nodeModules) -and -not $NpmInstall) {
    Write-OK 'node_modules already present -- skipping (pass -NpmInstall to force).'
} else {
    Push-Location $Root
    try {
        npm install
        Assert-ExitCode $LASTEXITCODE 'npm install'
    } finally {
        Pop-Location
    }
    Write-OK 'npm install complete.'
}

# Confirm electron-builder is available (added to devDependencies)
$ebCmd = Join-Path $Root 'node_modules\.bin\electron-builder.cmd'
if (-not (Test-Path $ebCmd)) {
    Write-Step 'electron-builder not found -- installing...'
    Push-Location $Root
    try {
        npm install --save-dev electron-builder
        Assert-ExitCode $LASTEXITCODE 'electron-builder install'
    } finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------------------
# 4. Webpack production bundle
# ---------------------------------------------------------------------------

Write-Step 'Building renderer bundle (webpack -- production mode)...'

Push-Location $Root
try {
    npx webpack --config webpack.config.js --mode production
    Assert-ExitCode $LASTEXITCODE 'webpack build'
} finally {
    Pop-Location
}

Write-OK 'dist\bundle.js written.'

# ---------------------------------------------------------------------------
# 5. electron-builder
# ---------------------------------------------------------------------------

Write-Step 'Packaging with electron-builder (NSIS + portable)...'

Push-Location $Root
try {
    npx electron-builder --win nsis portable
    Assert-ExitCode $LASTEXITCODE 'electron-builder'
} finally {
    Pop-Location
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

$releaseDir = Join-Path $Root 'release'
Write-Host ''
Write-Host '======================================================' -ForegroundColor Green
Write-Host '   Build complete!                                    ' -ForegroundColor Green
Write-Host '======================================================' -ForegroundColor Green
Write-Host ''
Write-Host "  Output folder: $releaseDir" -ForegroundColor Green
Write-Host ''

if (Test-Path $releaseDir) {
    Get-ChildItem -Path $releaseDir -Filter '*.exe' |
        ForEach-Object { Write-Host "    $($_.Name)" -ForegroundColor Yellow }
}

Write-Host ''