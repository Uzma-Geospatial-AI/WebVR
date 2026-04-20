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

// Starting location: Kuala Lumpur, 300m above ground
const START_LAT = 3.1398 * DEG2RAD;
const START_LON = 101.6878 * DEG2RAD;
const START_ALT = 3000; // 3km above ground

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

// --- Camera (used for desktop view) ---
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

// --- VR State ---
let inVR = false;
const flySpeed = 50;

// Compute where on Earth the user should start in VR (ECEF coordinates)
const vrStartPos = new THREE.Vector3();
WGS84_ELLIPSOID.getCartographicToPosition(START_LAT, START_LON, START_ALT, vrStartPos);

// Get the ENU frame at start position (gives us local up/north/east)
const enuMatrix = new THREE.Matrix4();
WGS84_ELLIPSOID.getEastNorthUpFrame(START_LAT, START_LON, START_ALT, enuMatrix);

// Current VR offset from start position (in local ENU space)
const vrOffset = new THREE.Vector3(0, 0, 0);
const vrYaw = { value: 0 };

// In VR, the XR camera is always near (0,0,0). So we move the WORLD (tilesRenderer.group)
// so that the desired Earth location ends up at origin.
function updateTilesGroupForVR() {
  // Start with the ENU frame matrix (positions + orients at the Earth location)
  const m = enuMatrix.clone();

  // Apply user's yaw rotation (around local Up axis)
  const yawMatrix = new THREE.Matrix4().makeRotationAxis(
    new THREE.Vector3(0, 1, 0),
    vrYaw.value
  );

  // Apply user's position offset (in local ENU space)
  const offsetMatrix = new THREE.Matrix4().makeTranslation(
    vrOffset.x, vrOffset.y, vrOffset.z
  );

  // Combined: where in ECEF the user currently "is"
  // userWorldPos = enuMatrix * yawMatrix * offsetMatrix
  const userMatrix = m.clone().multiply(yawMatrix).multiply(offsetMatrix);

  // Invert: move the world so the user's position maps to origin
  tilesRenderer.group.matrix.copy(userMatrix).invert();
  tilesRenderer.group.matrixAutoUpdate = false;
}

renderer.xr.addEventListener('sessionstart', () => {
  inVR = true;
  controls.enabled = false;

  // Reset VR offset
  vrOffset.set(0, 0, 0);
  vrYaw.value = 0;

  // Position the tiles so Earth is around the user
  updateTilesGroupForVR();

  // Use XR camera for tile LOD
  const xrCamera = renderer.xr.getCamera();
  tilesRenderer.setCamera(xrCamera);
  tilesRenderer.setResolutionFromRenderer(xrCamera, renderer);
});

renderer.xr.addEventListener('sessionend', () => {
  inVR = false;
  controls.enabled = true;

  // Restore tiles group transform
  tilesRenderer.group.matrixAutoUpdate = true;
  tilesRenderer.group.matrix.identity();
  tilesRenderer.group.position.set(0, 0, 0);
  tilesRenderer.group.rotation.set(0, 0, 0);
  tilesRenderer.group.scale.set(1, 1, 1);

  // Restore desktop camera
  tilesRenderer.setCamera(camera);
  tilesRenderer.setResolutionFromRenderer(camera, renderer);
});

// --- VR Controller Flight ---
function handleVRMovement() {
  const session = renderer.xr.getSession();
  if (!session) return;

  for (const source of session.inputSources) {
    if (!source.gamepad) continue;

    const axes = source.gamepad.axes;
    const deadzone = 0.15;

    if (source.handedness === 'left') {
      // Left stick: forward/back (Z) and strafe (X)
      if (Math.abs(axes[2]) > deadzone) vrOffset.x += axes[2] * flySpeed;
      if (Math.abs(axes[3]) > deadzone) vrOffset.z += axes[3] * flySpeed;
    } else if (source.handedness === 'right') {
      // Right stick Y: up/down
      if (Math.abs(axes[3]) > deadzone) vrOffset.y -= axes[3] * flySpeed;
      // Right stick X: yaw rotation
      if (Math.abs(axes[2]) > deadzone) vrYaw.value += axes[2] * 0.02;
    }
  }

  updateTilesGroupForVR();
}

// --- Handle resize ---
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
