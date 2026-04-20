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

// --- VR Precomputed values ---
let inVR = false;
const flySpeed = 20;

// ECEF position of start location
const startECEF = new THREE.Vector3();
WGS84_ELLIPSOID.getCartographicToPosition(START_LAT, START_LON, START_ALT, startECEF);

// Surface normal at start (= "up" direction on Earth at that point)
const surfaceNormal = startECEF.clone().normalize();

// Rotation to align surface normal with Y-up
const alignQuat = new THREE.Quaternion().setFromUnitVectors(surfaceNormal, new THREE.Vector3(0, 1, 0));

// User movement state
const vrUserOffset = new THREE.Vector3();
let vrYaw = 0;

// --- Debug: red cube at VR origin so we can see if transform works ---
const debugCube = new THREE.Mesh(
  new THREE.BoxGeometry(50, 50, 50),
  new THREE.MeshBasicMaterial({ color: 0xff0000 })
);
debugCube.visible = false;
scene.add(debugCube);

function updateWorldForVR() {
  const group = tilesRenderer.group;

  // The tiles live in ECEF space inside the group.
  // XR camera is at world origin (0,0,0).
  // We need: group transforms ECEF so that startECEF -> (0,0,0) in world.
  //
  // For a point P_ecef in the group:
  //   P_world = group.quaternion * P_ecef + group.position
  //
  // We want P_world = (0,0,0) when P_ecef = startECEF:
  //   0 = alignQuat * startECEF + group.position
  //   group.position = -(alignQuat * startECEF)

  // Combine user yaw with the surface alignment
  const yawQuat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), -vrYaw
  );
  const totalQuat = yawQuat.clone().multiply(alignQuat);

  group.quaternion.copy(totalQuat);

  // Position: negate the rotated ECEF start position, then add user offset
  group.position.copy(startECEF).applyQuaternion(totalQuat).negate();
  group.position.sub(vrUserOffset);

  group.updateMatrixWorld(true);
}

renderer.xr.addEventListener('sessionstart', () => {
  inVR = true;
  controls.enabled = false;
  debugCube.visible = true;

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
  debugCube.visible = false;

  const group = tilesRenderer.group;
  group.position.set(0, 0, 0);
  group.quaternion.identity();
  group.scale.set(1, 1, 1);
  group.updateMatrixWorld(true);

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
