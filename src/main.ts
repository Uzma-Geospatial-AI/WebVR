import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import {
  TilesRenderer,
  Scheduler,
  WGS84_ELLIPSOID,
  GlobeControls,
} from '3d-tiles-renderer';
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

// ECEF position + orientation for start location
const startECEF = new THREE.Vector3();
WGS84_ELLIPSOID.getCartographicToPosition(START_LAT, START_LON, START_ALT, startECEF);
const surfaceNormal = startECEF.clone().normalize();
// alignQuat rotates surfaceNormal -> Y-up
const alignQuat = new THREE.Quaternion().setFromUnitVectors(
  surfaceNormal, new THREE.Vector3(0, 1, 0)
);

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87ceeb);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

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

// --- 3D Tiles (no transform, tiles stay in native ECEF) ---
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

// --- VR ---
let xrSession: XRSession | null = null;
let inVR = false;

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

      // KEY FIX: Use XR reference space offset to teleport the VR camera to
      // Earth's surface. This avoids transforming tiles.group (which causes
      // GPU float precision issues at Earth-scale ECEF coordinates).
      //
      // The offset tells WebXR: "the user's room origin is at this position
      // and orientation in the virtual world." Three.js then computes the
      // view matrix in 64-bit JS (not 32-bit GPU), so precision is preserved.
      const baseSpace = renderer.xr.getReferenceSpace();
      if (baseSpace) {
        // Offset position: place room origin at startECEF
        // XRRigidTransform T: new_origin = T applied to old_origin
        // Viewer pose in new space = T^-1 * viewer_pose_in_old
        // We want camera at startECEF, so T^-1.translation ≈ startECEF
        // => T.position = -(alignQuat * startECEF), T.orientation = alignQuat
        const rotatedStart = startECEF.clone().applyQuaternion(alignQuat);
        const offset = new XRRigidTransform(
          { x: -rotatedStart.x, y: -rotatedStart.y, z: -rotatedStart.z, w: 1 },
          { x: alignQuat.x, y: alignQuat.y, z: alignQuat.z, w: alignQuat.w }
        );
        const offsetSpace = baseSpace.getOffsetReferenceSpace(offset);
        renderer.xr.setReferenceSpace(offsetSpace);
      }
    }
  } else {
    if (xrSession !== null) {
      tiles.cameras.forEach((c) => tiles.deleteCamera(c));
      tiles.setCamera(camera);
      tiles.setResolutionFromRenderer(camera, renderer);
      camera.position.set(4800000, 2570000, 14720000);
      camera.lookAt(0, 0, 0);
      xrSession = null;
      Scheduler.setXRSession(null as unknown as XRSession);
    }
  }
}

renderer.xr.addEventListener('sessionstart', () => {
  inVR = true;
  controls.enabled = false;
});

renderer.xr.addEventListener('sessionend', () => {
  inVR = false;
  controls.enabled = true;
});

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
    const xrCamera = renderer.xr.getCamera();
    const leftCam = xrCamera.cameras[0];
    if (leftCam && leftCam.viewport) {
      tiles.setResolution(xrCamera, leftCam.viewport.z, leftCam.viewport.w);
    }
  } else {
    controls.update();
  }

  camera.updateMatrixWorld();
  tiles.update();
  renderer.render(scene, camera);
});
