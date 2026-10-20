const $ = (id) => document.getElementById(id);

let jobId = null;
let steps = [];
let curStep = 0;
let voices = [];
let layouts = [];
let selectedVoice = null;
let selectedLayout = null;
let arrangedFiles = [];
let stage = "review"; // review -> storyboard -> voice -> result
let pulseAnim = null;
let durationChart = null;

// ---------------- three.js brand flourish ----------------
(function brandFx() {
  const canvas = $("brandFx");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(46, 46);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  camera.position.z = 3;
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshBasicMaterial({ color: 0x16c8d4, wireframe: true });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  function tick() {
    mesh.rotation.x += 0.012;
    mesh.rotation.y += 0.017;
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
})();

// ---------------- stage / stepper ----------------
function switchStage(name) {
  stage = name;
  document.querySelectorAll(".panel-stage").forEach((p) => (p.style.display = "none"));
  $(`panel${name[0].toUpperCase()}${name.slice(1)}`).style.display = "block";

  const order = ["review", "storyboard", "voice", "result"];
  const idx = order.indexOf(name);
  document.querySelectorAll(".step-pill").forEach((pill) => {
    const pillIdx = order.indexOf(pill.dataset.stage);
    pill.classList.remove("active", "done");
    if (pillIdx === idx) pill.classList.add("active");
    else if (pillIdx < idx) pill.classList.add("done");
  });
}
document.querySelectorAll(".step-pill").forEach((pill) => {
  pill.addEventListener("click", () => {
    if (!steps.length) return;
    switchStage(pill.dataset.stage);
  });
});

// ---------------- load voices + layouts ----------------
const LAYOUT_MOCKS = {
  "full-bleed": () => `<div class="m-img" style="inset:0"></div><div class="m-txt" style="left:0;right:0;bottom:0;height:16px"></div>`,
  "split-right": () => `<div class="m-img" style="left:0;top:4px;bottom:4px;width:55%"></div><div class="m-txt" style="right:4px;top:4px;bottom:4px;width:35%"></div>`,
  "split-left": () => `<div class="m-txt" style="left:4px;top:4px;bottom:4px;width:35%"></div><div class="m-img" style="right:0;top:4px;bottom:4px;width:55%"></div>`,
  "top-bottom": () => `<div class="m-img" style="left:4px;right:4px;top:4px;height:60%"></div><div class="m-txt" style="left:4px;right:4px;bottom:4px;height:22%"></div>`,
  "focus-card": () => `<div class="m-img" style="left:15%;right:15%;top:8%;bottom:22%"></div><div class="m-txt" style="left:15%;right:15%;bottom:6%;height:14%"></div>`,
  "minimal-title": () => `<div class="m-txt" style="left:20%;right:20%;top:6%;height:14px"></div><div class="m-img" style="left:12%;right:12%;top:26%;bottom:16%"></div>`,
};

async function loadVoicesAndLayouts() {
  const { voices: v, layouts: l } = await fetch("/api/voices").then((r) => r.json());
  voices = v;
  layouts = l;
  selectedVoice = voices[0].id;
  selectedLayout = layouts[0].id;

  $("layoutCards").innerHTML = layouts
    .map(
      (l) => `
    <div class="layout-card${l.id === selectedLayout ? " selected" : ""}" data-layout="${l.id}">
      <div class="layout-mock">${LAYOUT_MOCKS[l.id] ? LAYOUT_MOCKS[l.id]() : ""}</div>
      <div class="lc-label">${l.label}</div>
    </div>`
    )
    .join("");
  document.querySelectorAll(".layout-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".layout-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedLayout = card.dataset.layout;
    });
  });

  $("voiceCards").innerHTML = voices
    .map((v) => {
      const initial = v.label[0];
      const color = v.gender === "male" ? "#16c8d4" : "#ffce45";
      return `
      <div class="voice-card${v.id === selectedVoice ? " selected" : ""}" data-voice="${v.id}">
        <div class="voice-avatar" style="background:${color}">${initial}</div>
        <div class="voice-meta"><div class="v-name">${v.label}</div><div class="v-sub">${v.gender} · neural</div></div>
      </div>`;
    })
    .join("");
  document.querySelectorAll(".voice-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".voice-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedVoice = card.dataset.voice;
    });
  });
}
loadVoicesAndLayouts();

// ---------------- previous projects ----------------
async function loadProjects() {
  const { projects } = await fetch("/api/jobs").then((r) => r.json());
  $("projectsList").innerHTML = projects
    .map((p) => {
      const badgeClass = p.status === "done" ? "done" : p.status === "error" ? "error" : "";
      return `
      <div class="project-card${p.id === jobId ? " active" : ""}" data-id="${p.id}">
        <img src="${p.thumbnail || ""}" onerror="this.style.visibility='hidden'" />
        <div class="pc-meta">
          <div class="pc-name">${p.name}</div>
          <div class="pc-sub"><span class="badge ${badgeClass}">${p.status}</span><span>${p.stepCount} steps</span></div>
        </div>
      </div>`;
    })
    .join("") || `<div class="muted">No projects yet.</div>`;
  document.querySelectorAll(".project-card").forEach((card) => {
    card.addEventListener("click", () => {
      openProject(card.dataset.id);
      closeProjectsModal();
    });
  });
}
loadProjects();

function openProjectsModal() {
  loadProjects();
  $("projectsModal").style.display = "flex";
}
function closeProjectsModal() {
  $("projectsModal").style.display = "none";
}
$("btnOpenProjects").addEventListener("click", openProjectsModal);
$("btnCloseProjects").addEventListener("click", closeProjectsModal);
$("projectsModal").addEventListener("click", (ev) => {
  if (ev.target.id === "projectsModal") closeProjectsModal();
});

// ---------------- + New Project (clears the viewport for a fresh project) ----------------
function resetNewProject() {
  jobId = null;
  steps = [];
  curStep = 0;
  arrangedFiles = [];
  if (pulseAnim) { pulseAnim.destroy(); pulseAnim = null; }
  if (durationChart) { durationChart.destroy(); durationChart = null; }

  $("projectName").value = "";
  $("imagesInput").value = "";
  $("instructionsFile").value = "";
  $("instructionsText").value = "";
  $("workflowPrompt").value = "";
  $("customPrompt").value = "";
  $("reanalyzePrompt").value = "";
  $("uploadStatus").textContent = "";

  $("thumbGrid").innerHTML = "";
  $("thumbArrangeView").style.display = "none";
  $("stepViewer").style.display = "none";
  $("viewportEmpty").style.display = "block";

  $("downloadPptx").style.display = "none";
  $("toVoiceStage").style.display = "none";
  $("storyboardStatus").textContent = "";
  $("previewAudio").style.display = "none";
  $("renderStatus").textContent = "";
  $("reviewStatus").textContent = "";
  $("finalVideo").removeAttribute("src");

  $("activeProjectName").textContent = "No project selected";
  document.querySelectorAll(".step-pill").forEach((p) => p.classList.remove("active", "done"));
  document.querySelectorAll(".project-card").forEach((c) => c.classList.remove("active"));
  switchStage("review");
}
$("btnNewProject").addEventListener("click", resetNewProject);

async function openProject(id) {
  const data = await fetch(`/api/jobs/${id}`).then((r) => r.json());
  if (data.error) return alert(data.error);
  jobId = id;
  steps = data.steps || [];
  curStep = 0;
  $("activeProjectName").textContent = data.name;
  $("reanalyzePrompt").value = data.customPrompt || "";
  loadProjects();
  if (!steps.length) return;
  showStepViewer();
  if (data.layout) selectLayoutUI(data.layout);
  if (data.voice) selectVoiceUI(data.voice);
  if (data.video) {
    switchStage("result");
    renderResult(data.video);
  } else if (data.layout) {
    switchStage("voice");
  } else {
    switchStage("review");
  }
}

function selectLayoutUI(id) {
  selectedLayout = id;
  document.querySelectorAll(".layout-card").forEach((c) => c.classList.toggle("selected", c.dataset.layout === id));
}
function selectVoiceUI(id) {
  selectedVoice = id;
  document.querySelectorAll(".voice-card").forEach((c) => c.classList.toggle("selected", c.dataset.voice === id));
}

// ---------------- thumbnail arrange (reorder before upload) ----------------
function naturalCompareJs(a, b) {
  const re = /(\d+)|(\D+)/g;
  const ap = a.match(re) || [], bp = b.match(re) || [];
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    const x = ap[i] || "", y = bp[i] || "";
    if (x === y) continue;
    const xNum = /^\d+$/.test(x), yNum = /^\d+$/.test(y);
    if (xNum && yNum) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return 0;
}

let dragFromIndex = null;

function renderThumbGrid() {
  $("viewportEmpty").style.display = "none";
  $("thumbArrangeView").style.display = "flex";
  const grid = $("thumbGrid");
  grid.innerHTML = arrangedFiles
    .map(
      (f, i) => `
    <div class="thumb-card" draggable="true" data-index="${i}">
      <span class="thumb-index">${i + 1}</span>
      <img src="${URL.createObjectURL(f)}" />
      <div class="thumb-name">${f.name}</div>
    </div>`
    )
    .join("");

  grid.querySelectorAll(".thumb-card").forEach((card) => {
    card.addEventListener("dragstart", () => {
      dragFromIndex = Number(card.dataset.index);
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
    card.addEventListener("drop", (ev) => {
      ev.preventDefault();
      card.classList.remove("drag-over");
      const toIndex = Number(card.dataset.index);
      if (dragFromIndex === null || dragFromIndex === toIndex) return;
      const [moved] = arrangedFiles.splice(dragFromIndex, 1);
      arrangedFiles.splice(toIndex, 0, moved);
      dragFromIndex = null;
      renderThumbGrid();
    });
  });
}

$("imagesInput").addEventListener("change", () => {
  arrangedFiles = Array.from($("imagesInput").files).sort((a, b) => naturalCompareJs(a.name, b.name));
  if (arrangedFiles.length) renderThumbGrid();
});

// ---------------- upload + analyze ----------------
$("btnUpload").addEventListener("click", async () => {
  if (!arrangedFiles.length) {
    $("uploadStatus").textContent = "pick at least one .png first";
    return;
  }
  const fd = new FormData();
  for (const f of arrangedFiles) fd.append("images", f);
  fd.append("imageOrder", JSON.stringify(arrangedFiles.map((f) => f.name)));
  if ($("instructionsFile").files[0]) fd.append("instructions", $("instructionsFile").files[0]);
  fd.append("instructionsText", $("instructionsText").value);
  fd.append("name", $("projectName").value);
  fd.append("customPrompt", $("customPrompt").value);

  $("uploadStatus").textContent = "uploading...";
  $("btnUpload").disabled = true;
  try {
    const up = await fetch("/api/jobs", { method: "POST", body: fd }).then((r) => r.json());
    if (up.error) throw new Error(up.error);
    jobId = up.id;

    const noInstructions = !$("instructionsFile").files[0] && !$("instructionsText").value.trim();
    const workflowPrompt = $("workflowPrompt").value.trim();
    if (noInstructions && workflowPrompt) {
      $("uploadStatus").textContent = "no instructions doc — AI is writing the context from your description...";
      const ctxPoll = pollProgress("contextGenProgressWrap", "contextGenProgressFill", "contextGenProgressLabel");
      const ctx = await fetch(`/api/jobs/${jobId}/generate-instructions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: workflowPrompt }),
      }).then((r) => r.json());
      ctxPoll.stop(ctx.error ? "error" : "context generated");
      if (ctx.error) throw new Error(ctx.error);
      $("instructionsText").value = ctx.instructionsText;
    }

    $("uploadStatus").textContent = `uploaded ${up.images.length} images. running VLM analysis...`;
    const poll = pollProgress("uploadProgressWrap", "uploadProgressFill", "uploadProgressLabel");
    const an = await fetch(`/api/jobs/${jobId}/analyze`, { method: "POST" }).then((r) => r.json());
    poll.stop(an.error ? "error" : "analysis complete");
    if (an.error) throw new Error(an.error);
    steps = an.steps;
    curStep = 0;
    $("uploadStatus").textContent = `analyzed ${steps.length} steps. verify below →`;
    $("activeProjectName").textContent = $("projectName").value || "Untitled project";
    $("reanalyzePrompt").value = $("customPrompt").value;
    showStepViewer();
    switchStage("review");
    loadProjects();
  } catch (e) {
    $("uploadStatus").textContent = "error: " + e.message;
  } finally {
    $("btnUpload").disabled = false;
  }
});

$("btnReanalyze").addEventListener("click", async () => {
  if (!jobId) return;
  $("btnReanalyze").disabled = true;
  const poll = pollProgress("reanalyzeProgressWrap", "reanalyzeProgressFill", "reanalyzeProgressLabel");
  try {
    const r = await fetch(`/api/jobs/${jobId}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customPrompt: $("reanalyzePrompt").value }),
    }).then((r) => r.json());
    if (r.error) throw new Error(r.error);
    poll.stop("regenerated");
    steps = r.steps;
    curStep = 0;
    renderStep();
    $("reviewStatus").textContent = "narration regenerated with new prompt.";
  } catch (e) {
    poll.stop("error");
    $("reviewStatus").textContent = "error: " + e.message;
  } finally {
    $("btnReanalyze").disabled = false;
  }
});

// ---------------- step viewer (script review + manual override) ----------------
function showStepViewer() {
  $("viewportEmpty").style.display = "none";
  $("thumbArrangeView").style.display = "none";
  $("stepViewer").style.display = "flex";
  renderStep();
}

function renderStep() {
  const s = steps[curStep];
  $("stageImage").src = `/jobs-static/${jobId}/images/${s.image_name}`;
  $("narrationEdit").value = s.narration;
  $("stepIndicator").textContent = `Step ${curStep + 1} / ${steps.length}`;
  placeFocusMarker();
}

function placeFocusMarker() {
  const s = steps[curStep];
  const img = $("stageImage");
  const place = () => {
    const pctX = (s.focus_coordinate.x / s.image_size.w) * 100;
    const pctY = (s.focus_coordinate.y / s.image_size.h) * 100;
    const marker = $("focusMarker");
    marker.style.left = pctX + "%";
    marker.style.top = pctY + "%";
    if (pulseAnim) pulseAnim.destroy();
    marker.innerHTML = "";
    pulseAnim = lottie.loadAnimation({
      container: marker,
      path: "/assets/pulse.json",
      renderer: "svg",
      loop: true,
      autoplay: true,
    });
  };
  if (img.complete) place();
  else img.onload = place;
}

$("stageImage").addEventListener("click", (ev) => {
  const rect = ev.target.getBoundingClientRect();
  const pctX = (ev.clientX - rect.left) / rect.width;
  const pctY = (ev.clientY - rect.top) / rect.height;
  const s = steps[curStep];
  s.focus_coordinate.x = Math.round(pctX * s.image_size.w);
  s.focus_coordinate.y = Math.round(pctY * s.image_size.h);
  placeFocusMarker();
});

$("narrationEdit").addEventListener("input", (ev) => {
  steps[curStep].narration = ev.target.value;
});

$("prevStep").addEventListener("click", () => {
  if (curStep > 0) { curStep--; renderStep(); }
});
$("nextStep").addEventListener("click", () => {
  if (curStep < steps.length - 1) { curStep++; renderStep(); }
});

$("btnSaveScript").addEventListener("click", async () => {
  $("reviewStatus").textContent = "saving...";
  try {
    const r = await fetch(`/api/jobs/${jobId}/script`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ steps }),
    }).then((r) => r.json());
    if (r.error) throw new Error(r.error);
    $("reviewStatus").textContent = "saved.";
  } catch (e) {
    $("reviewStatus").textContent = "error: " + e.message;
  }
});

$("btnApprove").addEventListener("click", async () => {
  await fetch(`/api/jobs/${jobId}/script`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ steps }),
  });
  switchStage("storyboard");
});

// ---------------- progress polling ----------------
function pollProgress(wrapId, fillId, labelId) {
  const wrap = $(wrapId), fill = $(fillId), label = $(labelId);
  wrap.style.display = "block";
  fill.style.width = "0%";
  label.textContent = "starting...";
  const timer = setInterval(async () => {
    try {
      const p = await fetch(`/api/jobs/${jobId}/progress`).then((r) => r.json());
      fill.style.width = (p.percent || 0) + "%";
      label.textContent = `${p.message || p.stage} (${p.percent || 0}%)`;
    } catch (_) {}
  }, 500);
  return {
    stop(finalLabel) {
      clearInterval(timer);
      fill.style.width = "100%";
      if (finalLabel) label.textContent = finalLabel;
      setTimeout(() => (wrap.style.display = "none"), 1200);
    },
  };
}

// ---------------- storyboard ----------------
$("btnStoryboard").addEventListener("click", async () => {
  $("btnStoryboard").disabled = true;
  $("storyboardStatus").textContent = "generating pptx...";
  const poll = pollProgress("storyboardProgressWrap", "storyboardProgressFill", "storyboardProgressLabel");
  try {
    const r = await fetch(`/api/jobs/${jobId}/storyboard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ layout: selectedLayout }),
    }).then((r) => r.json());
    if (r.error) throw new Error(r.error);
    poll.stop("storyboard ready");
    $("downloadPptx").href = r.url;
    $("downloadPptx").style.display = "block";
    $("toVoiceStage").style.display = "block";
    $("storyboardStatus").textContent = "storyboard ready. review it, then continue.";
    loadProjects();
  } catch (e) {
    poll.stop("error");
    $("storyboardStatus").textContent = "error: " + e.message;
  } finally {
    $("btnStoryboard").disabled = false;
  }
});
$("toVoiceStage").addEventListener("click", () => switchStage("voice"));

// ---------------- voice ----------------
$("btnPreviewVoice").addEventListener("click", async () => {
  $("btnPreviewVoice").disabled = true;
  try {
    const text = steps[curStep].narration;
    const r = await fetch(`/api/jobs/${jobId}/preview-voice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voice: selectedVoice, text }),
    });
    if (!r.ok) throw new Error((await r.json()).error);
    const blob = await r.blob();
    const audio = $("previewAudio");
    audio.src = URL.createObjectURL(blob);
    audio.style.display = "block";
    audio.play();
  } catch (e) {
    alert("preview error: " + e.message);
  } finally {
    $("btnPreviewVoice").disabled = false;
  }
});

$("btnRender").addEventListener("click", async () => {
  $("btnRender").disabled = true;
  $("renderStatus").textContent = "rendering (TTS + ffmpeg Ken Burns)...";
  const poll = pollProgress("renderProgressWrap", "renderProgressFill", "renderProgressLabel");
  try {
    const r = await fetch(`/api/jobs/${jobId}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voice: selectedVoice }),
    }).then((r) => r.json());
    if (r.error) throw new Error(r.error);
    if (r.steps) steps = r.steps;
    poll.stop("render complete");
    $("renderStatus").textContent = "done.";
    switchStage("result");
    renderResult(r.video);
    loadProjects();
  } catch (e) {
    poll.stop("error");
    $("renderStatus").textContent = "error: " + e.message;
  } finally {
    $("btnRender").disabled = false;
  }
});

// ---------------- result + chart.js ----------------
function renderResult(videoUrl) {
  $("finalVideo").src = videoUrl;
  $("downloadVideo").href = videoUrl;

  const labels = steps.map((s) => `Step ${s.step}`);
  const data = steps.map((s) => s.duration || 0);
  if (durationChart) durationChart.destroy();
  durationChart = new Chart($("durationChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Narration duration (s)", data, backgroundColor: "#16c8d4" }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#9fb4bb" }, grid: { color: "rgba(255,255,255,0.08)" } },
        y: { ticks: { color: "#9fb4bb" }, grid: { color: "rgba(255,255,255,0.08)" } },
      },
    },
  });
}
