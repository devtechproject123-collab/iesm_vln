import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls as OrbitControlsCtor } from "../vendor/three/controls/OrbitControls.js";
import { PLYLoader as PLYLoaderCtor } from "../vendor/three/loaders/PLYLoader.js";
import { onSceneChange } from "./scene_manifest.js";

const MAX_NEAREST_COLOR_DIST2 = 12;

const viewerEl = document.getElementById("mapViewerCanvas");
const statusEl = document.getElementById("mapViewerStatus");
const captionEl = document.getElementById("mapViewerCaption");
const resetBtnEl = document.getElementById("mapViewerReset");

if (viewerEl && statusEl && captionEl) {
  initMapViewer().catch((error) => {
    console.error("[map_viewer] initialization failed:", error);
    setStatus("Viewer init failed. Check DevTools console.", true);
  });
}

async function initMapViewer() {
  const state = {
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    raycaster: null,
    points: null,
    originalColors: null,
    colorVertices: new Map(),
    colorToInstance: new Map(),
    lookupEntries: [],
    captions: {},
    instanceIdVertices: new Map(),
    hasInstanceIdAttr: false,
    selectedColorKey: null,
    animationFrameId: null,
    colorDecodeMode: "direct",
    loadToken: 0,
    activeScene: null,
    resizeObserver: null,
    resizeRafId: null,
  };

  renderCaptionPlaceholder();
  setStatus("Initializing viewer...");

  setupThree(state);

  if (resetBtnEl) {
    resetBtnEl.addEventListener("click", function () {
      clearSelection(state);
    });
  }

  onSceneChange(
    function (detail) {
      loadScene(state, detail).catch((error) => {
        console.error("[map_viewer] scene load failed:", error);
        setStatus("Scene load failed. Check DevTools console.", true);
      });
    },
    { emitInitial: false }
  );
}

async function loadScene(state, detail) {
  const scene = detail.scene;
  if (!scene) {
    return;
  }

  const token = state.loadToken + 1;
  state.loadToken = token;
  state.activeScene = scene;

  disposeCurrentPoints(state);
  renderCaptionPlaceholder();
  setStatus(`Loading scene ${detail.index + 1}/${detail.total}: metadata...`);

  await loadMetadata(state, scene, token);
  if (token !== state.loadToken) {
    return;
  }

  await loadPly(state, scene, detail, token);
  if (token !== state.loadToken) {
    return;
  }

  const modeLabel = state.hasInstanceIdAttr
    ? "instance-id mapping"
    : (state.colorDecodeMode === "srgb" ? "sRGB-corrected mapping" : "direct mapping");
  const transposeLabel = scene.mapTransposeXY ? ", transposed XY" : "";
  setStatus(`Scene ${detail.index + 1}/${detail.total} ready (${modeLabel}${transposeLabel}). Click an instance mask.`);
}

function disposeCurrentPoints(state) {
  if (!state.points) {
    return;
  }

  state.scene.remove(state.points);

  if (state.points.geometry) {
    state.points.geometry.dispose();
  }
  if (state.points.material) {
    state.points.material.dispose();
  }

  state.points = null;
  state.originalColors = null;
  state.colorVertices.clear();
  state.colorToInstance.clear();
  state.lookupEntries = [];
  state.captions = {};
  state.instanceIdVertices.clear();
  state.hasInstanceIdAttr = false;
  state.selectedColorKey = null;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", !!isError);
}

function escapeHtml(value) {
  return String(value)
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;")
    .split("'").join("&#39;");
}

function parseCaptionPayload(rawCaption) {
  if (typeof rawCaption !== "string") {
    return {};
  }

  const text = rawCaption.trim();
  if (!text) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (_error) {
    // fallback below
  }

  return { captions: text };
}

function renderCaptionPlaceholder() {
  captionEl.innerHTML = [
    '<h3 class="title is-5">Instance Information (Proposed Map)</h3>',
    '<p class="instance-caption-placeholder">Select an instance mask in the map to view information.</p>',
  ].join("");
}

function firstDefined() {
  for (let i = 0; i < arguments.length; i += 1) {
    const v = arguments[i];
    if (v !== undefined && v !== null && v !== "") {
      return v;
    }
  }
  return undefined;
}

function renderCaption(state, colorKey, instanceId) {
  const entry = state.captions[String(instanceId)] || null;
  if (!entry) {
    captionEl.innerHTML =
      '<h3 class="title is-5">Instance Information (Proposed Map)</h3>' +
      `<p class="instance-caption-placeholder">No information found for instance <strong>${escapeHtml(instanceId)}</strong>.</p>`;
    return;
  }

  const parsed = parseCaptionPayload(entry.caption);
  const category = firstDefined(parsed.category, entry.category, "unknown");
  const roomCat = firstDefined(parsed.room_cat, entry.room_cat, "-");
  const roomId = firstDefined(parsed.room_id, entry.room_id, "-");
  const color = firstDefined(parsed.color, "-");
  const material = firstDefined(parsed.material, "-");
  const captionText = firstDefined(parsed.captions, parsed.caption, entry.caption, "-");
  const top5 = Array.isArray(entry.top5_categories) ? entry.top5_categories.join(", ") : "-";

  captionEl.innerHTML = `
    <h3 class="title is-5">Instance Information (Proposed Map)</h3>
    <div class="instance-meta-grid instance-meta-grid-two-line">
      <span class="meta-label">Category</span>
      <span class="meta-label">Room</span>
      <span class="meta-label">Color</span>
      <span class="meta-label">Material</span>
      <span class="meta-value">${escapeHtml(category)}</span>
      <span class="meta-value">${escapeHtml(roomCat)} (id: ${escapeHtml(roomId)})</span>
      <span class="meta-value">${escapeHtml(color)}</span>
      <span class="meta-value">${escapeHtml(material)}</span>
    </div>
    <div class="instance-caption-text is-caption-main">
      <span class="meta-label">Caption</span>
      <p>${escapeHtml(captionText)}</p>
    </div>
    <div class="instance-caption-text is-top5">
      <span class="meta-label">Top-5 Categories</span>
      <p>${escapeHtml(top5)}</p>
    </div>
  `;
}

function clearSelection(state) {
  if (!state.points || !state.originalColors) {
    return;
  }

  const colorAttr = state.points.geometry.getAttribute("color");
  colorAttr.array.set(state.originalColors);
  colorAttr.needsUpdate = true;

  state.selectedColorKey = null;
  renderCaptionPlaceholder();
  setStatus("Selection cleared. Click an instance mask to inspect information.");
}

function clamp01(v) {
  if (v < 0) {
    return 0;
  }
  if (v > 1) {
    return 1;
  }
  return v;
}

function linearToSrgbUnit(v) {
  const x = clamp01(v);
  if (x <= 0.0031308) {
    return 12.92 * x;
  }
  return 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function channelToByte(v) {
  return Math.round(clamp01(v) * 255);
}

function colorKeyFromArray(colorArray, vertexIndex, decodeMode = "direct") {
  const i = vertexIndex * 3;
  let r = colorArray[i];
  let g = colorArray[i + 1];
  let b = colorArray[i + 2];

  if (decodeMode === "srgb") {
    r = linearToSrgbUnit(r);
    g = linearToSrgbUnit(g);
    b = linearToSrgbUnit(b);
  }

  const r8 = channelToByte(r);
  const g8 = channelToByte(g);
  const b8 = channelToByte(b);
  return `${r8},${g8},${b8}`;
}

function chooseColorDecodeMode(state) {
  if (!state.originalColors || !state.originalColors.length || !state.colorToInstance.size) {
    return "direct";
  }

  const vertexCount = state.originalColors.length / 3;
  const sampleCount = Math.min(vertexCount, 4096);
  const step = Math.max(1, Math.floor(vertexCount / sampleCount));
  let directHits = 0;
  let srgbHits = 0;

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += step) {
    const directKey = colorKeyFromArray(state.originalColors, vertexIndex, "direct");
    if (state.colorToInstance.has(directKey)) {
      directHits += 1;
    }

    const srgbKey = colorKeyFromArray(state.originalColors, vertexIndex, "srgb");
    if (state.colorToInstance.has(srgbKey)) {
      srgbHits += 1;
    }
  }

  const mode = srgbHits > directHits ? "srgb" : "direct";
  console.info(
    `[map_viewer] color decode mode=${mode} (direct hits=${directHits}, srgb hits=${srgbHits}, sample=${sampleCount})`
  );
  return mode;
}

function colorKeyFromVertex(state, vertexIndex) {
  return colorKeyFromArray(state.originalColors, vertexIndex, state.colorDecodeMode);
}

function nearestLookupKey(state, key) {
  const parts = key.split(",");
  if (parts.length !== 3) {
    return null;
  }

  const r0 = Number.parseInt(parts[0], 10);
  const g0 = Number.parseInt(parts[1], 10);
  const b0 = Number.parseInt(parts[2], 10);
  if (Number.isNaN(r0) || Number.isNaN(g0) || Number.isNaN(b0)) {
    return null;
  }

  let bestKey = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const item of state.lookupEntries) {
    const dr = item.r - r0;
    const dg = item.g - g0;
    const db = item.b - b0;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestKey = item.key;
      if (dist === 0) {
        break;
      }
    }
  }

  if (bestDist <= MAX_NEAREST_COLOR_DIST2) {
    return bestKey;
  }
  return null;
}

async function loadMetadata(state, scene, token) {
  const [lookupRes, captionRes] = await Promise.all([
    fetch(scene.lookup),
    fetch(scene.captions),
  ]);

  if (token !== state.loadToken) {
    return;
  }

  if (!lookupRes.ok) {
    throw new Error(`Lookup fetch failed: ${lookupRes.status}`);
  }
  if (!captionRes.ok) {
    throw new Error(`Caption fetch failed: ${captionRes.status}`);
  }

  const lookupJson = await lookupRes.json();
  const captionsJson = await captionRes.json();

  state.colorToInstance.clear();
  state.lookupEntries = [];

  const colorToInstance = lookupJson.color_to_instance_id || {};
  for (const [key, value] of Object.entries(colorToInstance)) {
    const instanceId = Number.parseInt(String(value), 10);
    if (Number.isNaN(instanceId)) {
      continue;
    }

    state.colorToInstance.set(key, instanceId);

    const rgb = key.split(",").map((x) => Number.parseInt(x, 10));
    if (rgb.length === 3 && !Number.isNaN(rgb[0]) && !Number.isNaN(rgb[1]) && !Number.isNaN(rgb[2])) {
      state.lookupEntries.push({ key, r: rgb[0], g: rgb[1], b: rgb[2] });
    }
  }

  state.captions = captionsJson;
}

function setupThree(state) {
  const width = Math.max(viewerEl.clientWidth, 320);
  const height = Math.max(viewerEl.clientHeight, 360);

  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0xf8fafc);

  state.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000);
  state.camera.position.set(0, 250, 450);

  state.renderer = new THREE.WebGLRenderer({ antialias: true });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  state.renderer.setSize(width, height);
  viewerEl.appendChild(state.renderer.domElement);

  state.controls = new OrbitControlsCtor(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.dampingFactor = 0.08;

  const ambient = new THREE.AmbientLight(0xffffff, 0.9);
  state.scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(200, 300, 120);
  state.scene.add(dir);

  const grid = new THREE.GridHelper(2200, 44, 0xcbd5e1, 0xe2e8f0);
  grid.material.opacity = 0.25;
  grid.material.transparent = true;
  state.scene.add(grid);

  state.raycaster = new THREE.Raycaster();
  state.raycaster.params.Points.threshold = 2.0;

  state.renderer.domElement.addEventListener("pointerdown", function (event) {
    onPointerDown(event, state);
  });

  installResizeHandling(state);

  animate(state);
}

function installResizeHandling(state) {
  const scheduleResize = function () {
    if (state.resizeRafId != null) {
      return;
    }
    state.resizeRafId = requestAnimationFrame(function () {
      state.resizeRafId = null;
      onResize(state);
    });
  };

  window.addEventListener("resize", scheduleResize);
  if (typeof ResizeObserver !== "undefined") {
    state.resizeObserver = new ResizeObserver(function () {
      scheduleResize();
    });
    state.resizeObserver.observe(viewerEl);
  }

  scheduleResize();
}

function onResize(state) {
  if (!state.renderer || !state.camera) {
    return;
  }

  const width = Math.max(viewerEl.clientWidth, 320);
  const height = Math.max(viewerEl.clientHeight, 360);
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(width, height);
}

function animate(state) {
  state.animationFrameId = requestAnimationFrame(function () {
    animate(state);
  });

  state.controls.update();
  state.renderer.render(state.scene, state.camera);
}

function fitCameraToObject(state, object3D) {
  const box = new THREE.Box3().setFromObject(object3D);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = (state.camera.fov * Math.PI) / 180;
  const baseDistance = maxDim / (2 * Math.tan(fov / 2));

  // Use a diagonal view instead of front-z view so map extents use horizontal space better.
  // Slightly tighten framing compared to the previous distance.
  const cameraDistance = baseDistance * 0.88;
  state.camera.position.set(
    center.x + cameraDistance * 0.9,
    center.y + cameraDistance * 0.72,
    center.z + cameraDistance * 0.9
  );
  state.camera.near = Math.max(0.1, cameraDistance / 100);
  state.camera.far = cameraDistance * 24;
  state.camera.updateProjectionMatrix();

  state.controls.target.copy(center);
  state.controls.update();
}

function buildColorVertexIndex(state) {
  state.colorVertices.clear();

  const vertexCount = state.originalColors.length / 3;
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const key = colorKeyFromVertex(state, vertexIndex);
    if (!state.colorVertices.has(key)) {
      state.colorVertices.set(key, []);
    }
    state.colorVertices.get(key).push(vertexIndex);
  }
}

function buildInstanceIdIndex(state, geometry) {
  state.instanceIdVertices.clear();

  const attr = geometry.getAttribute("instance_id");
  if (!attr || !attr.array) {
    return false;
  }

  const itemSize = Math.max(1, attr.itemSize || 1);
  const arr = attr.array;
  for (let vertexIndex = 0; vertexIndex < attr.count; vertexIndex += 1) {
    const raw = arr[vertexIndex * itemSize];
    const id = Math.round(raw);
    if (!Number.isFinite(id) || id < 0) {
      continue;
    }
    if (!state.instanceIdVertices.has(id)) {
      state.instanceIdVertices.set(id, []);
    }
    state.instanceIdVertices.get(id).push(vertexIndex);
  }

  return state.instanceIdVertices.size > 0;
}

function downsampleGeometryByStride(geometry, stride) {
  if (stride <= 1) {
    return geometry;
  }

  const pos = geometry.getAttribute("position");
  const col = geometry.getAttribute("color");
  if (!pos || !col) {
    return geometry;
  }

  const n = pos.count;
  const keep = Math.ceil(n / stride);
  const posOut = new Float32Array(keep * 3);
  const colOut = new Float32Array(keep * 3);

  let outIdx = 0;
  for (let i = 0; i < n; i += stride) {
    const pi = i * 3;
    const po = outIdx * 3;
    posOut[po] = pos.array[pi];
    posOut[po + 1] = pos.array[pi + 1];
    posOut[po + 2] = pos.array[pi + 2];
    colOut[po] = col.array[pi];
    colOut[po + 1] = col.array[pi + 1];
    colOut[po + 2] = col.array[pi + 2];
    outIdx += 1;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(posOut, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colOut, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function applySceneMapTransform(geometry, scene) {
  if (!scene || !scene.mapTransposeXY) {
    return;
  }

  const pos = geometry.getAttribute("position");
  if (!pos || !pos.array) {
    return;
  }

  const arr = pos.array;
  for (let i = 0; i < arr.length; i += 3) {
    const x = arr[i];
    arr[i] = arr[i + 1];
    arr[i + 1] = x;
  }
  pos.needsUpdate = true;
}

async function loadPly(state, scene, detail, token) {
  return new Promise((resolve, reject) => {
    const loader = new PLYLoaderCtor();
    loader.setCustomPropertyNameMapping({
      instance_id: ["instance_id"],
    });

    loader.load(
      scene.ply,
      function (geometry) {
        if (token !== state.loadToken) {
          geometry.dispose();
          resolve();
          return;
        }

        if (!geometry.getAttribute("color")) {
          reject(new Error("PLY has no vertex color attribute."));
          return;
        }

        applySceneMapTransform(geometry, scene);
        geometry.rotateX(-Math.PI / 2);
        geometry.center();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        const pointCount = geometry.getAttribute("position").count;
        let workingGeometry = geometry;
        if (pointCount > 220000) {
          workingGeometry = downsampleGeometryByStride(geometry, 2);
          geometry.dispose();
        }

        const colorAttr = workingGeometry.getAttribute("color");
        state.originalColors = new Float32Array(colorAttr.array);
        state.colorDecodeMode = chooseColorDecodeMode(state);
        buildColorVertexIndex(state);
        state.hasInstanceIdAttr = buildInstanceIdIndex(state, workingGeometry);

        const material = new THREE.PointsMaterial({
          size: 1.3,
          sizeAttenuation: true,
          vertexColors: true,
        });

        state.points = new THREE.Points(workingGeometry, material);
        state.scene.add(state.points);
        fitCameraToObject(state, state.points);

        resolve();
      },
      function (progress) {
        if (token !== state.loadToken) {
          return;
        }
        if (progress && progress.lengthComputable) {
          const ratio = (progress.loaded / progress.total) * 100;
          setStatus(`Loading scene ${detail.index + 1}/${detail.total}: map ${ratio.toFixed(0)}%`);
        }
      },
      function (error) {
        reject(error);
      }
    );
  });
}

function applySelection(state, colorKey) {
  if (!state.points || !state.originalColors) {
    return;
  }

  const colorAttr = state.points.geometry.getAttribute("color");
  colorAttr.array.set(state.originalColors);

  const vertices = state.colorVertices.get(colorKey) || [];
  for (const vertexIndex of vertices) {
    const i = vertexIndex * 3;
    colorAttr.array[i] = 1.0;
    colorAttr.array[i + 1] = 0.16;
    colorAttr.array[i + 2] = 0.16;
  }

  colorAttr.needsUpdate = true;
  state.selectedColorKey = colorKey;

  const instanceId = state.colorToInstance.get(colorKey);
  if (instanceId == null) {
    setStatus(`Selected color ${colorKey}, but no instance mapping exists.`, true);
    return;
  }

  renderCaption(state, colorKey, instanceId);
  setStatus(`Selected instance ${instanceId} (${state.activeScene ? state.activeScene.id : "-"}).`);
}

function instanceIdFromVertex(state, vertexIndex) {
  if (!state.points) {
    return null;
  }

  const attr = state.points.geometry.getAttribute("instance_id");
  if (!attr || !attr.array) {
    return null;
  }

  const itemSize = Math.max(1, attr.itemSize || 1);
  const raw = attr.array[vertexIndex * itemSize];
  const id = Math.round(raw);
  if (!Number.isFinite(id) || id < 0) {
    return null;
  }
  return id;
}

function applySelectionByInstanceId(state, instanceId, colorKey = "-") {
  if (!state.points || !state.originalColors) {
    return;
  }

  const vertices = state.instanceIdVertices.get(instanceId) || [];
  if (!vertices.length) {
    setStatus(`Instance-id attribute exists, but no vertex list for id ${instanceId}.`, true);
    return;
  }

  const colorAttr = state.points.geometry.getAttribute("color");
  colorAttr.array.set(state.originalColors);

  for (const vertexIndex of vertices) {
    const i = vertexIndex * 3;
    colorAttr.array[i] = 1.0;
    colorAttr.array[i + 1] = 0.16;
    colorAttr.array[i + 2] = 0.16;
  }

  colorAttr.needsUpdate = true;
  renderCaption(state, colorKey, instanceId);
  setStatus(`Selected instance ${instanceId} (id-attribute mapping).`);
}

function onPointerDown(event, state) {
  if (!state.points || !state.renderer || !state.camera) {
    return;
  }

  const rect = state.renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  state.raycaster.setFromCamera(pointer, state.camera);
  const intersections = state.raycaster.intersectObject(state.points, false);
  if (!intersections.length) {
    return;
  }

  const vertexIndex = intersections[0].index;
  if (vertexIndex == null) {
    return;
  }

  if (state.hasInstanceIdAttr) {
    const instanceId = instanceIdFromVertex(state, vertexIndex);
    if (instanceId != null && state.instanceIdVertices.has(instanceId)) {
      const pickedColorKey = colorKeyFromVertex(state, vertexIndex);
      applySelectionByInstanceId(state, instanceId, pickedColorKey);
      return;
    }
  }

  let colorKey = colorKeyFromVertex(state, vertexIndex);
  if (!state.colorToInstance.has(colorKey)) {
    const nearestKey = nearestLookupKey(state, colorKey);
    if (nearestKey) {
      colorKey = nearestKey;
    }
  }

  if (!state.colorToInstance.has(colorKey)) {
    setStatus(`No mapped instance for picked color ${colorKey}.`, true);
    return;
  }

  applySelection(state, colorKey);
}
