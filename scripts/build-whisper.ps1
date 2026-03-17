#Requires -Version 5.1
<#
.SYNOPSIS
    Builds whisper_kuro.dll and copies it to resources/whisper/.

.DESCRIPTION
    1. Ensures the whisper.cpp git submodule is initialised.
    2. Configures and builds with CMake (Release).
    3. Copies the resulting DLL to resources/whisper/.

.NOTES
    Requirements:
      - Git (for submodule init)
      - CMake 3.16+
      - MSVC (Visual Studio 2019/2022) or another CMake-compatible C++ toolchain

    After the build, download a whisper GGML model and place it in resources/whisper/:
      e.g. ggml-base.en.bin  (English-only, ~140 MB, fast)
           ggml-small.bin    (multilingual, ~460 MB)
      Download from: https://huggingface.co/ggerganov/whisper.cpp/tree/main
#>

$ErrorActionPreference = 'Stop'

$Root        = Split-Path $PSScriptRoot -Parent
$ThirdParty  = Join-Path $Root 'third_party'
$WhisperSrc  = Join-Path $ThirdParty 'whisper.cpp'
$BuildDir    = Join-Path $ThirdParty 'build'
$ResDir      = Join-Path $Root 'resources\whisper'

function Write-Step([string]$msg) {
    Write-Host "  $msg" -ForegroundColor Cyan
}

Write-Host ''
Write-Host '=== KuroChan — Whisper DLL build ===' -ForegroundColor Magenta
Write-Host ''

# ── 1. Initialise whisper.cpp submodule ───────────────────────────────────────
Write-Step 'Checking whisper.cpp submodule...'

if (-not (Test-Path (Join-Path $WhisperSrc 'CMakeLists.txt'))) {
    Write-Step 'whisper.cpp not found — adding submodule and initialising...'
    Push-Location $Root
    try {
        # Add submodule only if .gitmodules doesn't already reference it
        $gitmodules = Join-Path $Root '.gitmodules'
        $hasEntry   = (Test-Path $gitmodules) -and
                      (Select-String -Path $gitmodules -Pattern 'whisper\.cpp' -Quiet)

        if (-not $hasEntry) {
            git submodule add https://github.com/ggerganov/whisper.cpp.git third_party/whisper.cpp
        }
        git submodule update --init --recursive third_party/whisper.cpp
    } finally {
        Pop-Location
    }
} else {
    Write-Step 'whisper.cpp submodule present.'
}

# ── 2. CMake configure ────────────────────────────────────────────────────────
Write-Step 'Configuring CMake...'
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
Push-Location $BuildDir

try {
    cmake $ThirdParty -DCMAKE_BUILD_TYPE=Release
    if ($LASTEXITCODE -ne 0) { throw 'CMake configure failed.' }

    # ── 3. CMake build ────────────────────────────────────────────────────────
    Write-Step 'Building whisper_kuro (this may take several minutes on first run)...'
    cmake --build . --config Release --target whisper_kuro
    if ($LASTEXITCODE -ne 0) { throw 'CMake build failed.' }
} finally {
    Pop-Location
}

# ── 4. Locate and copy the DLL ────────────────────────────────────────────────
Write-Step 'Locating whisper_kuro.dll...'

$candidates = @(
    (Join-Path $BuildDir 'out\whisper_kuro.dll'),
    (Join-Path $BuildDir 'out\Release\whisper_kuro.dll'),
    (Join-Path $BuildDir 'Release\whisper_kuro.dll'),
    (Join-Path $BuildDir 'whisper_kuro.dll')
)

$dllPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $dllPath) {
    Write-Error "Build succeeded but whisper_kuro.dll was not found in any expected location:`n$($candidates -join "`n")"
    exit 1
}

New-Item -ItemType Directory -Force -Path $ResDir | Out-Null
Copy-Item -Path $dllPath -Destination $ResDir -Force

Write-Host ''
Write-Host '  whisper_kuro.dll copied to resources/whisper/' -ForegroundColor Green
Write-Host ''
