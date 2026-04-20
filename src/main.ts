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

// Starting location: Kuala Lumpur, 500m above ground
const START_LAT = 3.1398 * DEG2RAD;
const START_LON = 101.6878 * DEG2RAD;
const START_ALT = 500;

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.setClearColor(0x000000);
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

// Wrapper group: we transform THIS for VR, leaving tilesRenderer.group untouched
// so the library can manage its own internal transforms
const vrContainer = new THREE.Group();
vrContainer.add(tilesRenderer.group);
scene.add(vrContainer);

tilesRenderer.setCamera(camera);
tilesRenderer.setResolutionFromRenderer(camera, renderer);

// --- Desktop Controls ---
const controls = new GlobeControls(scene, camera, renderer.domElement, tilesRenderer);

// --- VR ---
let inVR = false;
const flySpeed = 20;

// ECEF position of start location
const startECEF = new THREE.Vector3();
WGS84_ELLIPSOID.getCartographicToPosition(START_LAT, START_LON, START_ALT, startECEF);

// Surface normal at start = "up" on Earth
const surfaceNormal = startECEF.clone().normalize();

// Rotation: align surface normal with VR Y-up
const alignQuat = new THREE.Quaternion().setFromUnitVectors(surfaceNormal, new THREE.Vector3(0, 1, 0));

// User movement
const vrUserOffset = new THREE.Vector3();
let vrYaw = 0;

function updateVRContainer() {
  // Combine alignment rotation with user yaw
  const yawQuat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), -vrYaw
  );
  const totalQuat = yawQuat.multiply(alignQuat);

  vrContainer.quaternion.copy(totalQuat);

  // Position: rotate startECEF by totalQuat, negate it, then subtract user offset
  vrContainer.position.copy(startECEF).applyQuaternion(totalQuat).negate();
  vrContainer.position.sub(vrUserOffset);
}

renderer.xr.addEventListener('sessionstart', () => {
  inVR = true;
  controls.enabled = false;

  vrUserOffset.set(0, 0, 0);
  vrYaw = 0;
  updateVRContainer();

  const xrCamera = renderer.xr.getCamera();
  tilesRenderer.setCamera(xrCamera);
  tilesRenderer.setResolutionFromRenderer(xrCamera, renderer);
});

renderer.xr.addEventListener('sessionend', () => {
  inVR = false;
  controls.enabled = true;

  // Reset container
  vrContainer.position.set(0, 0, 0);
  vrContainer.quaternion.identity();

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
      if (Math.abs(axes[2]) > deadzone) vrUserOffset.x += axes[2] * flySpeed;
      if (Math.abs(axes[3]) > deadzone) vrUserOffset.z += axes[3] * flySpeed;
    } else if (source.handedness === 'right') {
      if (Math.abs(axes[3]) > deadzone) vrUserOffset.y -= axes[3] * flySpeed;
      if (Math.abs(axes[2]) > deadzone) vrYaw += axes[2] * 0.02;
    }
  }

  updateVRContainer();
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
