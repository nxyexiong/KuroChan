/**
 * whisper_wrapper.cpp
 *
 * Thin DLL that wraps whisper.cpp with a simple FFI-friendly C API suitable
 * for use with koffi in Electron's main process.
 *
 * Exported function:
 *
 *   int kurochan_whisper_transcribe(
 *       const char* model_path,   // path to ggml .bin model file
 *       const float* samples,     // mono PCM float32 at 16 kHz
 *       int          n_samples,   // number of samples
 *       int          n_threads,   // CPU threads (0 = auto, uses 4)
 *       const char*  language,    // ISO 639-1 code ("en", "ja", ...) — never null
 *       char*        out_buf,     // caller-allocated output buffer
 *       int          buf_size     // size of out_buf in bytes
 *   );
 *
 *   Returns the number of bytes written to out_buf (including null
 *   terminator), or -1 on error.  out_buf is always null-terminated on
 *   success, even if the transcript was truncated to fit buf_size.
 */

#include "whisper.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>

#ifdef _WIN32
#  define KURO_EXPORT extern "C" __declspec(dllexport)
#else
#  define KURO_EXPORT extern "C" __attribute__((visibility("default")))
#endif

// ── Cached model context ──────────────────────────────────────────────────────
// Loading the model from disk is expensive (seconds). We cache the context and
// only reload when the model path changes.

static whisper_context* s_ctx        = nullptr;
static std::string      s_model_path;
static std::mutex       s_ctx_mutex;

KURO_EXPORT int kurochan_whisper_transcribe(
    const char*  model_path,
    const float* samples,
    int          n_samples,
    int          n_threads,
    const char*  language,
    char*        out_buf,
    int          buf_size)
{
    if (!model_path || !samples || n_samples <= 0 || !language || !out_buf || buf_size <= 0)
        return -1;

    std::lock_guard<std::mutex> lock(s_ctx_mutex);

    // Reload model only if path changed or context was freed
    if (!s_ctx || s_model_path != model_path) {
        if (s_ctx) { whisper_free(s_ctx); s_ctx = nullptr; }
        s_ctx = whisper_init_from_file(model_path);
        if (!s_ctx) return -1;
        s_model_path = model_path;
    }

    whisper_context* ctx = s_ctx;

    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_BEAM_SEARCH);
    params.n_threads             = n_threads > 0 ? n_threads : 4;
    params.print_realtime        = false;
    params.print_progress        = false;
    params.print_timestamps      = false;
    params.print_special         = false;
    params.translate             = false;
    params.language              = language;
    params.detect_language       = false;
    params.no_speech_thold       = 1.0f;   // 1.0 = never skip (good for button-press STT)
    params.beam_search.beam_size = 5;
    params.greedy.best_of        = 5;

    const int ret = whisper_full(ctx, params, samples, n_samples);

    if (ret != 0) return -1;

    const int n_segs = whisper_full_n_segments(ctx);

    if (n_segs == 0) {
        out_buf[0] = '\0';
        return 1;
    }

    std::string result;
    for (int i = 0; i < n_segs; ++i) {
        const char* seg = whisper_full_get_segment_text(ctx, i);
        if (seg) result += seg;
    }

    // ctx intentionally not freed — cached for subsequent calls

    // Strip leading/trailing whitespace that whisper often adds
    const auto s = result.find_first_not_of(" \t\n\r");
    const auto e = result.find_last_not_of(" \t\n\r");
    if (s == std::string::npos) {
        out_buf[0] = '\0';
        return 1;
    }
    result = result.substr(s, e - s + 1);

    // Copy into the caller's buffer, truncating if needed
    int bytes_to_copy = static_cast<int>(result.size());
    if (bytes_to_copy >= buf_size) bytes_to_copy = buf_size - 1;
    std::memcpy(out_buf, result.c_str(), bytes_to_copy);
    out_buf[bytes_to_copy] = '\0';

    return bytes_to_copy + 1; // bytes written including null terminator
}
