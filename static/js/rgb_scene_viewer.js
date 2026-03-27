import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls as OrbitControlsCtor } from "../vendor/three/controls/OrbitControls.js";
import { GLTFLoader as GLTFLoaderCtor } from "../vendor/three/loaders/GLTFLoader.js";
import { PLYLoader as PLYLoaderCtor } from "../vendor/three/loaders/PLYLoader.js";
import { onSceneChange } from "./scene_manifest.js";

const rgbCanvasEl = document.getElementById("rgbSceneCanvas");
const rgbStatusEl = document.getElementById("rgbSceneStatus");

if (rgbCanvasEl && rgbStatusEl) {
  initRgbSceneViewer().catch((error) => {
    console.error("[rgb_scene_viewer] initialization failed:", error);
    setStatus("RGB scene viewer failed. Check DevTools console.", true);
  });
}

function setStatus(message, isError = false) {
  rgbStatusEl.textContent = message;
  rgbStatusEl.classList.toggle("is-error", !!isError);
}

async function initRgbSceneViewer() {
  const state = {
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    animationFrameId: null,
    currentRoot: null,
    loadToken: 0,
    activeScene: null,
    resizeObserver: null,
    resizeRafId: null,
  };

  setStatus("Initializing RGB scene viewer...");
  setupThree(state);
  startAnimation(state);
  installResizeHandling(state);

  onSceneChange(
    function (detail) {
      loadScene(state, detail).catch((error) => {
        console.error("[rgb_scene_viewer] scene load failed:", error);
        setStatus("RGB scene load failed. Check DevTools console.", true);
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

  disposeCurrentRoot(state);
  const rgbExt = (scene.glb || "").toLowerCase().endsWith(".ply") ? "PLY" : "GLB";
  setStatus(`Loading scene ${detail.index + 1}/${detail.total}: RGB ${rgbExt}...`);

  await loadRgbScene(state, scene, detail, token);
  if (token !== state.loadToken) {
    return;
  }

  setStatus(`Scene ${detail.index + 1}/${detail.total} ready. Drag to orbit, scroll to zoom.`);
}

function setupThree(state) {
  const width = Math.max(rgbCanvasEl.clientWidth, 320);
  const height = Math.max(rgbCanvasEl.clientHeight, 360);

  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0xf8fafc);

  state.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000);
  state.camera.position.set(0, 200, 360);

  state.renderer = new THREE.WebGLRenderer({ antialias: true });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  state.renderer.setSize(width, height);
  state.renderer.outputColorSpace = THREE.SRGBColorSpace;
  rgbCanvasEl.appendChild(state.renderer.domElement);

  state.controls = new OrbitControlsCtor(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.dampingFactor = 0.08;

  const hemi = new THREE.HemisphereLight(0xffffff, 0xd1d5db, 0.9);
  state.scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(140, 280, 180);
  state.scene.add(dir);
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
    state.resizeObserver.observe(rgbCanvasEl);
  }

  scheduleResize();
}

function onResize(state) {
  if (!state.renderer || !state.camera) {
    return;
  }

  const width = Math.max(rgbCanvasEl.clientWidth, 320);
  const height = Math.max(rgbCanvasEl.clientHeight, 360);
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(width, height);
}

function startAnimation(state) {
  function tick() {
    state.animationFrameId = requestAnimationFrame(tick);
    state.controls.update();
    state.renderer.render(state.scene, state.camera);
  }
  tick();
}

function fitCameraToObject(state, object3D) {
  const box = new THREE.Box3().setFromObject(object3D);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = (state.camera.fov * Math.PI) / 180;
  const cameraDistance = maxDim / (2 * Math.tan(fov / 2));

  state.camera.position.set(center.x, center.y + cameraDistance * 0.35, center.z + cameraDistance * 1.1);
  state.camera.near = Math.max(0.1, cameraDistance / 100);
  state.camera.far = cameraDistance * 25;
  state.camera.updateProjectionMatrix();

  state.controls.target.copy(center);
  state.controls.update();
}

function disposeMaterial(material) {
  if (!material) {
    return;
  }

  const materials = Array.isArray(material) ? material : [material];
  for (const mat of materials) {
    if (!mat || typeof mat !== "object") {
      continue;
    }

    for (const value of Object.values(mat)) {
      if (value && value.isTexture && typeof value.dispose === "function") {
        value.dispose();
      }
    }

    if (typeof mat.dispose === "function") {
      mat.dispose();
    }
  }
}

function disposeObject3D(root) {
  if (!root) {
    return;
  }

  root.traverse(function (obj) {
    if (obj.geometry && typeof obj.geometry.dispose === "function") {
      obj.geometry.dispose();
    }
    if (obj.material) {
      disposeMaterial(obj.material);
    }
  });
}

function disposeCurrentRoot(state) {
  if (!state.currentRoot) {
    return;
  }

  state.scene.remove(state.currentRoot);
  disposeObject3D(state.currentRoot);
  state.currentRoot = null;
}

async function loadGlbScene(state, scene, detail, token) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoaderCtor();

    loader.load(
      scene.glb,
      function (gltf) {
        if (token !== state.loadToken) {
          if (gltf.scene) {
            disposeObject3D(gltf.scene);
          }
          resolve();
          return;
        }

        const sceneRoot = gltf.scene || (Array.isArray(gltf.scenes) ? gltf.scenes[0] : null);
        if (!sceneRoot) {
          reject(new Error("GLB loaded, but scene root is missing."));
          return;
        }

        state.currentRoot = sceneRoot;
        state.scene.add(sceneRoot);
        fitCameraToObject(state, sceneRoot);
        resolve();
      },
      function (progress) {
        if (token !== state.loadToken) {
          return;
        }
        if (progress && progress.lengthComputable) {
          const ratio = (progress.loaded / progress.total) * 100;
          setStatus(`Loading scene ${detail.index + 1}/${detail.total}: RGB ${ratio.toFixed(0)}%`);
        }
      },
      function (error) {
        reject(error);
      }
    );
  });
}

async function loadPlyScene(state, scene, detail, token) {
  return new Promise((resolve, reject) => {
    const loader = new PLYLoaderCtor();

    loader.load(
      scene.glb,
      function (geometry) {
        if (token !== state.loadToken) {
          geometry.dispose();
          resolve();
          return;
        }

        if (!geometry.getAttribute("position")) {
          reject(new Error("PLY loaded, but position attribute is missing."));
          return;
        }

        const hasColor = !!geometry.getAttribute("color");
        let sceneRoot = null;

        if (geometry.index || geometry.getAttribute("normal")) {
          if (!geometry.getAttribute("normal")) {
            geometry.computeVertexNormals();
          }
          const material = new THREE.MeshStandardMaterial({
            color: hasColor ? 0xffffff : 0xb8c3d1,
            vertexColors: hasColor,
            roughness: 1.0,
            metalness: 0.0,
            side: THREE.DoubleSide,
          });
          sceneRoot = new THREE.Mesh(geometry, material);
        } else {
          const material = new THREE.PointsMaterial({
            color: hasColor ? 0xffffff : 0x94a3b8,
            vertexColors: hasColor,
            size: 0.03,
            sizeAttenuation: true,
          });
          sceneRoot = new THREE.Points(geometry, material);
        }

        state.currentRoot = sceneRoot;
        state.scene.add(sceneRoot);
        fitCameraToObject(state, sceneRoot);
        resolve();
      },
      function (progress) {
        if (token !== state.loadToken) {
          return;
        }
        if (progress && progress.lengthComputable) {
          const ratio = (progress.loaded / progress.total) * 100;
          setStatus(`Loading scene ${detail.index + 1}/${detail.total}: RGB ${ratio.toFixed(0)}%`);
        }
      },
      function (error) {
        reject(error);
      }
    );
  });
}

async function loadRgbScene(state, scene, detail, token) {
  if (!scene || !scene.glb) {
    throw new Error("Scene has no RGB source path.");
  }

  const lower = scene.glb.toLowerCase();
  if (lower.endsWith(".ply")) {
    return loadPlyScene(state, scene, detail, token);
  }
  return loadGlbScene(state, scene, detail, token);
}
