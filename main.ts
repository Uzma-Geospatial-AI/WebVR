import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { TilesRenderer } from '3d-tiles-renderer';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN as string;

// Cesium Ion Asset ID for Cesium World Terrain
// Change this to your own asset ID if needed
const CESIUM_ION_ASSET_ID = 1; // Cesium World Terrain

const TILESET_URL = `https://assets.cesium.com/${CESIUM_ION_ASSET_ID}/tileset.json`;

// ─── SCENE SETUP ─────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);

// VR Button — appends "ENTER VR" button to body
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000010);

// ─── CAMERA ──────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  1e8
);
camera.position.set(0, 0, 6_378_137 + 500_000); // ~500km above Earth centre

// XR Camera rig so thumbstick movement works in VR
const cameraRig = new THREE.Group();
cameraRig.add(camera);
scene.add(cameraRig);

// ─── LIGHTING ────────────────────────────────────────────────────────────────
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(1, 1, 1).normalize();
scene.add(sun);
scene.add(new THREE.AmbientLight(0x404060, 0.8));

// ─── 3D TILES ────────────────────────────────────────────────────────────────
const tiles = new TilesRenderer(TILESET_URL);

// Cesium Ion auth header
tiles.fetchOptions = {
  headers: {
    Authorization: `Bearer ${CESIUM_ION_TOKEN}`,
  },
};

tiles.setCamera(camera);
tiles.setResolutionFromRenderer(camera, renderer);

const tilesGroup = new THREE.Group();
tilesGroup.add(tiles.group);
scene.add(tilesGroup);

// ─── CONTROLLERS (thumbstick flight) ─────────────────────────────────────────
const controllers: THREE.XRTargetRaySpace[] = [];

for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  cameraRig.add(ctrl);
  controllers.push(ctrl);
}

// Flight speed — m/s (scale up as you move higher)
let speed = 10_000; // 10 km/s default

const _move = new THREE.Vector3();

function handleControllers(delta: number): void {
  const session = renderer.xr.getSession();
  if (!session) return;

  for (const source of session.inputSources) {
    const gp = source.gamepad;
    if (!gp) continue;

    const axes = gp.axes; // [touchpadX, touchpadY, thumbstickX, thumbstickY]

    // LEFT stick → orbit (pan) around the globe
    if (source.handedness === 'left') {
      const panX = axes[2] ?? 0; // thumbstick X
      const panY = axes[3] ?? 0; // thumbstick Y

      if (Math.abs(panX) > 0.1 || Math.abs(panY) > 0.1) {
        cameraRig.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -panX * delta * 0.5);
        cameraRig.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), panY * delta * 0.5);
      }
    }

    // RIGHT stick → zoom (Y) + rotate view (X)
    if (source.handedness === 'right') {
      const zoomY = axes[3] ?? 0; // thumbstick Y  (push forward = fly in)
      const rotX  = axes[2] ?? 0; // thumbstick X  (rotate heading)

      if (Math.abs(zoomY) > 0.1) {
        // Fly along camera forward vector
        camera.getWorldDirection(_move);
        _move.multiplyScalar(-zoomY * speed * delta);
        cameraRig.position.add(_move);

        // Adapt speed to altitude (faster when further out)
        const altitude = cameraRig.position.length();
        speed = Math.max(100, altitude * 0.05);
      }

      if (Math.abs(rotX) > 0.1) {
        camera.rotation.y += -rotX * delta * 0.3;
      }
    }
  }
}

// ─── RESIZEE ──────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── RENDER LOOP ─────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();

  handleControllers(delta);

  // Update tiles based on current camera position
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.update();

  renderer.render(scene, camera);
});