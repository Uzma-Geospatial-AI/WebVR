import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import {
  TilesRenderer,
  GlobeControls,
} from '3d-tiles-renderer';
import {
  CesiumIonAuthPlugin,
  TileCompressionPlugin,
  GLTFExtensionsPlugin,
  TilesFadePlugin,
} from '3d-tiles-renderer/plugins';

const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN;

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87ceeb);
document.body.appendChild(renderer.domElement);

// --- Scene ---
const scene = new THREE.Scene();

// --- Camera ---
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1e8);
camera.position.set(4800000, 2570000, 14720000);
camera.lookAt(0, 0, 0);

// --- Lighting ---
scene.add(new THREE.AmbientLight(0xffffff, 1.0));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(1, 2, 1).normalize();
scene.add(dirLight);

// --- 3D Tiles ---
const tiles = new TilesRenderer();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

tiles.registerPlugin(new CesiumIonAuthPlugin({
  apiToken: CESIUM_ION_TOKEN,
  assetId: '2275207',
  autoRefreshToken: true,
}));
tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader }));
tiles.registerPlugin(new TileCompressionPlugin());
tiles.registerPlugin(new TilesFadePlugin());

scene.add(tiles.group);
tiles.setCamera(camera);
tiles.setResolutionFromRenderer(camera, renderer);

// --- Globe Controls (mouse/touch for desktop + Quest browser) ---
const controls = new GlobeControls(scene, camera, renderer.domElement, tiles);

// --- Fullscreen button ---
const fsBtn = document.createElement('button');
fsBtn.textContent = 'FULLSCREEN';
fsBtn.style.cssText = `
  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
  padding: 12px 24px; font-size: 18px; font-weight: bold;
  background: #333; color: #fff; border: 1px solid #fff;
  border-radius: 4px; cursor: pointer; z-index: 999;
`;
fsBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
});
document.body.appendChild(fsBtn);

// Hide button in fullscreen
document.addEventListener('fullscreenchange', () => {
  fsBtn.style.display = document.fullscreenElement ? 'none' : 'block';
});

// --- Gamepad fly controls (Quest 2 controller sticks) ---
// Quest 2 browser exposes controllers via the Gamepad API
// Left stick: orbit/pan, Right stick: zoom in/out + rotate
function handleGamepad() {
  const gamepads = navigator.getGamepads();
  for (const gp of gamepads) {
    if (!gp) continue;

    const deadzone = 0.15;
    const axes = gp.axes;

    // Standard gamepad: axes[0]=LX, axes[1]=LY, axes[2]=RX, axes[3]=RY
    const lx = Math.abs(axes[0]) > deadzone ? axes[0] : 0;
    const ly = Math.abs(axes[1]) > deadzone ? axes[1] : 0;
    const rx = Math.abs(axes[2]) > deadzone ? axes[2] : 0;
    const ry = Math.abs(axes[3]) > deadzone ? axes[3] : 0;

    if (lx !== 0 || ly !== 0 || rx !== 0 || ry !== 0) {
      // Left stick: orbit around the globe
      const orbitSpeed = 0.02;
      if (lx !== 0 || ly !== 0) {
        // Simulate mouse drag for orbit
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        const right = new THREE.Vector3().crossVectors(camDir, camera.up).normalize();
        const up = new THREE.Vector3().crossVectors(right, camDir).normalize();

        // Move camera around the globe
        const offset = new THREE.Vector3()
          .addScaledVector(right, -lx * orbitSpeed * camera.position.length())
          .addScaledVector(up, ly * orbitSpeed * camera.position.length());
        camera.position.add(offset);
        camera.lookAt(0, 0, 0);
      }

      // Right stick Y: zoom in/out
      if (ry !== 0) {
        const zoomSpeed = 0.02;
        const dir = new THREE.Vector3().copy(camera.position).normalize();
        camera.position.addScaledVector(dir, -ry * zoomSpeed * camera.position.length());
      }

      // Right stick X: rotate view
      if (rx !== 0) {
        const rotSpeed = 0.01;
        camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), -rx * rotSpeed);
        camera.lookAt(0, 0, 0);
      }
    }
  }
}

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  tiles.setResolutionFromRenderer(camera, renderer);
});

// --- Render loop ---
renderer.setAnimationLoop(() => {
  handleGamepad();
  controls.update();
  camera.updateMatrixWorld();
  tiles.update();
  renderer.render(scene, camera);
});
