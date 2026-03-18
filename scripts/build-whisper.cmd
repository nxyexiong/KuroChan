@echo off
setlocal enabledelayedexpansion

:: Resolve the workspace root (parent of this script's directory)
pushd "%~dp0.."
set "ROOT=%CD%"
popd

set "THIRD_PARTY=%ROOT%\third_party"
set "WHISPER_SRC=%THIRD_PARTY%\whisper.cpp"
set "BUILD_DIR=%THIRD_PARTY%\build"
set "RES_DIR=%ROOT%\resources\whisper"

echo.
echo === KuroChan - Whisper DLL build ===
echo.

:: ── 1. Initialise whisper.cpp submodule ─────────────────────────────────────
echo   Checking whisper.cpp submodule...

if not exist "%WHISPER_SRC%\CMakeLists.txt" (
    echo   whisper.cpp not found - adding submodule and initialising...
    pushd "%ROOT%"

    set "HAS_ENTRY=0"
    if exist "%ROOT%\.gitmodules" (
        findstr /i "whisper\.cpp" "%ROOT%\.gitmodules" >nul 2>&1
        if not errorlevel 1 set "HAS_ENTRY=1"
    )

    if "!HAS_ENTRY!"=="0" (
        git submodule add https://github.com/ggerganov/whisper.cpp.git third_party/whisper.cpp
        if errorlevel 1 (
            echo ERROR: git submodule add failed.
            popd
            exit /b 1
        )
    )

    git submodule update --init --recursive third_party/whisper.cpp
    if errorlevel 1 (
        echo ERROR: git submodule update failed.
        popd
        exit /b 1
    )
    popd
) else (
    echo   whisper.cpp submodule present.
)

:: ── 2. CMake configure ───────────────────────────────────────────────────────
echo   Configuring CMake...

if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"
pushd "%BUILD_DIR%"

cmake "%THIRD_PARTY%" -DCMAKE_BUILD_TYPE=Release
if errorlevel 1 (
    echo ERROR: CMake configure failed.
    popd
    exit /b 1
)

:: ── 3. CMake build ───────────────────────────────────────────────────────────
echo   Building whisper_kuro (this may take several minutes on first run)...

cmake --build . --config Release --target whisper_kuro
if errorlevel 1 (
    echo ERROR: CMake build failed.
    popd
    exit /b 1
)

popd

:: ── 4. Locate and copy the DLL ───────────────────────────────────────────────
echo   Locating whisper_kuro.dll...

set "DLL_PATH="
if exist "%BUILD_DIR%\out\whisper_kuro.dll"          if "!DLL_PATH!"=="" set "DLL_PATH=%BUILD_DIR%\out\whisper_kuro.dll"
if exist "%BUILD_DIR%\out\Release\whisper_kuro.dll"  if "!DLL_PATH!"=="" set "DLL_PATH=%BUILD_DIR%\out\Release\whisper_kuro.dll"
if exist "%BUILD_DIR%\Release\whisper_kuro.dll"      if "!DLL_PATH!"=="" set "DLL_PATH=%BUILD_DIR%\Release\whisper_kuro.dll"
if exist "%BUILD_DIR%\whisper_kuro.dll"              if "!DLL_PATH!"=="" set "DLL_PATH=%BUILD_DIR%\whisper_kuro.dll"

if "%DLL_PATH%"=="" (
    echo ERROR: Build succeeded but whisper_kuro.dll was not found in any expected location:
    echo   %BUILD_DIR%\out\whisper_kuro.dll
    echo   %BUILD_DIR%\out\Release\whisper_kuro.dll
    echo   %BUILD_DIR%\Release\whisper_kuro.dll
    echo   %BUILD_DIR%\whisper_kuro.dll
    exit /b 1
)

if not exist "%RES_DIR%" mkdir "%RES_DIR%"
copy /y "%DLL_PATH%" "%RES_DIR%\" >nul

echo.
echo   whisper_kuro.dll copied to resources/whisper/
echo.

endlocal
exit /b 0
