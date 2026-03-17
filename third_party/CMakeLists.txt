cmake_minimum_required(VERSION 3.16)
project(whisper_kuro VERSION 1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_C_STANDARD   11)

# ── whisper.cpp — build as static so everything is baked into our single DLL ──
set(BUILD_SHARED_LIBS      OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(GGML_METAL             OFF CACHE BOOL "" FORCE)
set(GGML_CUDA              OFF CACHE BOOL "" FORCE)
set(GGML_VULKAN            OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP            OFF CACHE BOOL "" FORCE)

add_subdirectory(whisper.cpp)

# ── KuroChan Whisper wrapper DLL ──────────────────────────────────────────────
# Exposes a simple FFI-friendly C API consumed by koffi in Electron's main process.
add_library(whisper_kuro SHARED whisper_wrapper.cpp)
target_link_libraries(whisper_kuro PRIVATE whisper)

# Place the DLL in build/out/ regardless of MSVC multi-config generator
foreach(cfg "" "_DEBUG" "_RELEASE" "_RELWITHDEBINFO" "_MINSIZEREL")
  set_target_properties(whisper_kuro PROPERTIES
    "RUNTIME_OUTPUT_DIRECTORY${cfg}" "${CMAKE_CURRENT_BINARY_DIR}/out"
    "LIBRARY_OUTPUT_DIRECTORY${cfg}" "${CMAKE_CURRENT_BINARY_DIR}/out"
  )
endforeach()
