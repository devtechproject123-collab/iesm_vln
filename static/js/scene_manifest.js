export const SCENES = [
  {
    id: "00824",
    title: "00824-Dd4bFSTQ8gi",
    dataset: "hm3dsem",
    sceneLabel: "00824-Dd4bFSTQ8gi",
    glb: "static/models/scene_00824.glb",
    ply: "static/models/scene_00824_ours_map_with_id.ply",
    captions: "static/data/scene_00824_caption.json",
    lookup: "static/data/scene_00824_lookup.json",
  },
  {
    id: "00829",
    title: "00829-QaLdnwvtxbs",
    dataset: "hm3dsem",
    sceneLabel: "00829-QaLdnwvtxbs",
    glb: "static/models/QaLdnwvtxbs.glb",
    ply: "static/models/scene_00829_ours_map_with_id.ply",
    captions: "static/data/scene_00829_caption.json",
    lookup: "static/data/scene_00829_lookup.json",
  },
  {
    id: "office2",
    title: "Replica-office2",
    dataset: "replica",
    sceneLabel: "office2",
    glb: "static/models/scene_office2.glb",
    ply: "static/models/scene_office2_ours_map_with_id.ply",
    captions: "static/data/scene_office2_caption.json",
    lookup: "static/data/scene_office2_lookup.json",
  },
  {
    id: "office3",
    title: "Replica-office3",
    dataset: "replica",
    sceneLabel: "office3",
    glb: "static/models/scene_office3.glb",
    ply: "static/models/scene_office3_ours_map_with_id.ply",
    captions: "static/data/scene_office3_caption.json",
    lookup: "static/data/scene_office3_lookup.json",
  },
];

const SCENE_CHANGE_EVENT = "iesm-scene-change";
let currentSceneIndex = 0;

function normalizeSceneIndex(index) {
  const total = SCENES.length;
  if (total === 0) {
    return 0;
  }
  return ((index % total) + total) % total;
}

export function getSceneCount() {
  return SCENES.length;
}

export function getCurrentSceneIndex() {
  return currentSceneIndex;
}

export function getCurrentScene() {
  return SCENES[currentSceneIndex] || null;
}

export function setSceneIndex(nextIndex, source = "manual") {
  if (!SCENES.length) {
    return 0;
  }

  currentSceneIndex = normalizeSceneIndex(nextIndex);
  const detail = {
    index: currentSceneIndex,
    total: SCENES.length,
    scene: SCENES[currentSceneIndex],
    source,
  };

  window.dispatchEvent(new CustomEvent(SCENE_CHANGE_EVENT, { detail }));
  return currentSceneIndex;
}

export function cycleScene(delta, source = "manual") {
  return setSceneIndex(currentSceneIndex + delta, source);
}

export function onSceneChange(handler, options = {}) {
  const emitInitial = options.emitInitial !== false;

  function listener(event) {
    handler(event.detail);
  }

  window.addEventListener(SCENE_CHANGE_EVENT, listener);

  if (emitInitial && SCENES.length) {
    handler({
      index: currentSceneIndex,
      total: SCENES.length,
      scene: SCENES[currentSceneIndex],
      source: "initial",
    });
  }

  return function unsubscribe() {
    window.removeEventListener(SCENE_CHANGE_EVENT, listener);
  };
}
