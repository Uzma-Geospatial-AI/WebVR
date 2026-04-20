import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { TilesRenderer } from '3d-tiles-renderer';
import { CesiumIonAuthPlugin } from '3d-tiles-renderer/plugins';
import { GlobeControls } from '3d-tiles-renderer';

const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN;

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
renderer.sortObjects = false;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// --- Scene ---
const scene = new THREE.Scene();

// --- Camera ---
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  1,
  1e8
);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(1, 2, 1).normalize();
scene.add(dirLight);

// --- 3D Tiles: Google Photorealistic via Cesium Ion ---
const tilesRenderer = new TilesRenderer();

tilesRenderer.registerPlugin(
  new CesiumIonAuthPlugin({
    apiToken: CESIUM_ION_TOKEN,
    assetId: '2275207', // Google Photorealistic 3D Tiles
    autoRefreshToken: true,
  })
);

tilesRenderer.setCamera(camera);
tilesRenderer.setResolutionFromRenderer(camera, renderer);
scene.add(tilesRenderer.group);

// --- Globe Controls (desktop navigation) ---
const controls = new GlobeControls(scene, camera, renderer.domElement, tilesRenderer);

// --- Handle resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  tilesRenderer.setResolutionFromRenderer(camera, renderer);
});

// --- Render loop (WebXR-compatible) ---
renderer.setAnimationLoop(() => {
  controls.update();
  camera.updateMatrixWorld();
  tilesRenderer.update();
  renderer.render(scene, camera);
});
