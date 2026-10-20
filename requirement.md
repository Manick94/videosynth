# System Requirements & Orchestration Plan: Automated UI Explainer Pipeline

This document defines the architecture, script logic, and dependencies required for **Claude** to generate an automated, local "screenshot-to-video" explainer pipeline tailored for a **Predator Laptop** (VRAM-constrained environment).

---

## 1. Environment & Target Hardware Profile
*   **Host System:** Acer Predator Laptop
*   **GPU:** NVIDIA GeForce RTX 2070 Max-Q (8GB GDDR6 VRAM)
*   **System RAM:** 32GB DDR4
*   **Storage:** Fast NVMe SSD storage assumed for temporary frame rendering
*   **Execution Strategy:** Multi-stage serialized pipeline. Models are loaded, executed, and purged sequentially from VRAM to prevent Out-Of-Memory (OOM) errors on the 8GB GPU.

---

## 2. Architecture & Pipeline Topology

The automated video creation agent must execute three sequential phases:

```
[ Input: Directory of Screenshots (.png) ]
                    │
                    ▼
┌────────────────────────────────────────────────────────┐
│ PHASE 1: UI Analysis & Scripting (VLM)                  │
│ Model: Qwen2.5-VL-7B-Instruct (INT4 Quantized)         │
│ Output: `script.json` (Timed audio text + visual cues) │
└────────────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────────────┐
│ PHASE 2: Local Audio Synthesis (TTS)                    │
│ Model: Kokoro-82M (ONNX/Pipeline version)              │
│ Output: `audio_segments/*.wav` + accurate durations    │
└────────────────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────────────┐
│ PHASE 3: Programmatic Video Compilation                │
│ Engine: Node.js (Remotion/Hyperframes) OR Python-FFmpeg │
│ Output: `final_explainer.mp4` with Zooms & Captions    │
└────────────────────────────────────────────────────────┘
```

---

## 3. Component Specifications & Requirements

### Phase 1: Scripting & Visual Analysis (VLM)
*   **Model Selection:** `Qwen2.5-VL-7B-Instruct` running under **vLLM** or **Ollama** using 4-bit quantization (requires ~5-6 GB VRAM active).
*   **Input Data:** A sorted sequence of screenshots (`01_dashboard.png`, `02_settings.png`, etc.).
*   **Task Prompt:** Analyze the layout of each screen, detect key UI interaction points, and generate a natural voiceover sentence describing the user action.
*   **Output Format:** Structured `script.json` containing:
    ```json
    [
      {
        "step": 1,
        "image_path": "inputs/01_dashboard.png",
        "narration": "Welcome to the dashboard. To view your analytics, navigate to the sidebar menu.",
        "focus_coordinate": { "x": 120, "y": 450, "radius": 80 }
      }
    ]
    ```

### Phase 2: Local Audio Synthesis (TTS)
*   **Model Selection:** `Kokoro-82M`. Highly optimized, studio-quality speech engine requiring less than 500MB VRAM/System RAM.
*   **Processing Logic:** Parse `script.json`, iterate through the steps, and synthesize an audio clip for each narration block.
*   **Durations Mapping:** Capture the exact duration (in seconds) of each generated audio file using `librosa` or `wave` to feed the video timing engine.
*   **Output Update:** Enriched `script.json` containing `audio_path` and `duration`.

### Phase 3: Video Assembly Engine
*   **Framework Options:**
    *   *Option A (Preferred for UI precision):* **Remotion** CLI driven by Node.js. Generates smooth programmatic pan-and-zooms around the `focus_coordinate` using CSS/React transitions, overlaying the audio segment exactly matching the duration.
    *   *Option B (Pure Python approach):* **FFmpeg + MoviePy**. Apples a calculated Ken Burns effect (virtual camera zoom) centered at the coordinate coordinates, then concatenates all visual blocks with their corresponding WAV tracks.
*   **Post-Processing:** Hardcode dynamic subtitles at the bottom center of the video viewport matching the narration text block.

---

## 4. Complete System Dependencies (`requirements.txt` / `package.json`)

### Python Dependencies (`requirements.txt`)
```text
# VLM Inference & Acceleration
ollama>=0.4.0
torch==2.5.1+cu124 --extra-index-url https://download.pytorch.org/whl/cu124
transformers>=4.48.0

# Text To Speech (Kokoro Engine)
kokoro>=0.3.1
soundfile>=0.12.1

# Utilities & Structural Frameworks
pydantic>=2.10.0
numpy>=1.26.0
moviepy>=1.0.3
```

### Node.js Dependencies (`package.json` for Option A Compiler)
```json
{
  "name": "predator-video-compiler",
  "version": "1.0.0",
  "dependencies": {
    "@remotion/cli": "^4.0.0",
    "@remotion/transitions": "^4.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "remotion": "^4.0.0"
  }
}
```

---

## 5. Optimized VRAM Management Routine

To run this pipeline reliably on an **8GB VRAM RTX 2070 Max-Q**, Claude must wrap the orchestration script using the following sequence pattern:

```python
import gc
import torch

def clear_vram():
    """Explicitly purges active tensors to prevent Phase transitions from crashing the GPU."""
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()

# --- Execution Workflow Loop ---
# 1. Initialize VLM -> Process Screenshots -> Save script.json
# 2. Delete VLM Instance variable
# 3. Call clear_vram()
# 4. Initialize TTS Engine -> Synthesize WAV files -> Save details
# 5. Delete TTS Engine Instance variable
# 6. Call clear_vram()
# 7. Execute FFmpeg / Remotion CLI compiler binary (Zero VRAM dependency)
```

---

## 6. Execution Validation Checklist
*   [ ] Verify CUDA Toolkit 12.4+ is installed and mapped in system environment variables.
*   [ ] Place test screenshots inside `./inputs/` directory in standard alphanumeric order.
*   [ ] Run `ollama pull qwen2.5-vl:7b` ahead of running the multi-stage pipeline.
*   [ ] Ensure `ffmpeg` binary is added to system path variables for Phase 3 construction.