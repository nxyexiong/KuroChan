@echo off
setlocal enabledelayedexpansion

:: ── Parse arguments ──────────────────────────────────────────────────────────
::   /skipwhisper   - skip whisper DLL build
::   /npminstall    - force npm install even if node_modules exists
set "SKIP_WHISPER=0"
set "NPM_INSTALL=0"

for %%i in (%*) do (
    if /i "%%i"=="/skipwhisper"   set "SKIP_WHISPER=1"
    if /i "%%i"=="--skipwhisper"  set "SKIP_WHISPER=1"
    if /i "%%i"=="/npminstall"    set "NPM_INSTALL=1"
    if /i "%%i"=="--npminstall"   set "NPM_INSTALL=1"
)

:: Resolve the workspace root (same directory as this script)
pushd "%~dp0"
set "ROOT=%CD%"
popd

echo.
echo ======================================
echo    KuroChan  --  Release Build
echo ======================================
echo.

:: ── 1. Verify Node / npm ─────────────────────────────────────────────────────
echo   ^>^> Checking prerequisites...

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found on PATH. Install from https://nodejs.org/
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm not found on PATH. Install Node.js from https://nodejs.org/
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set "NODE_VER=%%v"
for /f "tokens=*" %%v in ('npm --version')  do set "NPM_VER=%%v"
echo      Node.js %NODE_VER%  /  npm %NPM_VER%

:: ── 2. Whisper DLL ───────────────────────────────────────────────────────────
if "%SKIP_WHISPER%"=="1" (
    echo.
    echo   ^>^> Whisper DLL build -- SKIPPED ^(/skipwhisper flag set^).
) else (
    echo.
    echo   ^>^> Building Whisper DLL ^(this may take several minutes the first time^)...
    call "%ROOT%\scripts\build-whisper.cmd"
    if errorlevel 1 (
        echo ERROR: Whisper DLL build failed.
        exit /b 1
    )
    echo      whisper_kuro.dll built successfully.
)

:: ── 3. npm install ───────────────────────────────────────────────────────────
echo.
echo   ^>^> Installing Node dependencies...

if exist "%ROOT%\node_modules" (
    if "%NPM_INSTALL%"=="0" (
        echo      node_modules already present -- skipping ^(pass /npminstall to force^).
        goto :check_electron_builder
    )
)

pushd "%ROOT%"
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed.
    popd
    exit /b 1
)
popd
echo      npm install complete.

:check_electron_builder
if not exist "%ROOT%\node_modules\.bin\electron-builder.cmd" (
    echo.
    echo   ^>^> electron-builder not found -- installing...
    pushd "%ROOT%"
    call npm install --save-dev electron-builder
    if errorlevel 1 (
        echo ERROR: electron-builder install failed.
        popd
        exit /b 1
    )
    popd
)

:: ── 4. Webpack production bundle ─────────────────────────────────────────────
echo.
echo   ^>^> Building renderer bundle ^(webpack -- production mode^)...

pushd "%ROOT%"
call npx webpack --config webpack.config.js --mode production
if errorlevel 1 (
    echo ERROR: webpack build failed.
    popd
    exit /b 1
)
popd
echo      dist\bundle.js written.

:: ── 5. electron-builder ──────────────────────────────────────────────────────
echo.
echo   ^>^> Packaging with electron-builder ^(NSIS + portable^)...

:: winCodeSign-2.6.0.7z contains macOS symlinks (libcrypto.dylib, libssl.dylib)
:: that 7-Zip cannot create on Windows without Developer Mode, causing the build
:: to fail. We pre-populate the cache ourselves: 7-Zip extracts all Windows
:: files (exit 2 is expected/ignored), then we create stub files for the two
:: macOS symlinks so electron-builder finds the cache directory intact.
set "EB_WINCSS=%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0"
set "SEVENZIP=%ROOT%\node_modules\7zip-bin\win\x64\7za.exe"
set "WINCSS_TMP=%TEMP%\winCodeSign-2.6.0.7z"

:: Clean up any corrupted partial extractions from previous runs.
if exist "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" (
    for /d %%d in ("%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\*") do (
        if /i not "%%~nxd"=="winCodeSign-2.6.0" rd /s /q "%%d" 2>nul
    )
)

if not exist "%EB_WINCSS%" (
    echo   Pre-populating winCodeSign cache...
    curl -sL -o "%WINCSS_TMP%" "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z"
    if errorlevel 1 (
        echo   WARNING: Could not download winCodeSign - build may fail.
    ) else (
        :: Exit code 2 from 7-Zip is expected here (macOS symlinks skipped).
        :: All Windows binaries extract successfully.
        "%SEVENZIP%" x -y "-o%EB_WINCSS%" "%WINCSS_TMP%" >nul 2>&1
        :: Create stub files in place of the two macOS symlinks 7-Zip could not create.
        if not exist "%EB_WINCSS%\darwin\10.12\lib" md "%EB_WINCSS%\darwin\10.12\lib"
        type nul > "%EB_WINCSS%\darwin\10.12\lib\libcrypto.dylib"
        type nul > "%EB_WINCSS%\darwin\10.12\lib\libssl.dylib"
        del /q "%WINCSS_TMP%" 2>nul
        echo   winCodeSign cache ready.
    )
)

set "CSC_IDENTITY_AUTO_DISCOVERY=false"

pushd "%ROOT%"
call npx electron-builder --win nsis portable
if errorlevel 1 (
    echo ERROR: electron-builder failed.
    popd
    exit /b 1
)
popd

:: ── Done ─────────────────────────────────────────────────────────────────────
set "RELEASE_DIR=%ROOT%\release"
echo.
echo ======================================================
echo    Build complete!
echo ======================================================
echo.
echo   Output folder: %RELEASE_DIR%
echo.

if exist "%RELEASE_DIR%" (
    for %%f in ("%RELEASE_DIR%\*.exe") do echo     %%~nxf
)

echo.
endlocal
exit /b 0
