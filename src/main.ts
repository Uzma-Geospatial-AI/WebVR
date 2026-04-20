/**
 * Based on official NASA-AMMOS VR example structure,
 * adapted for Google Photorealistic 3D Tiles via Cesium Ion.
 */
import {
  Scene,
  DirectionalLight,
  AmbientLight,
  WebGLRenderer,
  PerspectiveCamera,
  Group,
  Vector3,
  Quaternion,
  GridHelper,
} from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { TilesRenderer, Scheduler, WGS84_ELLIPSOID, GlobeControls } from '3d-tiles-renderer';
import {
  CesiumIonAuthPlugin,
  TileCompressionPlugin,
  GLTFExtensionsPlugin,
  TilesFadePlugin,
} from '3d-tiles-renderer/plugins';

const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN;
const DEG2RAD = Math.PI / 180;

const START_LAT = 3.1398 * DEG2RAD;
const START_LON = 101.6878 * DEG2RAD;
const START_ALT = 500;

// --- Precompute Earth surface transform ---
const startECEF = new Vector3();
WGS84_ELLIPSOID.getCartographicToPosition(START_LAT, START_LON, START_ALT, startECEF);
const surfaceNormal = new Vector3().copy(startECEF).normalize();
const alignQuat = new Quaternion().setFromUnitVectors(surfaceNormal, new Vector3(0, 1, 0));

// --- Renderer ---
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87ceeb);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// --- Scene ---
const scene = new Scene();

// --- Camera ---
const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1e8);
camera.position.set(4800000, 2570000, 14720000);
camera.lookAt(0, 0, 0);

// --- Lighting ---
scene.add(new AmbientLight(0xffffff, 1.0));
const dirLight = new DirectionalLight(0xffffff, 1.0);
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

// --- Desktop Controls ---
const controls = new GlobeControls(scene, camera, renderer.domElement, tiles);

// --- VR workspace (camera rig) ---
const workspace = new Group();
const vrGrid = new GridHelper(200, 20, 0xffffff, 0xffffff);
(vrGrid.material as any).transparent = true;
(vrGrid.material as any).opacity = 0.3;
(vrGrid.material as any).depthWrite = false;
workspace.add(vrGrid);
// workspace is added/removed from scene when entering/exiting VR

// --- VR state ---
let inVR = false;
let xrSession: XRSession | null = null;
const flySpeed = 5;

// --- VR camera handling (from official example) ---
function handleCamera() {
  if (renderer.xr.isPresenting) {
    if (xrSession === null) {
      const xrCamera = renderer.xr.getCamera();

      tiles.cameras.forEach((c) => tiles.deleteCamera(c));
      tiles.setCamera(xrCamera);

      const leftCam = xrCamera.cameras[0];
      if (leftCam) {
        tiles.setResolution(xrCamera, leftCam.viewport.z, leftCam.viewport.w);
      }

      xrSession = renderer.xr.getSession();
      Scheduler.setXRSession(xrSession!);
    }
  } else {
    if (xrSession !== null) {
      tiles.cameras.forEach((c) => tiles.deleteCamera(c));
      tiles.setCamera(camera);
      tiles.setResolutionFromRenderer(camera, renderer);

      xrSession = null;
      Scheduler.setXRSession(null as unknown as XRSession);
    }
  }
}

function enterVR() {
  inVR = true;
  controls.enabled = false;

  // Remove camera from scene root, put in workspace
  scene.remove(camera);
  workspace.add(camera);
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.6, -1);

  // Add workspace to scene
  scene.add(workspace);
  workspace.position.set(0, 0, 0);
  workspace.quaternion.identity();

  // Transform tiles.group so Earth surface at KL = scene origin
  // Step 1: negate ECEF to bring KL to origin
  // Step 2: rotate so surface normal = Y-up
  // We apply this on tiles.group directly since no getBoundingBox centering is needed
  tiles.group.quaternion.copy(alignQuat);
  const rotatedStart = new Vector3().copy(startECEF).applyQuaternion(alignQuat);
  tiles.group.position.copy(rotatedStart).negate();
}

function exitVR() {
  inVR = false;
  controls.enabled = true;

  // Move camera back to scene root
  workspace.remove(camera);
  scene.add(camera);
  camera.position.set(4800000, 2570000, 14720000);
  camera.lookAt(0, 0, 0);

  // Remove workspace
  scene.remove(workspace);

  // Reset tiles.group
  tiles.group.position.set(0, 0, 0);
  tiles.group.quaternion.identity();
}

renderer.xr.addEventListener('sessionstart', enterVR);
renderer.xr.addEventListener('sessionend', exitVR);

// --- VR thumbstick flight ---
function handleVRMovement() {
  const session = renderer.xr.getSession();
  if (!session) return;

  for (const source of session.inputSources) {
    if (!source.gamepad) continue;
    const axes = source.gamepad.axes;
    const dz = 0.15;

    if (source.handedness === 'left') {
      const mx = Math.abs(axes[2]) > dz ? axes[2] * flySpeed : 0;
      const mz = Math.abs(axes[3]) > dz ? axes[3] * flySpeed : 0;
      if (mx !== 0 || mz !== 0) {
        const dir = new Vector3(mx, 0, mz);
        dir.applyQuaternion(workspace.quaternion);
        workspace.position.add(dir);
      }
    } else if (source.handedness === 'right') {
      if (Math.abs(axes[3]) > dz) workspace.position.y -= axes[3] * flySpeed;
      if (Math.abs(axes[2]) > dz) workspace.rotation.y -= axes[2] * 0.02;
    }
  }
}

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (!inVR) tiles.setResolutionFromRenderer(camera, renderer);
});

// --- Render loop ---
renderer.setAnimationLoop(() => {
  handleCamera();

  if (inVR) {
    handleVRMovement();
    if (xrSession) {
      const xrCamera = renderer.xr.getCamera();
      const leftCam = xrCamera.cameras[0];
      if (leftCam && leftCam.viewport) {
        tiles.setResolution(xrCamera, leftCam.viewport.z, leftCam.viewport.w);
      }
    }
  } else {
    controls.update();
  }

  camera.updateMatrixWorld();
  tiles.update();
  renderer.render(scene, camera);
});
