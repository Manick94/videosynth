const fs = require("fs");
const { pngSize } = require("./png");

const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "qwen2.5vl:7b";

const PROMPT_TMPL = (context, w, h, userPrompt) => `You are writing a short voiceover line for an internal team demo video.
Business context for this exact screen:
"${context}"
${userPrompt ? `\nThe reviewer gave this specific guidance for how the narration should be written — follow it closely:\n"${userPrompt}"\n` : ""}
Look at the attached screenshot (size ${w}x${h} pixels). Reply with ONLY a JSON object, no markdown,
no explanation, in this exact shape:
{"narration": "<one natural spoken sentence, max 28 words, explaining this screen to the team>",
"focus_coordinate": {"x": <int pixel x of the most important UI element>, "y": <int pixel y>, "radius": 90}}
`;

async function analyzeImage(imagePath, context, userPrompt) {
  const buf = fs.readFileSync(imagePath);
  const { width, height } = pngSize(buf);
  const prompt = PROMPT_TMPL(context, width, height, userPrompt);

  const resp = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      images: [buf.toString("base64")],
      stream: false,
      format: "json",
      options: { temperature: 0.3 },
    }),
  });
  if (!resp.ok) throw new Error(`ollama HTTP ${resp.status}`);
  const data = await resp.json();
  const raw = data.response || "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`no JSON in VLM response: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]);

  let fx = Math.round(parsed.focus_coordinate.x);
  let fy = Math.round(parsed.focus_coordinate.y);
  fx = Math.max(0, Math.min(width, fx));
  fy = Math.max(0, Math.min(height, fy));
  const radius = Math.round(parsed.focus_coordinate.radius || 90);

  return {
    narration: String(parsed.narration).trim(),
    focus_coordinate: { x: fx, y: fy, radius },
    image_size: { w: width, h: height },
  };
}

const CONTEXT_PROMPT_TMPL = (workflowPrompt, w, h) => `You are documenting an internal software workflow for a team wiki.
The reviewer described the overall workflow like this: "${workflowPrompt}"

Look at this screenshot (${w}x${h}px) and write ONE short paragraph (1-3 sentences, plain text,
no markdown, no JSON, no preamble) describing what this specific screen does functionally —
what business rule or user action it represents — in the style of internal documentation.
Do not describe colors, fonts, or pixel layout.`;

// Used when no instructions.md was supplied: VLM writes the "documentation paragraph"
// itself, from the user's one-line workflow description + what it sees on screen.
async function generateContext(imagePath, workflowPrompt) {
  const buf = fs.readFileSync(imagePath);
  const { width, height } = pngSize(buf);
  const prompt = CONTEXT_PROMPT_TMPL(workflowPrompt, width, height);

  const resp = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      images: [buf.toString("base64")],
      stream: false,
      options: { temperature: 0.4 },
    }),
  });
  if (!resp.ok) throw new Error(`ollama HTTP ${resp.status}`);
  const data = await resp.json();
  return (data.response || "").trim();
}

module.exports = { analyzeImage, generateContext };
