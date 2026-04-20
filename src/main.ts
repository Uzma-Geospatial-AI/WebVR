import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import {
  TilesRenderer,
  GlobeControls,
  Scheduler,
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
renderer.setClearColor(0x000011);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// --- Scene ---
const scene = new THREE.Scene();

// --- Workspace (VR camera rig) ---
const workspace = new THREE.Group();
scene.add(workspace);

// --- Camera ---
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1e8);
camera.position.set(4800000, 2570000, 14720000);
camera.lookAt(0, 0, 0);
workspace.add(camera);

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

// --- Desktop Controls ---
const controls = new GlobeControls(scene, camera, renderer.domElement, tiles);

// --- VR button ---
document.body.appendChild(VRButton.createButton(renderer));

// --- VR State ---
let xrSession: XRSession | null = null;
let inVR = false;
let desktopCamPos = new THREE.Vector3();
let desktopCamQuat = new THREE.Quaternion();

// VR orbit state: spherical coordinates around Earth center
let vrRadius = 15_000_000; // distance from Earth center (start in space)
let vrTheta = 1.0;         // polar angle (0=north pole, PI=south pole)
let vrPhi = 1.8;           // azimuthal angle

const MIN_RADIUS = 7_500_000; // ~1100km above surface, safe from float issues
const MAX_RADIUS = 30_000_000;

function updateWorkspaceFromOrbit() {
  // Convert spherical to cartesian
  const x = vrRadius * Math.sin(vrTheta) * Math.cos(vrPhi);
  const y = vrRadius * Math.cos(vrTheta);
  const z = vrRadius * Math.sin(vrTheta) * Math.sin(vrPhi);

  workspace.position.set(x, y, z);
  workspace.lookAt(0, 0, 0);
}

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

renderer.xr.addEventListener('sessionstart', () => {
  inVR = true;
  controls.enabled = false;

  desktopCamPos.copy(camera.position);
  desktopCamQuat.copy(camera.quaternion);

  // Initialize orbit from current camera position
  vrRadius = camera.position.length();
  vrTheta = Math.acos(camera.position.y / vrRadius);
  vrPhi = Math.atan2(camera.position.z, camera.position.x);

  camera.position.set(0, 0, 0);
  camera.quaternion.identity();

  updateWorkspaceFromOrbit();
});

renderer.xr.addEventListener('sessionend', () => {
  inVR = false;
  controls.enabled = true;

  workspace.position.set(0, 0, 0);
  workspace.quaternion.identity();
  camera.position.copy(desktopCamPos);
  camera.quaternion.copy(desktopCamQuat);
});

// --- VR Orbit Controls ---
function handleVRControls() {
  const session = renderer.xr.getSession();
  if (!session) return;

  for (const source of session.inputSources) {
    if (!source.gamepad) continue;

    const axes = source.gamepad.axes;
    const dz = 0.15;

    if (source.handedness === 'left') {
      // Left stick: orbit around globe
      // X = rotate east/west (phi), Y = rotate north/south (theta)
      const lx = Math.abs(axes[2]) > dz ? axes[2] : 0;
      const ly = Math.abs(axes[3]) > dz ? axes[3] : 0;

      if (lx !== 0) vrPhi -= lx * 0.02;
      if (ly !== 0) {
        vrTheta = Math.max(0.1, Math.min(Math.PI - 0.1, vrTheta + ly * 0.02));
      }
    } else if (source.handedness === 'right') {
      // Right stick Y: zoom in/out (change radius)
      const ry = Math.abs(axes[3]) > dz ? axes[3] : 0;

      if (ry !== 0) {
        const zoomFactor = 1 + ry * 0.02;
        vrRadius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, vrRadius * zoomFactor));
      }
    }
  }

  updateWorkspaceFromOrbit();
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
    handleVRControls();
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
