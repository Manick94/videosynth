const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const W = 1280;
const H = 720;
const FPS = 25;
const ZMAX = 1.15;
const UPSCALE = 2; // pre-scale source before zoompan so pixel-rounding doesn't show as jitter
const FONT = "C:/Windows/Fonts/segoeuib.ttf";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { shell: false });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

function wrapText(text, width = 55) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

// Escape a Windows path for embedding inside an ffmpeg filtergraph string
function escPath(p) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

// zoompan's "z='zoom+step'" form is recursive — it re-adds a rounded float to the
// previous frame's zoom every frame, and that rounding error accumulates into visible
// wobble/jitter over a clip. Driving zoom off the absolute frame counter `on` instead
// is closed-form (no accumulation) and is the standard fix for zoompan jitter.
// Pre-scaling the source 2x before zoompan additionally avoids visible pixel-snapping
// in the pan/zoom position at low zoom deltas.
function zoompanFilter(fx, fy, duration) {
  const d = Math.max(1, Math.round(duration * FPS));
  const sx = fx * UPSCALE;
  const sy = fy * UPSCALE;
  const z = `min(1+(${ZMAX}-1)*on/${Math.max(d - 1, 1)},${ZMAX})`;
  const x = `max(0,min(iw-iw/zoom,${sx}-(iw/zoom/2)))`;
  const y = `max(0,min(ih-ih/zoom,${sy}-(ih/zoom/2)))`;
  return `scale=iw*${UPSCALE}:ih*${UPSCALE},zoompan=z='${z}':x='${x}':y='${y}':d=${d}:s=${W}x${H}:fps=${FPS}`;
}

async function buildSegment(step, idx, framesDir) {
  const subPath = path.join(framesDir, `sub_${idx}.txt`);
  fs.writeFileSync(subPath, wrapText(step.narration), "utf-8");

  const zp = zoompanFilter(step.focus_coordinate.x, step.focus_coordinate.y, step.duration);
  const dt =
    `drawtext=fontfile='${escPath(FONT)}':textfile='${escPath(subPath)}':` +
    `fontsize=32:fontcolor=white:line_spacing=6:box=1:boxcolor=black@0.55:boxborderw=20:` +
    `x=(w-text_w)/2:y=h-text_h-50`;

  const outPath = path.join(framesDir, `seg_${idx}.mp4`);
  const args = [
    "-y",
    "-loop", "1", "-i", step.image_path,
    "-i", step.audio_path,
    "-filter_complex", `[0:v]${zp},${dt}[outv]`,
    "-map", "[outv]", "-map", "1:a",
    "-c:v", "libx264", "-preset", "fast", "-c:a", "aac",
    "-pix_fmt", "yuv420p", "-t", String(step.duration),
    outPath,
  ];
  await run("ffmpeg", args);
  return outPath;
}

async function compileVideo(steps, framesDir, finalOutPath, onProgress) {
  fs.mkdirSync(framesDir, { recursive: true });
  const total = steps.length + 1; // one segment render per step + final concat
  const report = (current, message) => onProgress && onProgress(current, total, message);

  const segPaths = [];
  for (let i = 0; i < steps.length; i++) {
    report(i, `rendering scene ${i + 1}/${steps.length} (Ken Burns + captions)`);
    segPaths.push(await buildSegment(steps[i], i + 1, framesDir));
  }

  const listPath = path.join(framesDir, "concat_list.txt");
  fs.writeFileSync(
    listPath,
    segPaths.map((p) => `file '${path.resolve(p).replace(/\\/g, "/")}'`).join("\n"),
    "utf-8"
  );

  report(steps.length, "concatenating final video");
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", finalOutPath]);
  report(total, "done");
  return finalOutPath;
}

module.exports = { compileVideo };
