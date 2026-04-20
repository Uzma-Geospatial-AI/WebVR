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
renderer.setClearColor(0x87ceeb);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// --- Scene ---
const scene = new THREE.Scene();

// --- Workspace (VR camera rig, same as official VR example) ---
const workspace = new THREE.Group();
scene.add(workspace);

// --- Camera (inside workspace) ---
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1e8);
camera.position.set(4800000, 2570000, 14720000);
camera.lookAt(0, 0, 0);
workspace.add(camera);

// --- Lighting ---
scene.add(new THREE.AmbientLight(0xffffff, 1.0));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(1, 2, 1).normalize();
scene.add(dirLight);

// --- 3D Tiles (NO transform - tiles stay in native ECEF) ---
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

// --- Globe Controls ---
const controls = new GlobeControls(scene, camera, renderer.domElement, tiles);

// --- Buttons ---
const btnContainer = document.createElement('div');
btnContainer.style.cssText = `
  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 10px; z-index: 999;
`;
document.body.appendChild(btnContainer);

// Fullscreen button
const fsBtn = document.createElement('button');
fsBtn.textContent = 'FULLSCREEN';
fsBtn.style.cssText = `
  padding: 12px 24px; font-size: 18px; font-weight: bold;
  background: #333; color: #fff; border: 1px solid #fff;
  border-radius: 4px; cursor: pointer;
`;
fsBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
});
btnContainer.appendChild(fsBtn);

// VR button
btnContainer.appendChild(VRButton.createButton(renderer));

document.addEventListener('fullscreenchange', () => {
  fsBtn.style.display = document.fullscreenElement ? 'none' : 'block';
});

// --- VR camera handling (exact pattern from official VR example) ---
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

  // In VR: keep camera at same position as desktop view
  // The workspace holds the camera, so move workspace to where the camera was
  // and reset camera to origin within workspace
  workspace.position.copy(camera.position);
  workspace.quaternion.copy(camera.quaternion);
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
});

renderer.xr.addEventListener('sessionend', () => {
  inVR = false;
  controls.enabled = true;

  // Restore desktop camera
  workspace.position.set(0, 0, 0);
  workspace.quaternion.identity();
  camera.position.copy(desktopCamPos);
  camera.quaternion.copy(desktopCamQuat);
});

// --- Gamepad controls (works in both fullscreen and VR) ---
function handleGamepad() {
  const gamepads = navigator.getGamepads();
  for (const gp of gamepads) {
    if (!gp) continue;

    const deadzone = 0.15;
    const axes = gp.axes;
    const lx = Math.abs(axes[0]) > deadzone ? axes[0] : 0;
    const ly = Math.abs(axes[1]) > deadzone ? axes[1] : 0;
    const rx = Math.abs(axes[2]) > deadzone ? axes[2] : 0;
    const ry = Math.abs(axes[3]) > deadzone ? axes[3] : 0;

    if (lx === 0 && ly === 0 && rx === 0 && ry === 0) continue;

    if (inVR) {
      // VR: move workspace (camera rig) through space
      const flySpeed = 50000; // meters per frame at Earth scale
      if (lx !== 0 || ly !== 0) {
        const move = new THREE.Vector3(lx * flySpeed, 0, ly * flySpeed);
        move.applyQuaternion(workspace.quaternion);
        workspace.position.add(move);
      }
      if (ry !== 0) {
        const fwd = new THREE.Vector3(0, 0, -ry * flySpeed);
        fwd.applyQuaternion(workspace.quaternion);
        workspace.position.add(fwd);
      }
      if (rx !== 0) {
        workspace.rotateY(-rx * 0.02);
      }
    } else {
      // Fullscreen: orbit around globe
      const orbitSpeed = 0.02;
      if (lx !== 0 || ly !== 0) {
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        const right = new THREE.Vector3().crossVectors(camDir, camera.up).normalize();
        const up = new THREE.Vector3().crossVectors(right, camDir).normalize();
        const offset = new THREE.Vector3()
          .addScaledVector(right, -lx * orbitSpeed * camera.position.length())
          .addScaledVector(up, ly * orbitSpeed * camera.position.length());
        camera.position.add(offset);
        camera.lookAt(0, 0, 0);
      }
      if (ry !== 0) {
        const dir = new THREE.Vector3().copy(camera.position).normalize();
        camera.position.addScaledVector(dir, -ry * 0.02 * camera.position.length());
      }
      if (rx !== 0) {
        camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), -rx * 0.01);
        camera.lookAt(0, 0, 0);
      }
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
  handleGamepad();

  if (!inVR) {
    controls.update();
  }

  if (inVR && xrSession) {
    const xrCamera = renderer.xr.getCamera();
    const leftCam = xrCamera.cameras[0];
    if (leftCam && leftCam.viewport) {
      tiles.setResolution(xrCamera, leftCam.viewport.z, leftCam.viewport.w);
    }
  }

  camera.updateMatrixWorld();
  tiles.update();
  renderer.render(scene, camera);
});
