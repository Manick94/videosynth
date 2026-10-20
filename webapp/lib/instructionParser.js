// Maps each screenshot filename to the business-context paragraph that precedes
// its mention in the instructions doc (same section can cover multiple images).
function parseInstructions(text, filenames) {
  const lines = (text || "").split(/\r?\n/);
  const lowerFilenames = filenames.map((f) => f.toLowerCase());
  let buffer = [];
  const context = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = lowerFilenames.indexOf(line.toLowerCase());
    if (idx !== -1) {
      const ctx = buffer.join(" ").replace(/\s+/g, " ").trim();
      context[filenames[idx]] = ctx || "Screen from the uploaded workflow.";
      continue;
    }
    buffer.push(line);
  }

  const fallback =
    buffer.join(" ").replace(/\s+/g, " ").trim() ||
    "Application screen from the uploaded workflow.";
  for (const f of filenames) {
    if (!context[f]) context[f] = fallback;
  }
  return context;
}

module.exports = { parseInstructions };
