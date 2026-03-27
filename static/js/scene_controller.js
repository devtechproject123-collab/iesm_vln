import { SCENES, cycleScene, onSceneChange, setSceneIndex } from "./scene_manifest.js";

const rgbPrevBtn = document.getElementById("rgbPrevScene");
const mapNextBtn = document.getElementById("mapNextScene");
const indicatorsEl = document.getElementById("sceneIndicators");
const mappingResultsTitleEl = document.getElementById("mappingResultsTitle");

if (SCENES.length) {
  initSceneController();
}

function initSceneController() {
  bindButtons();
  buildIndicators();

  onSceneChange(
    function (detail) {
      updateSceneLabels(detail.scene, detail.index, detail.total);
      updateIndicators(detail.index);
    },
    { emitInitial: false }
  );

  // Trigger first global scene event so all modules initialize on same index.
  setSceneIndex(0, "init");
}

function bindButtons() {
  const prevHandlers = [rgbPrevBtn];
  const nextHandlers = [mapNextBtn];

  for (const btn of prevHandlers) {
    if (!btn) {
      continue;
    }
    btn.addEventListener("click", function () {
      cycleScene(-1, "button");
    });
  }

  for (const btn of nextHandlers) {
    if (!btn) {
      continue;
    }
    btn.addEventListener("click", function () {
      cycleScene(1, "button");
    });
  }
}

function buildIndicators() {
  if (!indicatorsEl) {
    return;
  }

  indicatorsEl.innerHTML = "";

  for (let i = 0; i < SCENES.length; i += 1) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "scene-indicator-dot";
    dot.setAttribute("aria-label", `Go to scene ${i + 1}`);
    dot.dataset.sceneIndex = String(i);

    dot.addEventListener("click", function () {
      const next = Number.parseInt(dot.dataset.sceneIndex || "0", 10);
      setSceneIndex(next, "indicator");
    });

    indicatorsEl.appendChild(dot);
  }
}

function updateIndicators(activeIndex) {
  if (!indicatorsEl) {
    return;
  }

  const dots = indicatorsEl.querySelectorAll(".scene-indicator-dot");
  dots.forEach(function (dot, idx) {
    const isActive = idx === activeIndex;
    dot.classList.toggle("is-active", isActive);
    dot.setAttribute("aria-current", isActive ? "true" : "false");
  });
}

function updateSceneLabels(scene, index, total) {
  if (!scene) {
    return;
  }

  const datasetRaw = String(scene.dataset || "scene").toLowerCase();
  let datasetLabel = "Scene";
  if (datasetRaw === "replica") {
    datasetLabel = "Replica";
  } else if (datasetRaw === "hm3dsem") {
    datasetLabel = "HM3DSem";
  } else if (scene.dataset) {
    datasetLabel = String(scene.dataset);
  }

  const sceneIdLabel = scene.sceneLabel || scene.id || scene.title || "-";
  if (mappingResultsTitleEl) {
    mappingResultsTitleEl.textContent = `Mapping Results (${datasetLabel}: ${sceneIdLabel})`;
  }
}
