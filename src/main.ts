import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import {
  TilesRenderer,
  GlobeControls,
  WGS84_ELLIPSOID,
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
document.body.appendChild(renderer.domElement);

// --- Scene ---
const scene = new THREE.Scene();

// --- Camera: start above 4.967290, 118.196778 (Sabah, Malaysia) ---
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1e8);
const startPos = new THREE.Vector3();
WGS84_ELLIPSOID.getCartographicToPosition(
  5.017750 * Math.PI / 180,   // lat in radians
  118.276007 * Math.PI / 180, // lon in radians
  500,                         // 500m above ground
  startPos
);
camera.position.copy(startPos);
camera.lookAt(0, 0, 0);

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

// --- Globe Controls (mouse/touch) ---
const controls = new GlobeControls(scene, camera, renderer.domElement, tiles);

// --- Buttons ---
const btnStyle = `
  padding: 12px 24px; font-size: 16px; font-weight: bold;
  background: #333; color: #fff; border: 1px solid #fff;
  border-radius: 4px; cursor: pointer;
`;

const btnContainer = document.createElement('div');
btnContainer.style.cssText = `
  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 10px; z-index: 999;
`;
document.body.appendChild(btnContainer);

// Fullscreen
const fsBtn = document.createElement('button');
fsBtn.textContent = 'FULLSCREEN';
fsBtn.style.cssText = btnStyle;
fsBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
});
btnContainer.appendChild(fsBtn);

document.addEventListener('fullscreenchange', () => {
  btnContainer.style.display = document.fullscreenElement ? 'none' : 'flex';
});

// Fly Tour
let flyActive = false;
let flyDistance = 0;
const flyBtn = document.createElement('button');
flyBtn.textContent = 'FLY';
flyBtn.style.cssText = btnStyle;
flyBtn.addEventListener('click', () => {
  flyActive = !flyActive;
  flyBtn.textContent = flyActive ? 'STOP' : 'FLY';
  flyBtn.style.background = flyActive ? '#c62828' : '#333';

  if (flyActive) {
    // Capture current position and heading
    flyStartECEF.copy(camera.position).normalize().multiplyScalar(earthRadius);
    flyAltitude = camera.position.length() - earthRadius;
    if (flyAltitude < 200) flyAltitude = 200;
    flyDistance = 0;

    // Build local frame at camera position
    const up = flyStartECEF.clone().normalize();
    const tempEast = new THREE.Vector3(0, 1, 0).cross(up).normalize();
    if (tempEast.length() < 0.01) tempEast.set(1, 0, 0).cross(up).normalize();
    const tempNorth = up.clone().cross(tempEast).normalize();

    // Get camera forward direction projected onto surface tangent plane
    const camFwd = new THREE.Vector3();
    camera.getWorldDirection(camFwd);
    // Remove the up component to get horizontal heading
    camFwd.addScaledVector(up, -camFwd.dot(up)).normalize();

    flyDirection.copy(camFwd);
    flyUp.copy(up);

    controls.enabled = false;
  } else {
    controls.enabled = true;
  }
});
btnContainer.appendChild(flyBtn);

// Fly state
const earthRadius = 6_378_137;
const flyStartECEF = new THREE.Vector3();
const flyDirection = new THREE.Vector3();
const flyUp = new THREE.Vector3();
let flyAltitude = 500;

function updateFlythrough() {
  if (!flyActive) return;

  // Fly forward along the terrain at constant altitude
  const speed = Math.max(flyAltitude * 0.3, 30); // meters per frame
  flyDistance += speed;

  // Move along the Earth surface in flyDirection
  // New surface point = rotate startPoint around Earth center by the angle traveled
  const angularDist = flyDistance / earthRadius; // radians traveled on surface

  // Great circle: new position on surface
  const surfacePoint = new THREE.Vector3()
    .copy(flyStartECEF)
    .multiplyScalar(Math.cos(angularDist))
    .addScaledVector(flyDirection, earthRadius * Math.sin(angularDist));

  // Lift to altitude
  const surfaceNormal = surfacePoint.clone().normalize();
  const camPos = surfaceNormal.clone().multiplyScalar(earthRadius + flyAltitude);
  camera.position.copy(camPos);

  // Look ahead: point further along the path, at ground level
  const lookAheadDist = (flyDistance + Math.max(flyAltitude * 3, 500)) / earthRadius;
  const lookSurface = new THREE.Vector3()
    .copy(flyStartECEF)
    .multiplyScalar(Math.cos(lookAheadDist))
    .addScaledVector(flyDirection, earthRadius * Math.sin(lookAheadDist));
  const lookNormal = lookSurface.clone().normalize();
  const lookPoint = lookNormal.multiplyScalar(earthRadius);

  camera.lookAt(lookPoint);

  // Keep camera level: set up vector to surface normal (no roll)
  camera.up.copy(surfaceNormal);
}

// --- Gamepad -> Synthetic pointer events for GlobeControls ---
// Quest 2 browser: thumbpress = scroll (zoom) already works natively.
// Thumbsticks: we simulate pointer drag events so GlobeControls responds.
//   Left stick  = left-click drag  (pan / orbit)
//   Right stick = right-click drag (tilt / rotate 3D view)
const canvas = renderer.domElement;
const canvasCx = () => window.innerWidth / 2;
const canvasCy = () => window.innerHeight / 2;

// Track simulated drag state for each stick
let leftDragging = false;
let rightDragging = false;
let leftPos = { x: 0, y: 0 };
let rightPos = { x: 0, y: 0 };

function firePointer(type: string, x: number, y: number, button: number) {
  const evt = new PointerEvent(type, {
    clientX: x,
    clientY: y,
    button,
    buttons: button === 0 ? 1 : 2,
    pointerId: button === 0 ? 100 : 101,
    pointerType: 'mouse',
    bubbles: true,
    cancelable: true,
  });
  canvas.dispatchEvent(evt);
}

function handleGamepadSticks() {
  const gamepads = navigator.getGamepads();
  for (const gp of gamepads) {
    if (!gp) continue;

    const axes = gp.axes;
    const dz = 0.15;

    // Standard gamepad: axes[0]=LX, axes[1]=LY, axes[2]=RX, axes[3]=RY
    const lx = Math.abs(axes[0]) > dz ? axes[0] : 0;
    const ly = Math.abs(axes[1]) > dz ? axes[1] : 0;
    const rx = Math.abs(axes[2]) > dz ? axes[2] : 0;
    const ry = Math.abs(axes[3]) > dz ? axes[3] : 0;

    const dragSpeed = 3;

    // --- Left stick -> left-click drag (pan/orbit) ---
    if (lx !== 0 || ly !== 0) {
      if (!leftDragging) {
        leftPos.x = canvasCx();
        leftPos.y = canvasCy();
        firePointer('pointerdown', leftPos.x, leftPos.y, 0);
        leftDragging = true;
      }
      leftPos.x += lx * dragSpeed;
      leftPos.y += ly * dragSpeed;
      firePointer('pointermove', leftPos.x, leftPos.y, 0);
    } else if (leftDragging) {
      firePointer('pointerup', leftPos.x, leftPos.y, 0);
      leftDragging = false;
    }

    // --- Right stick -> right-click drag (tilt/rotate) ---
    if (rx !== 0 || ry !== 0) {
      if (!rightDragging) {
        rightPos.x = canvasCx();
        rightPos.y = canvasCy();
        firePointer('pointerdown', rightPos.x, rightPos.y, 2);
        rightDragging = true;
      }
      rightPos.x += rx * dragSpeed;
      rightPos.y += ry * dragSpeed;
      firePointer('pointermove', rightPos.x, rightPos.y, 2);
    } else if (rightDragging) {
      firePointer('pointerup', rightPos.x, rightPos.y, 2);
      rightDragging = false;
    }
  }
}

// Prevent context menu from right-click simulation
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  tiles.setResolutionFromRenderer(camera, renderer);
});

// --- Render loop ---
renderer.setAnimationLoop(() => {
  handleGamepadSticks();
  updateFlythrough();
  controls.update();
  camera.updateMatrixWorld();
  tiles.update();
  renderer.render(scene, camera);
});
