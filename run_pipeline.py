"""Orchestrator: VLM scripting -> TTS -> FFmpeg compile. Serialized, VRAM-safe for 8GB GPU."""
import gc
import subprocess
import sys

try:
    import torch
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False


def clear_vram():
    gc.collect()
    if HAS_TORCH and torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()


def run(script):
    print(f"\n=== running {script} ===")
    subprocess.run([sys.executable, script], check=True)


if __name__ == "__main__":
    run("scripts/vlm_script_gen.py")   # Phase 1: VLM via Ollama (unloads after process exit)
    clear_vram()
    run("scripts/tts_synth.py")        # Phase 2: Windows SAPI TTS, zero VRAM
    clear_vram()
    run("scripts/compile_video.py")    # Phase 3: FFmpeg compile, zero VRAM
    print("\n=== DONE: output/final_explainer.mp4 ===")
