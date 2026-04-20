import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import {
  TilesRenderer,
  GlobeControls,
  WGS84_ELLIPSOID,
  Scheduler,
} from '3d-tiles-renderer';
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
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87ceeb);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// --- Scene ---
const scene = new THREE.Scene();

// --- Workspace: camera rig (same pattern as official VR example) ---
// In VR, the XR camera is inside workspace. Moving workspace = moving the user.
const workspace = new THREE.Group();
scene.add(workspace);

// --- Camera (child of workspace) ---
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  1,
  1e8
);
camera.position.set(0, 1.6, 0);
workspace.add(camera);

// --- Lighting ---
scene.add(new THREE.AmbientLight(0xffffff, 1.0));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(1, 2, 1).normalize();
scene.add(dirLight);

// --- offsetParent: transforms ECEF so our start location is at scene origin ---
const offsetParent = new THREE.Group();
scene.add(offsetParent);

// Compute ECEF position of start and the rotation to align surface normal to Y-up
const startECEF = new THREE.Vector3();
WGS84_ELLIPSOID.getCartographicToPosition(START_LAT, START_LON, START_ALT, startECEF);
const surfaceNormal = startECEF.clone().normalize();
const alignQuat = new THREE.Quaternion().setFromUnitVectors(
  surfaceNormal,
  new THREE.Vector3(0, 1, 0)
);

// offsetParent rotates ECEF so surface-up = Y-up, then translates so start pos = origin
offsetParent.quaternion.copy(alignQuat);
// After rotation, startECEF rotated should map to (0, |startECEF|, 0).
// We want it at (0, 0, 0), so negate:
const rotatedStart = startECEF.clone().applyQuaternion(alignQuat);
offsetParent.position.copy(rotatedStart).negate();

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

offsetParent.add(tilesRenderer.group);

tilesRenderer.setCamera(camera);
tilesRenderer.setResolutionFromRenderer(camera, renderer);

// --- Desktop Controls ---
// For desktop, temporarily move camera out of workspace for globe view
let inVR = false;
let xrSession: XRSession | null = null;
const flySpeed = 5;

// Desktop: position camera far from Earth for globe view
function setupDesktopView() {
  // Remove camera from workspace, add to scene for free orbit
  workspace.remove(camera);
  scene.add(camera);
  camera.position.set(4800000, 2570000, 14720000);
  camera.lookAt(0, 0, 0);

  // Reset offsetParent for desktop (tiles in native ECEF)
  offsetParent.position.set(0, 0, 0);
  offsetParent.quaternion.identity();
}

function setupVRView() {
  // Move camera back into workspace
  scene.remove(camera);
  workspace.add(camera);
  camera.position.set(0, 1.6, 0);

  // Set offsetParent to bring KL to origin
  offsetParent.quaternion.copy(alignQuat);
  offsetParent.position.copy(rotatedStart).negate();

  // Reset workspace position
  workspace.position.set(0, 0, 0);
}

// Start in desktop mode
setupDesktopView();
const controls = new GlobeControls(scene, camera, renderer.domElement, tilesRenderer);

// --- XR Camera handling (from official VR example) ---
function handleCamera() {
  if (renderer.xr.isPresenting) {
    if (xrSession === null) {
      const xrCamera = renderer.xr.getCamera();

      tilesRenderer.cameras.forEach((c: THREE.Camera) => tilesRenderer.deleteCamera(c));
      tilesRenderer.setCamera(xrCamera);

      const leftCam = xrCamera.cameras[0];
      if (leftCam) {
        tilesRenderer.setResolution(xrCamera, leftCam.viewport.z, leftCam.viewport.w);
      }

      xrSession = renderer.xr.getSession();
      if (xrSession) {
        Scheduler.setXRSession(xrSession);
      }
    }
  } else {
    if (xrSession !== null) {
      tilesRenderer.cameras.forEach((c: THREE.Camera) => tilesRenderer.deleteCamera(c));
      tilesRenderer.setCamera(camera);
      tilesRenderer.setResolutionFromRenderer(camera, renderer);

      xrSession = null;
      Scheduler.setXRSession(null as unknown as XRSession);
    }
  }
}

renderer.xr.addEventListener('sessionstart', () => {
  inVR = true;
  controls.enabled = false;
  setupVRView();
});

renderer.xr.addEventListener('sessionend', () => {
  inVR = false;
  controls.enabled = true;
  setupDesktopView();
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
      // Left stick: forward/back and strafe (relative to head direction)
      const moveX = Math.abs(axes[2]) > deadzone ? axes[2] * flySpeed : 0;
      const moveZ = Math.abs(axes[3]) > deadzone ? axes[3] * flySpeed : 0;

      if (moveX !== 0 || moveZ !== 0) {
        const dir = new THREE.Vector3(moveX, 0, moveZ);
        // Move relative to camera direction projected on XZ plane
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        camDir.y = 0;
        camDir.normalize();
        const angle = Math.atan2(camDir.x, camDir.z);
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        workspace.position.add(dir);
      }
    } else if (source.handedness === 'right') {
      // Right stick Y: up/down
      if (Math.abs(axes[3]) > deadzone) {
        workspace.position.y -= axes[3] * flySpeed;
      }
      // Right stick X: snap turn
      if (Math.abs(axes[2]) > deadzone) {
        workspace.rotation.y -= axes[2] * 0.02;
      }
    }
  }
}

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Render loop ---
renderer.setAnimationLoop(() => {
  handleCamera();

  if (inVR) {
    handleVRMovement();

    // Re-set resolution each frame (viewport may not be ready on first frame)
    if (xrSession) {
      const xrCamera = renderer.xr.getCamera();
      const leftCam = xrCamera.cameras[0];
      if (leftCam && leftCam.viewport) {
        tilesRenderer.setResolution(xrCamera, leftCam.viewport.z, leftCam.viewport.w);
      }
    }
  } else {
    controls.update();
  }

  camera.updateMatrixWorld();
  tilesRenderer.update();
  renderer.render(scene, camera);
});
