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

// --- Starting location: Kuala Lumpur ---
const START_LAT = 3.1398 * DEG2RAD;
const START_LON = 101.6878 * DEG2RAD;
const START_ALT = 300; // meters above ground

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

// --- Camera ---
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  1,
  1e8
);
// Desktop: position above Earth
camera.position.set(4800000, 2570000, 14720000);
camera.lookAt(0, 0, 0);

// --- VR Rig: a group we move around, camera lives inside it in XR ---
const vrRig = new THREE.Group();
scene.add(vrRig);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
scene.add(ambientLight);

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

// --- Globe Controls (desktop only) ---
const controls = new GlobeControls(scene, camera, renderer.domElement, tilesRenderer);

// --- VR State ---
let inVR = false;
const flySpeed = 50; // meters per frame (~3 km/min at 60fps)

// Position the VR rig on Earth's surface at the start location
function positionVRRig(lat: number, lon: number, alt: number) {
  const position = new THREE.Vector3();
  WGS84_ELLIPSOID.getCartographicToPosition(lat, lon, alt, position);

  // Get the ENU (East-North-Up) frame at this location
  const enuMatrix = new THREE.Matrix4();
  WGS84_ELLIPSOID.getEastNorthUpFrame(lat, lon, alt, enuMatrix);

  vrRig.position.copy(position);
  vrRig.rotation.setFromRotationMatrix(enuMatrix);
}

renderer.xr.addEventListener('sessionstart', () => {
  inVR = true;
  controls.enabled = false;

  // Position rig at starting location on Earth
  positionVRRig(START_LAT, START_LON, START_ALT);

  // Register XR camera with tiles renderer
  const xrCamera = renderer.xr.getCamera();
  tilesRenderer.setCamera(xrCamera);
  tilesRenderer.setResolutionFromRenderer(xrCamera, renderer);
});

renderer.xr.addEventListener('sessionend', () => {
  inVR = false;
  controls.enabled = true;

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

    // Quest 2 thumbstick: axes[2] = X (left/right), axes[3] = Y (forward/back)
    const axes = source.gamepad.axes;
    const deadzone = 0.15;

    let moveX = 0;
    let moveY = 0;
    let moveZ = 0;

    if (source.handedness === 'left') {
      // Left stick: horizontal movement (strafe + forward/back)
      if (Math.abs(axes[2]) > deadzone) moveX = axes[2] * flySpeed;
      if (Math.abs(axes[3]) > deadzone) moveZ = -axes[3] * flySpeed;
    } else if (source.handedness === 'right') {
      // Right stick: vertical movement (up/down) + rotation
      if (Math.abs(axes[3]) > deadzone) moveY = -axes[3] * flySpeed;
      if (Math.abs(axes[2]) > deadzone) {
        vrRig.rotateOnWorldAxis(
          new THREE.Vector3(0, 1, 0).applyQuaternion(vrRig.quaternion).normalize(),
          -axes[2] * 0.02
        );
      }
    }

    if (moveX !== 0 || moveY !== 0 || moveZ !== 0) {
      // Move relative to the rig's orientation
      const movement = new THREE.Vector3(moveX, moveY, moveZ);
      movement.applyQuaternion(vrRig.quaternion);
      vrRig.position.add(movement);
    }
  }
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
