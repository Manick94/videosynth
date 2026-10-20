const PptxGenJS = require("pptxgenjs");

const SLIDE_W = 10;
const SLIDE_H = 5.625;

const LAYOUTS = [
  { id: "full-bleed", label: "Full Bleed + Caption Bar" },
  { id: "split-right", label: "Image Left, Narration Panel Right" },
  { id: "split-left", label: "Narration Panel Left, Image Right" },
  { id: "top-bottom", label: "Image Top, Text Block Bottom" },
  { id: "focus-card", label: "Centered Card + Focus Ring" },
  { id: "minimal-title", label: "Minimal Title + Subtitle" },
];

function fitRect(boxX, boxY, boxW, boxH, imgW, imgH) {
  const boxRatio = boxW / boxH;
  const imgRatio = imgW / imgH;
  let w, h;
  if (imgRatio > boxRatio) {
    w = boxW;
    h = boxW / imgRatio;
  } else {
    h = boxH;
    w = boxH * imgRatio;
  }
  return { x: boxX + (boxW - w) / 2, y: boxY + (boxH - h) / 2, w, h };
}

function addFocusRing(slide, fitted, step) {
  const { x: fx, y: fy, radius } = step.focus_coordinate;
  const { w: imgW, h: imgH } = step.image_size;
  const scale = fitted.w / imgW;
  const cx = fitted.x + (fx / imgW) * fitted.w;
  const cy = fitted.y + (fy / imgH) * fitted.h;
  const d = Math.max(0.3, Math.min(2.2, radius * 2 * scale));
  slide.addShape("ellipse", {
    x: cx - d / 2,
    y: cy - d / 2,
    w: d,
    h: d,
    fill: { type: "none" },
    line: { color: "FF4D4D", width: 3 },
  });
}

function stepBadge(slide, step, x, y, color = "1f2937") {
  slide.addShape("roundRect", {
    x, y, w: 0.9, h: 0.4,
    rectRadius: 0.06,
    fill: { color },
    line: { type: "none" },
  });
  slide.addText(`STEP ${step.step}`, {
    x, y, w: 0.9, h: 0.4,
    fontSize: 12, bold: true, color: "FFFFFF", align: "center", valign: "middle",
  });
}

function buildSlide(pptx, step, layout) {
  const slide = pptx.addSlide();
  const { w: imgW, h: imgH } = step.image_size;

  if (layout === "split-right" || layout === "split-left") {
    const panelW = 3.6;
    const imgBoxX = layout === "split-right" ? 0 : panelW + 0.1;
    const panelX = layout === "split-right" ? SLIDE_W - panelW : 0;

    slide.addShape("rect", { x: panelX, y: 0, w: panelW, h: SLIDE_H, fill: { color: "111827" }, line: { type: "none" } });
    const fitted = fitRect(imgBoxX + 0.2, 0.3, SLIDE_W - panelW - 0.4, SLIDE_H - 0.6, imgW, imgH);
    slide.addImage({ path: step.image_path, x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h });
    addFocusRing(slide, fitted, step);
    stepBadge(slide, step, panelX + 0.3, 0.3);
    slide.addText(step.narration, {
      x: panelX + 0.3, y: 1.0, w: panelW - 0.6, h: SLIDE_H - 1.3,
      fontSize: 16, color: "F9FAFB", valign: "top", wrap: true,
    });
  } else if (layout === "top-bottom") {
    const fitted = fitRect(0.4, 0.25, SLIDE_W - 0.8, 3.5, imgW, imgH);
    slide.addImage({ path: step.image_path, x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h });
    addFocusRing(slide, fitted, step);
    slide.addShape("rect", { x: 0, y: 3.95, w: SLIDE_W, h: SLIDE_H - 3.95, fill: { color: "F3F4F6" }, line: { type: "none" } });
    stepBadge(slide, step, 0.3, 4.1, "2563EB");
    slide.addText(step.narration, {
      x: 1.5, y: 4.0, w: SLIDE_W - 1.8, h: SLIDE_H - 4.1,
      fontSize: 15, color: "111827", valign: "middle", wrap: true,
    });
  } else if (layout === "focus-card") {
    slide.addShape("rect", { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: "1F2937" }, line: { type: "none" } });
    slide.addShape("roundRect", { x: 0.6, y: 0.4, w: SLIDE_W - 1.2, h: SLIDE_H - 1.5, rectRadius: 0.08, fill: { color: "FFFFFF" }, line: { color: "E5E7EB", width: 1 } });
    const fitted = fitRect(0.8, 0.6, SLIDE_W - 1.6, SLIDE_H - 2.1, imgW, imgH);
    slide.addImage({ path: step.image_path, x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h });
    addFocusRing(slide, fitted, step);
    stepBadge(slide, step, 0.75, 0.5, "FF4D4D");
    slide.addShape("rect", { x: 0.6, y: SLIDE_H - 1.05, w: SLIDE_W - 1.2, h: 0.65, fill: { color: "111827" }, line: { type: "none" } });
    slide.addText(step.narration, {
      x: 0.8, y: SLIDE_H - 1.05, w: SLIDE_W - 1.6, h: 0.65,
      fontSize: 13, color: "FFFFFF", valign: "middle", wrap: true,
    });
  } else if (layout === "minimal-title") {
    slide.addText(`Step ${step.step}`, { x: 0.5, y: 0.15, w: SLIDE_W - 1, h: 0.6, fontSize: 26, bold: true, color: "111827" });
    const fitted = fitRect(1.0, 0.95, SLIDE_W - 2.0, 3.6, imgW, imgH);
    slide.addImage({ path: step.image_path, x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h });
    addFocusRing(slide, fitted, step);
    slide.addText(step.narration, {
      x: 0.5, y: 4.85, w: SLIDE_W - 1, h: 0.65,
      fontSize: 14, italic: true, color: "4B5563", align: "center", valign: "top", wrap: true,
    });
  } else {
    // full-bleed (default)
    const fitted = fitRect(0, 0, SLIDE_W, SLIDE_H, imgW, imgH);
    slide.addImage({ path: step.image_path, x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h });
    addFocusRing(slide, fitted, step);
    slide.addShape("rect", { x: 0, y: SLIDE_H - 1.1, w: SLIDE_W, h: 1.1, fill: { color: "000000", transparency: 40 }, line: { type: "none" } });
    stepBadge(slide, step, 0.3, SLIDE_H - 1.0);
    slide.addText(step.narration, {
      x: 1.4, y: SLIDE_H - 1.05, w: SLIDE_W - 1.7, h: 1.0,
      fontSize: 15, color: "FFFFFF", valign: "middle", wrap: true,
    });
  }
}

const tick = () => new Promise((r) => setImmediate(r));

async function generateStoryboard(steps, layout, outPath, onProgress) {
  const total = steps.length + 1; // slides + final write
  const report = (current, message) => onProgress && onProgress(current, total, message);

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "VSYNTH_16x9", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "VSYNTH_16x9";

  const title = pptx.addSlide();
  title.addShape("rect", { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: "111827" }, line: { type: "none" } });
  title.addText("UI Explainer Storyboard", { x: 0.6, y: 2.1, w: SLIDE_W - 1.2, h: 0.9, fontSize: 32, bold: true, color: "FFFFFF" });
  title.addText(`${steps.length} steps · layout: ${layout}`, { x: 0.6, y: 2.9, w: SLIDE_W - 1.2, h: 0.5, fontSize: 16, color: "9CA3AF" });

  let i = 0;
  for (const step of steps) {
    buildSlide(pptx, step, layout);
    i++;
    report(i, `slide ${i}/${steps.length}`);
    await tick();
  }

  report(total, "writing pptx file");
  await pptx.writeFile({ fileName: outPath });
  report(total, "done");
  return outPath;
}

module.exports = { generateStoryboard, LAYOUTS };
