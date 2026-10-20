const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");

const { parseInstructions } = require("./lib/instructionParser");
const { naturalCompare } = require("./lib/naturalSort");
const { analyzeImage, generateContext } = require("./lib/vlm");
const { VOICES, synth, ffprobeDuration } = require("./lib/tts");
const { generateStoryboard, LAYOUTS } = require("./lib/storyboard");
const { compileVideo } = require("./lib/videoCompile");

const JOBS_DIR = path.join(__dirname, "jobs");
fs.mkdirSync(JOBS_DIR, { recursive: true });

const jobs = new Map(); // id -> { dir, steps, status, layout, voice, error, name, createdAt, imageNames }
const progress = new Map(); // id -> { stage, current, total, message, percent }

function setProgress(id, stage, current, total, message) {
  const percent = total ? Math.round((current / total) * 100) : 0;
  progress.set(id, { stage, current, total, message, percent });
}

function metaOf(job) {
  return {
    name: job.name,
    createdAt: job.createdAt,
    imageNames: job.imageNames,
    status: job.status,
    layout: job.layout || null,
    voice: job.voice || null,
    customPrompt: job.customPrompt || "",
  };
}

function saveMeta(id) {
  const job = jobs.get(id);
  if (!job) return;
  fs.writeFileSync(path.join(job.dir, "meta.json"), JSON.stringify(metaOf(job), null, 2));
}

function loadExistingJobs() {
  for (const id of fs.readdirSync(JOBS_DIR)) {
    const dir = path.join(JOBS_DIR, id);
    const metaPath = path.join(dir, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    const job = { dir, ...meta };
    const scriptPath = path.join(dir, "script.json");
    if (fs.existsSync(scriptPath)) job.steps = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
    const instrPath = path.join(dir, "instructions.md");
    job.instructionsText = fs.existsSync(instrPath) ? fs.readFileSync(instrPath, "utf-8") : "";
    jobs.set(id, job);
  }
  console.log(`loaded ${jobs.size} existing project(s)`);
}

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  if (!req.body) req.body = {}; // express.json() leaves this undefined for bodyless/non-JSON requests
  next();
});
app.use(express.static(path.join(__dirname, "public")));
app.use("/jobs-static", express.static(JOBS_DIR));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.post("/api/jobs", upload.fields([{ name: "images" }, { name: "instructions" }]), (req, res) => {
  const id = crypto.randomBytes(6).toString("hex");
  const dir = path.join(JOBS_DIR, id);
  const imgDir = path.join(dir, "images");
  fs.mkdirSync(imgDir, { recursive: true });

  const images = (req.files.images || []).filter((f) => /\.png$/i.test(f.originalname));
  if (!images.length) return res.status(400).json({ error: "upload at least one .png screenshot" });

  let order = null;
  try {
    const parsed = JSON.parse(req.body.imageOrder || "null");
    if (Array.isArray(parsed) && parsed.length === images.length) {
      const names = new Set(images.map((f) => f.originalname));
      if (parsed.every((n) => names.has(n))) order = parsed;
    }
  } catch (_) {}

  if (order) {
    images.sort((a, b) => order.indexOf(a.originalname) - order.indexOf(b.originalname));
  } else {
    images.sort((a, b) => naturalCompare(a.originalname, b.originalname));
  }
  for (const f of images) fs.writeFileSync(path.join(imgDir, f.originalname), f.buffer);

  let instructionsText = req.body.instructionsText || "";
  if (req.files.instructions && req.files.instructions[0]) {
    instructionsText = req.files.instructions[0].buffer.toString("utf-8");
  }
  fs.writeFileSync(path.join(dir, "instructions.md"), instructionsText, "utf-8");

  const name = (req.body.name || "").trim() || `Project ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const customPrompt = (req.body.customPrompt || "").trim();

  jobs.set(id, {
    dir,
    imageNames: images.map((f) => f.originalname),
    instructionsText,
    status: "uploaded",
    name,
    customPrompt,
    createdAt: new Date().toISOString(),
  });
  saveMeta(id);
  res.json({ id, images: images.map((f) => f.originalname) });
});

app.get("/api/jobs", (req, res) => {
  const list = Array.from(jobs.entries())
    .map(([id, job]) => ({
      id,
      name: job.name,
      createdAt: job.createdAt,
      status: job.status,
      stepCount: job.imageNames ? job.imageNames.length : 0,
      thumbnail: job.imageNames && job.imageNames[0] ? `/jobs-static/${id}/images/${job.imageNames[0]}` : null,
      layout: job.layout || null,
      voice: job.voice || null,
    }))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  res.json({ projects: list });
});

// No instructions.md? Let the VLM write the per-image context paragraphs itself,
// from a one-line workflow description, in the exact "paragraph + filename" shape
// parseInstructions() already expects — so the rest of the pipeline is untouched.
app.post("/api/jobs/:id/generate-instructions", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  const workflowPrompt = (req.body.prompt || "").trim();
  if (!workflowPrompt) return res.status(400).json({ error: "describe the workflow first" });

  const id = req.params.id;
  const n = job.imageNames.length;
  setProgress(id, "context-gen", 0, n, "starting context generation");
  try {
    const paragraphs = [];
    for (let i = 0; i < n; i++) {
      const name = job.imageNames[i];
      setProgress(id, "context-gen", i, n, `reading screen ${i + 1}/${n} (${name})`);
      const imagePath = path.join(job.dir, "images", name);
      let paragraph;
      try {
        paragraph = await generateContext(imagePath, workflowPrompt);
      } catch (e) {
        paragraph = workflowPrompt; // fall back to the raw prompt as shared context
      }
      paragraphs.push(`${paragraph}\n\n${name}\n\n`);
    }
    const instructionsText = paragraphs.join("");
    job.instructionsText = instructionsText;
    fs.writeFileSync(path.join(job.dir, "instructions.md"), instructionsText, "utf-8");
    saveMeta(id);
    setProgress(id, "done", n, n, "done");
    res.json({ instructionsText });
  } catch (e) {
    setProgress(id, "error", 0, 1, e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/jobs/:id/analyze", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });

  if (typeof req.body.customPrompt === "string") job.customPrompt = req.body.customPrompt.trim();

  job.status = "analyzing";
  const contextMap = parseInstructions(job.instructionsText, job.imageNames);
  const steps = [];
  const id = req.params.id;
  setProgress(id, "analyzing", 0, job.imageNames.length, "starting VLM analysis");
  try {
    for (let i = 0; i < job.imageNames.length; i++) {
      const name = job.imageNames[i];
      const imagePath = path.join(job.dir, "images", name);
      const context = contextMap[name];
      setProgress(id, "analyzing", i, job.imageNames.length, `reading screen ${i + 1}/${job.imageNames.length} (${name})`);
      let result;
      try {
        result = await analyzeImage(imagePath, context, job.customPrompt);
      } catch (e) {
        console.error(`[analyze] step ${i + 1} VLM failed: ${e.message}`);
        result = {
          narration: context.split(".")[0].trim() + ".",
          focus_coordinate: { x: 100, y: 100, radius: 90 },
          image_size: { w: 1280, h: 720 },
        };
      }
      steps.push({
        step: i + 1,
        image_path: imagePath.replace(/\\/g, "/"),
        image_name: name,
        narration: result.narration,
        focus_coordinate: result.focus_coordinate,
        image_size: result.image_size,
      });
    }
    job.steps = steps;
    job.status = "analyzed";
    fs.writeFileSync(path.join(job.dir, "script.json"), JSON.stringify(steps, null, 2));
    saveMeta(id);
    setProgress(id, "done", job.imageNames.length, job.imageNames.length, "done");
    res.json({ steps });
  } catch (e) {
    job.status = "error";
    job.error = e.message;
    saveMeta(id);
    setProgress(id, "error", 0, 1, e.message);
    res.status(500).json({ error: e.message });
  }
});

// Manual script override: edit narration text and/or focus coordinate per step before storyboard/render
app.patch("/api/jobs/:id/script", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.steps) return res.status(400).json({ error: "no script to edit yet" });
  const edits = req.body.steps || [];
  for (const edit of edits) {
    const target = job.steps.find((s) => s.step === edit.step);
    if (!target) continue;
    if (typeof edit.narration === "string") target.narration = edit.narration;
    if (edit.focus_coordinate) {
      target.focus_coordinate = {
        x: Math.round(edit.focus_coordinate.x),
        y: Math.round(edit.focus_coordinate.y),
        radius: Math.round(edit.focus_coordinate.radius || target.focus_coordinate.radius || 90),
      };
    }
    target.verified = true;
  }
  fs.writeFileSync(path.join(job.dir, "script.json"), JSON.stringify(job.steps, null, 2));
  res.json({ steps: job.steps });
});

app.post("/api/jobs/:id/storyboard", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.steps) return res.status(400).json({ error: "run analyze first" });
  const layout = req.body.layout || "full-bleed";
  job.layout = layout;
  const outPath = path.join(job.dir, "storyboard.pptx");
  const id = req.params.id;
  setProgress(id, "storyboard", 0, job.steps.length + 1, "starting");
  try {
    await generateStoryboard(job.steps, layout, outPath, (cur, total, msg) =>
      setProgress(id, "storyboard", cur, total, msg)
    );
    saveMeta(id);
    res.json({ url: `/api/jobs/${id}/storyboard.pptx`, layout });
  } catch (e) {
    setProgress(id, "error", 0, 1, e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/jobs/:id/storyboard.pptx", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  res.download(path.join(job.dir, "storyboard.pptx"), "storyboard.pptx");
});

app.get("/api/voices", (req, res) => res.json({ voices: VOICES, layouts: LAYOUTS }));

app.get("/api/jobs/:id/progress", (req, res) => {
  res.json(progress.get(req.params.id) || { stage: "idle", current: 0, total: 0, percent: 0 });
});

app.post("/api/jobs/:id/preview-voice", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  const voice = req.body.voice || VOICES[0].id;
  const text = req.body.text || (job.steps && job.steps[0] && job.steps[0].narration) || "This is a quick voice preview.";
  const previewDir = path.join(job.dir, "preview");
  fs.mkdirSync(previewDir, { recursive: true });
  const outPath = path.join(previewDir, `${voice}.mp3`);
  try {
    await synth(text, voice, outPath);
    res.sendFile(outPath);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/jobs/:id/render", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.steps) return res.status(400).json({ error: "run analyze first" });
  const voice = req.body.voice || VOICES[0].id;
  const id = req.params.id;
  job.status = "rendering";

  const n = job.steps.length;
  const totalUnits = n + (n + 1); // TTS pass + compileVideo pass
  setProgress(id, "tts", 0, totalUnits, "starting voice synthesis");

  try {
    const audioDir = path.join(job.dir, "audio");
    fs.mkdirSync(audioDir, { recursive: true });
    let unit = 0;
    for (const step of job.steps) {
      setProgress(id, "tts", unit, totalUnits, `synthesizing voice for step ${step.step}/${n}`);
      const audioPath = path.join(audioDir, `step_${String(step.step).padStart(2, "0")}.mp3`);
      await synth(step.narration, voice, audioPath);
      step.audio_path = audioPath.replace(/\\/g, "/");
      step.duration = await ffprobeDuration(audioPath);
      unit++;
    }
    fs.writeFileSync(path.join(job.dir, "script.json"), JSON.stringify(job.steps, null, 2));

    const framesDir = path.join(job.dir, "frames");
    const finalOut = path.join(job.dir, "final_explainer.mp4");
    await compileVideo(job.steps, framesDir, finalOut, (cur, total, msg) =>
      setProgress(id, "render", unit + cur, totalUnits, msg)
    );

    setProgress(id, "done", totalUnits, totalUnits, "done");
    job.status = "done";
    job.voice = voice;
    saveMeta(id);
    res.json({ status: "done", video: `/api/jobs/${id}/video`, steps: job.steps });
  } catch (e) {
    setProgress(id, "error", 0, 1, e.message);
    job.status = "error";
    job.error = e.message;
    saveMeta(id);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/jobs/:id/video", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  res.sendFile(path.join(job.dir, "final_explainer.mp4"));
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  const videoExists = fs.existsSync(path.join(job.dir, "final_explainer.mp4"));
  res.json({
    id: req.params.id,
    name: job.name,
    status: job.status,
    steps: job.steps,
    imageNames: job.imageNames,
    layout: job.layout,
    voice: job.voice,
    customPrompt: job.customPrompt || "",
    error: job.error,
    video: videoExists ? `/api/jobs/${req.params.id}/video` : null,
  });
});

loadExistingJobs();

const PORT = process.env.PORT || 4500;
app.listen(PORT, () => console.log(`videosynth webapp running on http://localhost:${PORT}`));
