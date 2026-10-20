# VideoSynth

Turns a folder of UI screenshots + a plain-language instructions doc into a narrated,
Ken-Burns-style explainer video — with a storyboard review step in between so nothing
ships without a human sign-off. Built for a single VRAM-constrained GPU (RTX 2070 Max-Q,
8GB), so every phase loads its model, does its job, and gets out of the way of the next one.

Two things live in this repo:

- **`scripts/` + `run_pipeline.py`** — the original CLI pipeline. One command, one video.
- **`webapp/`** — the full product: a SaaS-style studio UI wrapped around the same pipeline,
  with multi-project support, manual script override, layout picker, voice picker, and
  live progress bars.

The CLI pipeline is kept because it's the fastest path for a one-off render from a
terminal or a cron job; the webapp is the one to point a non-technical teammate at.

---

## 1. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ Browser (public/)                                                     │
│  index.html + app.js — SaaS shell: sidebar (upload/projects),         │
│  viewport (step image + focus marker + narration editor),             │
│  side panel (layout cards / voice cards / progress bars / result)     │
│  three.js (brand flourish) · lottie-web (focus pulse) · chart.js      │
│  (duration bars)                                                      │
└───────────────────────────────┬────────────────────────────────────────┘
                                 │ fetch() — REST + polling
┌───────────────────────────────▼────────────────────────────────────────┐
│ Express server (webapp/server.js)                                     │
│  in-memory job map, mirrored to disk under webapp/jobs/<id>/           │
│  (meta.json + script.json = full resumable state)                     │
└───┬────────────┬─────────────────┬───────────────────┬─────────────────┘
    │            │                 │                   │
    ▼            ▼                 ▼                   ▼
lib/vlm.js   lib/storyboard.js  lib/tts.js         lib/videoCompile.js
Ollama HTTP  pptxgenjs, 6       edge-tts (free     ffmpeg: zoompan Ken
qwen2.5vl:7b layout templates,  MS neural voices,   Burns to the VLM's
narration +  focus-ring shape   Indian English +    focus_coordinate,
focus point  overlay            Hindi, male/female) drawtext captions,
per screen                                          concat to mp4
```

**Data flow per project (`webapp/jobs/<id>/`):**

```
images/*.png  +  instructions.md
      │  parseInstructions() maps each filename to its preceding
      │  paragraph in the doc (same section can cover several images)
      ▼
script.json   [{ step, narration, focus_coordinate, image_size }]
      │  ← human edits here (manual override) before anything renders
      ▼
storyboard.pptx   (review artifact — layout is swappable, regenerate anytime)
      │
      ▼
audio/*.mp3 (edge-tts)  +  duration per step (ffprobe)
      │
      ▼
frames/seg_*.mp4  (per-step Ken Burns + caption)  →  final_explainer.mp4
```

Nothing about this pipeline needs the GPU except Phase 1 (the VLM call to Ollama).
TTS and video compile are CPU/ffmpeg only, so the 8GB VRAM budget is only ever spent on
one model at a time, and the CLI pipeline's `clear_vram()` pattern documents that intent
even though the webapp's phases are already separate OS processes (Ollama server,
edge-tts CLI, ffmpeg) and don't share a VRAM context to begin with.

### Why these specific choices

| Decision | Why |
|---|---|
| Ollama + qwen2.5vl:7b (INT4) over a hosted VLM API | Zero network dependency for the vision step, fits in ~5-6GB VRAM, no per-call cost |
| edge-tts over Kokoro-82M (original spec) | Kokoro's voice set is US/UK English only. The team needed an **Indian English** narrator; edge-tts's `en-IN-NeerjaNeural` / `en-IN-PrabhatNeural` neural voices are free, zero-VRAM, and sound far less robotic than local SAPI/Kokoro defaults |
| ffmpeg `zoompan` + `drawtext` over Remotion/React | No Node/React render farm needed; the focus coordinate from the VLM drives the pan/zoom directly; `textfile=` avoids all filter-string escaping hell for arbitrary narration text |
| pptxgenjs storyboard as the review gate | A PPTX is something a non-technical reviewer (a manager) can open, comment on, and approve without touching the app — matches how the team already reviews UI specs |
| In-memory job map mirrored to `meta.json`/`script.json` on disk | Full state survives a server restart with zero DB setup; good enough for single-machine/single-team use, explicitly not good enough for multi-tenant (see roadmap) |

---

## 2. Folder structure

```
videosynth_01/
├── requirement.md              original spec this project was built from
├── README.md                   this file
├── ziva5/                      sample screenshot set + instructions.md used to build/test
├── scripts/                    CLI pipeline (Python)
│   ├── vlm_script_gen.py       Phase 1 — Ollama VLM → script.json
│   ├── tts_synth.py            Phase 2 — Windows SAPI TTS → wav + durations
│   └── compile_video.py        Phase 3 — ffmpeg Ken Burns + captions → mp4
├── run_pipeline.py              orchestrates the three CLI phases, VRAM-safe
└── webapp/                      the SaaS product
    ├── server.js                 Express app + REST API
    ├── lib/
    │   ├── vlm.js                 Ollama REST call, PNG size reader, JSON parsing
    │   ├── tts.js                 edge-tts wrapper, curated voice list, ffprobe duration
    │   ├── storyboard.js          pptxgenjs, 6 layout templates, focus-ring overlay
    │   ├── videoCompile.js        ffmpeg zoompan + drawtext + concat, with progress hook
    │   ├── instructionParser.js   filename → context-paragraph mapper
    │   ├── naturalSort.js         ziva2 before ziva10
    │   └── png.js                 zero-dependency PNG header reader
    ├── public/                   frontend (vanilla JS, no build step)
    │   ├── index.html, style.css, app.js
    │   └── assets/pulse.json      hand-authored Lottie focus-pulse animation
    └── jobs/<id>/                 per-project runtime state (gitignore-worthy)
        ├── images/, instructions.md, meta.json, script.json
        ├── storyboard.pptx, audio/, frames/, final_explainer.mp4
```

---

## 3. Running it

**CLI pipeline** (one-shot, from repo root):
```
pip install -r requirements.txt   # torch/transformers/etc per requirement.md
python run_pipeline.py
```

**Webapp:**
```
cd webapp
npm install
node server.js        # http://localhost:4500
```
Prerequisites on PATH: `ollama` (with `qwen2.5vl:7b` pulled), `ffmpeg`/`ffprobe`,
`edge-tts` (`pip install edge-tts`). All free, all local except edge-tts's call to
Microsoft's free TTS endpoint.

---

## 4. REST API (webapp)

| Route | Purpose |
|---|---|
| `POST /api/jobs` | upload screenshots + instructions, create a project |
| `GET /api/jobs` | list all projects (sidebar) |
| `GET /api/jobs/:id` | full project state (resume UI) |
| `POST /api/jobs/:id/analyze` | run the VLM over every screenshot → script.json |
| `PATCH /api/jobs/:id/script` | manual override: edit narration text / focus coordinate per step |
| `POST /api/jobs/:id/storyboard` | render the PPTX for a chosen layout |
| `GET /api/jobs/:id/storyboard.pptx` | download it |
| `GET /api/voices` | voice + layout catalog |
| `POST /api/jobs/:id/preview-voice` | synth a single line, stream back mp3 (pre-render check) |
| `POST /api/jobs/:id/render` | TTS all steps + ffmpeg compile → final_explainer.mp4 |
| `GET /api/jobs/:id/progress` | `{stage, current, total, percent}` — polled every 500ms by the progress bars during storyboard/render |
| `GET /api/jobs/:id/video` | stream/download the final mp4 |

---

## 5. Known limitations (honest, as of now)

- Single-machine, single-process job store — no auth, no multi-tenant isolation, no queue.
  Two people rendering at once on the same Ollama instance will serialize/contend for VRAM.
- The three.js/chart.js/lottie "motion elements" live in the **editor UI**, not baked into
  the exported MP4. The rendered video's only motion is the ffmpeg Ken Burns pan/zoom.
- No audio mixing (no background music, no ducking).
- VLM focus-point and narration quality depends entirely on qwen2.5vl:7b's read of the
  screenshot — manual override exists precisely because this isn't always right.
- No authentication — anyone who can reach the port can see every project.

---

## 6. Roadmap

### Near-term (small, high-value, builds on what exists)
- **Bake motion into the actual video**, not just the editor: animated focus-pulse ring
  burned into the MP4 via an ffmpeg `geq` alpha-pulse filter centered on-screen after
  `zoompan` (the focus point stays near frame-center once zoomed, so this is cheap to add
  without re-deriving coordinates per frame).
- **Background music bed with narration ducking** (ffmpeg `sidechaincompress`), selectable
  per project from a small royalty-free pack.
- **Speech-to-text QA pass**: run the generated narration audio back through a local STT
  model and diff it against `script.json` text to catch TTS mispronunciations before the
  user even watches the render.
- **Job queue** so a second upload doesn't fight the first for the Ollama GPU slot —
  even a simple in-process FIFO solves the single-GPU contention problem.
- **Undo/redo + version history** on script edits (currently last-write-wins per step).
- **NVENC hardware encode** in the ffmpeg compile step — this exact GPU supports it and
  it's a one-flag change (`-c:v h264_nvenc`) that would meaningfully cut render time.

### Mid-term (new functional surface)
- **Multi-speaker narration**: alternate "narrator" and "user" voices for a more natural
  walkthrough script, instead of one voice reading everything.
- **Voice cloning** of an actual team spokesperson as the narrator, for demos that should
  sound like a specific person rather than a generic neural voice.
- **Multi-language dub + subtitle tracks**: translate `script.json` narration and generate
  parallel audio/caption tracks (e.g. Hindi + English) selectable at render time.
- **Scene auto-detection from screen recordings**: accept an `.mp4`/`.webm` screen capture
  instead of requiring pre-cut screenshots, and auto-extract key frames on UI-state change.
- **Google Slides / Keynote export** alongside PPTX for teams not on Office.
- **Branching / chapter markers** in the final video so a long walkthrough can be seeked
  by topic instead of watched linearly.
- **Brand theming**: logo, color palette, and intro/outro template applied consistently
  across the storyboard layouts and the final video.

### Long-term (platform-level)
- **Accounts + roles**: uploader / reviewer / approver sign-off workflow before a video
  can be rendered or shared — matches how the storyboard-review gate is already used
  informally today.
- **Cloud storage backend** (S3/Azure Blob) in place of local `webapp/jobs/`, so this scales
  past one machine's disk and survives a server being recycled.
- **CLI/webhook mode**: point the pipeline at a watched folder (e.g. a shared drive where
  QA drops new screenshots) and auto-regenerate the explainer video on change, for teams
  that want this wired into CI rather than driven by hand through the UI.
- **Public share links + view analytics** for videos shared outside the team, with basic
  watch-time/drop-off charts (reusing the chart.js groundwork already in the Result stage).



claude --resume 41f03826-60ff-4737-aedf-31fd712549e9