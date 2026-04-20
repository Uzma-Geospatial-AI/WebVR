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
document.body.appendChild(VRButton.createButton(renderer));

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

// --- VR State ---
let xrSession: XRSession | null = null;
let inVR = false;
let desktopCamPos = new THREE.Vector3();
let desktopCamQuat = new THREE.Quaternion();

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

  // Save desktop camera state
  desktopCamPos.copy(camera.position);
  desktopCamQuat.copy(camera.quaternion);

  // Move workspace to current camera position, reset camera inside workspace
  workspace.position.copy(camera.position);
  workspace.quaternion.copy(camera.quaternion);
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
});

renderer.xr.addEventListener('sessionend', () => {
  inVR = false;
  controls.enabled = true;

  // Restore desktop view
  workspace.position.set(0, 0, 0);
  workspace.quaternion.identity();
  camera.position.copy(desktopCamPos);
  camera.quaternion.copy(desktopCamQuat);
});

// --- VR Flight Controls ---
function handleVRFlight() {
  const session = renderer.xr.getSession();
  if (!session) return;

  // Fly speed scales with distance to Earth center:
  // far from Earth = fast, close to surface = slow
  const distToCenter = workspace.position.length();
  const earthRadius = 6_378_137;
  const altitude = Math.max(distToCenter - earthRadius, 100);
  const speed = altitude * 0.02; // 2% of altitude per frame

  for (const source of session.inputSources) {
    if (!source.gamepad) continue;

    const axes = source.gamepad.axes;
    const dz = 0.15;

    if (source.handedness === 'left') {
      // Left stick: fly forward/back (Y) and strafe left/right (X)
      const lx = Math.abs(axes[2]) > dz ? axes[2] : 0;
      const ly = Math.abs(axes[3]) > dz ? axes[3] : 0;

      if (lx !== 0 || ly !== 0) {
        const move = new THREE.Vector3(lx * speed, 0, ly * speed);
        move.applyQuaternion(workspace.quaternion);
        workspace.position.add(move);
      }
    } else if (source.handedness === 'right') {
      // Right stick Y: move forward/back along look direction
      const ry = Math.abs(axes[3]) > dz ? axes[3] : 0;
      // Right stick X: yaw rotation
      const rx = Math.abs(axes[2]) > dz ? axes[2] : 0;

      if (ry !== 0) {
        const fwd = new THREE.Vector3(0, 0, ry * speed);
        fwd.applyQuaternion(workspace.quaternion);
        workspace.position.add(fwd);
      }
      if (rx !== 0) {
        workspace.rotateY(-rx * 0.03);
      }
    }

    // Buttons: A/X = fly up, B/Y = fly down (relative to workspace up)
    const buttons = source.gamepad.buttons;
    if (buttons[4]?.pressed) {
      // A or X button: ascend
      const up = new THREE.Vector3(0, speed, 0);
      up.applyQuaternion(workspace.quaternion);
      workspace.position.add(up);
    }
    if (buttons[5]?.pressed) {
      // B or Y button: descend
      const down = new THREE.Vector3(0, -speed, 0);
      down.applyQuaternion(workspace.quaternion);
      workspace.position.add(down);
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
    handleVRFlight();
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
