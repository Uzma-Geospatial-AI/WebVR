import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { TilesRenderer, GlobeControls, WGS84_ELLIPSOID } from '3d-tiles-renderer';
import {
  CesiumIonAuthPlugin,
  TileCompressionPlugin,
  GLTFExtensionsPlugin,
  TilesFadePlugin,
} from '3d-tiles-renderer/plugins';

const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN;
const DEG2RAD = Math.PI / 180;

// Starting location: Kuala Lumpur
const START_LAT = 3.1398 * DEG2RAD;
const START_LON = 101.6878 * DEG2RAD;
const START_ALT = 500;

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.setClearColor(0x87ceeb);
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// --- Scene ---
const scene = new THREE.Scene();

// --- Camera (desktop) ---
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  1,
  1e8
);
camera.position.set(4800000, 2570000, 14720000);
camera.lookAt(0, 0, 0);

// --- Lighting ---
scene.add(new THREE.AmbientLight(0xffffff, 1.0));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(1, 2, 1).normalize();
scene.add(dirLight);

// --- 3D Tiles ---
const tilesRenderer = new TilesRenderer();

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

tilesRenderer.registerPlugin(new CesiumIonAuthPlugin({
  apiToken: CESIUM_ION_TOKEN,
  assetId: '2275207',
  autoRefreshToken: true,
}));
tilesRenderer.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader }));
tilesRenderer.registerPlugin(new TileCompressionPlugin());
tilesRenderer.registerPlugin(new TilesFadePlugin());

tilesRenderer.setCamera(camera);
tilesRenderer.setResolutionFromRenderer(camera, renderer);
scene.add(tilesRenderer.group);

// --- Desktop Controls ---
const controls = new GlobeControls(scene, camera, renderer.domElement, tilesRenderer);

// --- VR ---
let inVR = false;
const flySpeed = 20;

// Get ECEF position of our start location
const startECEF = new THREE.Vector3();
WGS84_ELLIPSOID.getCartographicToPosition(START_LAT, START_LON, START_ALT, startECEF);

// Get surface normal (points "up" from Earth surface at this location)
const surfaceNormal = startECEF.clone().normalize();

// Build a rotation that aligns Earth's surface-up with world Y-up at the user's position.
// This way, "down" in VR = toward Earth center, "up" = away from Earth.
const upDir = new THREE.Vector3(0, 1, 0);
const rotQuat = new THREE.Quaternion().setFromUnitVectors(surfaceNormal, upDir);

// VR user offset (accumulated from thumbstick input, in VR-local space)
const vrUserOffset = new THREE.Vector3();
let vrYaw = 0;

function updateWorldForVR() {
  // Step 1: translate so startECEF maps to origin
  // Step 2: rotate so surface normal aligns with Y-up
  // Step 3: apply user offset (movement from thumbsticks)

  const group = tilesRenderer.group;
  group.matrixAutoUpdate = false;

  // Build transform: first translate, then rotate, then offset
  const m = new THREE.Matrix4();

  // Translate: move the Earth so our start position is at origin
  m.makeTranslation(-startECEF.x, -startECEF.y, -startECEF.z);

  // Rotate: align surface normal with Y-up
  const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(rotQuat);
  m.premultiply(rotMatrix);

  // Apply user yaw
  const yawMatrix = new THREE.Matrix4().makeRotationY(-vrYaw);
  m.premultiply(yawMatrix);

  // Apply user offset (translation in VR space)
  const offsetMatrix = new THREE.Matrix4().makeTranslation(
    -vrUserOffset.x, -vrUserOffset.y, -vrUserOffset.z
  );
  m.premultiply(offsetMatrix);

  group.matrix.copy(m);
}

renderer.xr.addEventListener('sessionstart', () => {
  inVR = true;
  controls.enabled = false;

  vrUserOffset.set(0, 0, 0);
  vrYaw = 0;
  updateWorldForVR();

  const xrCamera = renderer.xr.getCamera();
  tilesRenderer.setCamera(xrCamera);
  tilesRenderer.setResolutionFromRenderer(xrCamera, renderer);
});

renderer.xr.addEventListener('sessionend', () => {
  inVR = false;
  controls.enabled = true;

  const group = tilesRenderer.group;
  group.matrixAutoUpdate = true;
  group.matrix.identity();
  group.position.set(0, 0, 0);
  group.rotation.set(0, 0, 0);
  group.scale.set(1, 1, 1);

  tilesRenderer.setCamera(camera);
  tilesRenderer.setResolutionFromRenderer(camera, renderer);
});

function handleVRMovement() {
  const session = renderer.xr.getSession();
  if (!session) return;

  for (const source of session.inputSources) {
    if (!source.gamepad) continue;

    const axes = source.gamepad.axes;
    const deadzone = 0.15;

    if (source.handedness === 'left') {
      // Left stick: forward/back and strafe
      if (Math.abs(axes[2]) > deadzone) vrUserOffset.x += axes[2] * flySpeed;
      if (Math.abs(axes[3]) > deadzone) vrUserOffset.z += axes[3] * flySpeed;
    } else if (source.handedness === 'right') {
      // Right stick Y: up/down
      if (Math.abs(axes[3]) > deadzone) vrUserOffset.y -= axes[3] * flySpeed;
      // Right stick X: yaw
      if (Math.abs(axes[2]) > deadzone) vrYaw += axes[2] * 0.02;
    }
  }

  updateWorldForVR();
}

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  tilesRenderer.setResolutionFromRenderer(camera, renderer);
});

// --- Render loop ---
renderer.setAnimationLoop(() => {
  if (inVR) {
    handleVRMovement();
    const xrCamera = renderer.xr.getCamera();
    xrCamera.updateMatrixWorld();
    tilesRenderer.setResolutionFromRenderer(xrCamera, renderer);
  } else {
    controls.update();
    camera.updateMatrixWorld();
  }

  tilesRenderer.update();
  renderer.render(scene, camera);
});
