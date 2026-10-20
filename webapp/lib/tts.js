const { spawn } = require("child_process");

// Curated Indian neural voices (Microsoft Edge TTS, free, no VRAM, far better than SAPI)
const VOICES = [
  { id: "en-IN-NeerjaNeural", label: "Neerja (Female, Indian English)", gender: "female" },
  { id: "en-IN-PrabhatNeural", label: "Prabhat (Male, Indian English)", gender: "male" },
  { id: "en-IN-NeerjaExpressiveNeural", label: "Neerja Expressive (Female, Indian English)", gender: "female" },
  { id: "hi-IN-SwaraNeural", label: "Swara (Female, Hindi)", gender: "female" },
  { id: "hi-IN-MadhurNeural", label: "Madhur (Male, Hindi)", gender: "male" },
];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { shell: false });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}

async function synth(text, voiceId, outPath) {
  await run("edge-tts", ["--voice", voiceId, "--text", text, "--write-media", outPath]);
}

function ffprobeDuration(path) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("close", () => resolve(parseFloat(out.trim())));
  });
}

module.exports = { VOICES, synth, ffprobeDuration };
