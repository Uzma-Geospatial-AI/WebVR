import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
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

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN as string;

// ─── RENDERER ────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// VR Button — shows "ENTER VR" on Quest browser
document.body.appendChild(VRButton.createButton(renderer));

// ─── SCENE ───────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();

// ─── CAMERA — start above Sabah, Malaysia ────────────────────────────────────
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  1,
  1e8
);
const startPos = new THREE.Vector3();
WGS84_ELLIPSOID.getCartographicToPosition(
  5.061014  * (Math.PI / 180),
  118.220144 * (Math.PI / 180),
  500,
  startPos
);
camera.position.copy(startPos);
camera.lookAt(0, 0, 0);

// XR rig — needed so VR head tracking works correctly
const cameraRig = new THREE.Group();
cameraRig.add(camera);
scene.add(cameraRig);

// ─── SKY DOME ────────────────────────────────────────────────────────────────
const skyGeo = new THREE.SphereGeometry(5e7, 32, 32);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    topColor:    { value: new THREE.Color(0x4da6ff) },
    bottomColor: { value: new THREE.Color(0xd6ecff) },
    offset:      { value: 0.0 },
    exponent:    { value: 0.6 },
  },
  vertexShader: `
    varying vec3 vWorldPosition;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 topColor;
    uniform vec3 bottomColor;
    uniform float offset;
    uniform float exponent;
    varying vec3 vWorldPosition;
    void main() {
      vec3 dir = normalize(vWorldPosition);
      float h = max(dot(dir, normalize(vWorldPosition)) * 0.5 + 0.5 + offset, 0.0);
      gl_FragColor = vec4(mix(bottomColor, topColor, pow(h, exponent)), 1.0);
    }
  `,
});
scene.add(new THREE.Mesh(skyGeo, skyMat));

// ─── LIGHTING ────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(1, 2, 1).normalize();
scene.add(dirLight);
scene.add(new THREE.HemisphereLight(0x87ceeb, 0x556b2f, 0.4));

// ─── 3D TILES ────────────────────────────────────────────────────────────────
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

// ─── GLOBE CONTROLS (mouse / touch / desktop) ────────────────────────────────
const controls = new GlobeControls(scene, camera, renderer.domElement, tiles);

// ─── UI BUTTONS ──────────────────────────────────────────────────────────────
const btnStyle = `
  padding: 8px 18px; font-size: 13px; font-weight: bold;
  background: rgba(0,0,0,0.7); color: #fff;
  border: 1px solid rgba(255,255,255,0.4);
  border-radius: 6px; cursor: pointer; backdrop-filter: blur(4px);
`;

const btnContainer = document.createElement('div');
btnContainer.style.cssText = `
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 12px; z-index: 999;
`;
document.body.appendChild(btnContainer);

// Fullscreen
const fsBtn = document.createElement('button');
fsBtn.textContent = 'FULLSCREEN';
fsBtn.style.cssText = btnStyle;
fsBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
});
btnContainer.appendChild(fsBtn);

document.addEventListener('fullscreenchange', () => {
  btnContainer.style.display = document.fullscreenElement ? 'none' : 'flex';
});

// Fly Tour
let flyActive = false;
let flyAngle  = 0;

const flyBtn = document.createElement('button');
flyBtn.textContent = 'FLY TOUR';
flyBtn.style.cssText = btnStyle;
flyBtn.addEventListener('click', () => {
  flyActive = !flyActive;
  flyBtn.textContent = flyActive ? 'STOP' : 'FLY TOUR';
  flyBtn.style.background = flyActive ? 'rgba(198,40,40,0.85)' : 'rgba(0,0,0,0.7)';

  if (flyActive) {
    if (markerGroundPositions.length === 0) {
      flyCenterECEF.copy(camera.position).normalize().multiplyScalar(earthRadius);
      flyAltitude = Math.max(camera.position.length() - earthRadius, 200);

      const up = flyCenterECEF.clone().normalize();
      flyEast.set(0, 1, 0).cross(up).normalize();
      if (flyEast.length() < 0.01) flyEast.set(1, 0, 0).cross(up).normalize();
      flyNorth.copy(up).cross(flyEast).normalize();

      flyOrbitRadius = Math.max(flyAltitude * 4, 1000);
      placeRouteMarkers();
      setTimeout(() => preCalculateAllLOS(), 500);
    }

    flyAngle = 0;
    lastLOSTriggerTime = 0;
    activeMarkerLOS = -1;
    clearAllLOS();
    controls.enabled = false;
  } else {
    controls.enabled = true;
  }
});
btnContainer.appendChild(flyBtn);

// ─── FLY STATE ───────────────────────────────────────────────────────────────
const earthRadius  = 6_378_137;
const flyCenterECEF = new THREE.Vector3();
const flyEast       = new THREE.Vector3();
const flyNorth      = new THREE.Vector3();
let flyAltitude     = 500;
let flyOrbitRadius  = 2000;

// ─── ROUTE MARKERS ───────────────────────────────────────────────────────────
const routeMarkers:         THREE.Group[]   = [];
const markerGroundPositions: THREE.Vector3[] = [];
let activeMarkerLOS = -1;
const markerLabels = ['A', 'B', 'C', 'D', 'E'];
const markerColors = [0x00ff44, 0x00ff44, 0xff2222, 0x00ff44, 0xff2222];
const raycaster    = new THREE.Raycaster();

function clearRouteMarkers() {
  for (const m of routeMarkers) scene.remove(m);
  routeMarkers.length = 0;
  markerGroundPositions.length = 0;
  activeMarkerLOS = -1;
  clearAllLOS();
}

function placeRouteMarkers() {
  clearRouteMarkers();

  const numMarkers    = 5;
  const markerHeight  = Math.max(flyAltitude * 0.15, 30);
  const pinRadius     = Math.max(flyAltitude * 0.02, 4);
  const randomOffsets = [0.35, 0.55, 0.25, 0.6, 0.4];
  const angleOffsets  = [0.3, -0.2, 0.5, -0.4, 0.1];

  for (let i = 0; i < numMarkers; i++) {
    const angle  = (i / numMarkers) * Math.PI * 2 + angleOffsets[i];
    const inward = randomOffsets[i];
    const offset = new THREE.Vector3()
      .addScaledVector(flyEast,  Math.cos(angle) * flyOrbitRadius * inward)
      .addScaledVector(flyNorth, Math.sin(angle) * flyOrbitRadius * inward);

    const surfPoint = flyCenterECEF.clone().add(offset);
    const sNorm     = surfPoint.clone().normalize();

    let groundPos: THREE.Vector3 | null = null;
    for (const extraH of [500, 1000, 200, 50]) {
      const hp = sNorm.clone().multiplyScalar(earthRadius + flyAltitude + extraH);
      raycaster.set(hp, sNorm.clone().negate());
      raycaster.far = 3000;
      (raycaster as any).firstHitOnly = true;
      const hits = raycaster.intersectObject(tiles.group, true);
      if (hits.length > 0) { groundPos = hits[0].point.clone(); break; }
    }
    if (!groundPos) groundPos = sNorm.clone().multiplyScalar(earthRadius);

    const markerGroup = new THREE.Group();
    markerGroup.position.copy(groundPos.clone().addScaledVector(sNorm, -2));

    // Pole
    const poleLen = markerHeight + 4;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(pinRadius * 0.15, pinRadius * 0.15, poleLen, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
    );
    pole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sNorm);
    pole.position.copy(sNorm).multiplyScalar(poleLen / 2);
    markerGroup.add(pole);

    // Diamond
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(pinRadius, 0),
      new THREE.MeshBasicMaterial({ color: markerColors[i], transparent: true, opacity: 0.9 })
    );
    diamond.position.copy(sNorm).multiplyScalar(markerHeight + pinRadius);
    diamond.name = 'diamond';
    markerGroup.add(diamond);

    // Ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(pinRadius * 1.5, pinRadius * 0.2, 8, 24),
      new THREE.MeshBasicMaterial({ color: markerColors[i], transparent: true, opacity: 0.6 })
    );
    ring.position.copy(diamond.position);
    ring.name = 'ring';
    markerGroup.add(ring);

    // Label sprite
    const lc  = document.createElement('canvas');
    lc.width  = lc.height = 128;
    const ctx = lc.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(64, 64, 60, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#' + markerColors[i].toString(16).padStart(6, '0');
    ctx.lineWidth = 6; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 72px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(markerLabels[i], 64, 66);

    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(lc), transparent: true, depthTest: false })
    );
    label.position.copy(sNorm).multiplyScalar(markerHeight + pinRadius * 4);
    label.scale.setScalar(pinRadius * 3);
    markerGroup.add(label);

    markerGroup.userData.surfaceNormal = sNorm.clone();
    scene.add(markerGroup);
    routeMarkers.push(markerGroup);
    markerGroundPositions.push(groundPos.clone());
  }
}

// ─── LOS VIEWSHED ────────────────────────────────────────────────────────────
interface LOSCache {
  greenVerts:    Float32Array;
  redVerts:      Float32Array;
  observer:      THREE.Vector3;
  surfaceNormal: THREE.Vector3;
}

const losCache:   LOSCache[]      = [];
let losCacheReady                  = false;
const losObjects: THREE.Group[]   = [];
let lastLOSTriggerTime             = 0;
const LOS_INTERVAL                 = 12000;

function clearAllLOS() {
  for (const d of losObjects) scene.remove(d);
  losObjects.length = 0;
}

function preCalculateAllLOS() {
  losCache.length = 0;
  losCacheReady   = false;
  for (let i = 0; i < markerGroundPositions.length; i++) {
    losCache.push(calculateLOSData(markerGroundPositions[i]));
  }
  losCacheReady = true;
}

function calculateLOSData(observerPos: THREE.Vector3): LOSCache {
  const surfaceNormal = observerPos.clone().normalize();
  const observer      = observerPos.clone().addScaledVector(surfaceNormal, 2);
  const up            = surfaceNormal.clone();
  const east          = new THREE.Vector3(0, 1, 0).cross(up).normalize();
  if (east.length() < 0.01) east.set(1, 0, 0).cross(up).normalize();
  const north         = up.clone().cross(east).normalize();

  const viewshedRadius = 400;
  const hSegments      = 120;
  const rSegments      = 40;

  const getHDir = (hIdx: number) => {
    const a = (hIdx / hSegments) * Math.PI * 2;
    return new THREE.Vector3()
      .addScaledVector(east,  Math.cos(a))
      .addScaledVector(north, Math.sin(a)).normalize();
  };

  const findTerrain = (dir: THREE.Vector3, dist: number): THREE.Vector3 => {
    const ang = dist / earthRadius;
    const sp  = observerPos.clone().multiplyScalar(Math.cos(ang))
      .addScaledVector(dir, earthRadius * Math.sin(ang));
    const sn  = sp.clone().normalize();
    const hp  = sn.clone().multiplyScalar(observerPos.length() + 500);
    raycaster.set(hp, sn.clone().negate());
    raycaster.far = 2000;
    (raycaster as any).firstHitOnly = true;
    const h = raycaster.intersectObject(tiles.group, true);
    if (h.length > 0) return h[0].point.clone().addScaledVector(sn, 15);
    return sn.multiplyScalar(observerPos.length() + 15);
  };

  const terrainGrid: THREE.Vector3[][] = [];
  for (let h = 0; h <= hSegments; h++) {
    terrainGrid[h] = [];
    const dir = getHDir(h % hSegments);
    for (let r = 0; r <= rSegments; r++) {
      terrainGrid[h][r] = r === 0
        ? observerPos.clone().addScaledVector(surfaceNormal, 2)
        : findTerrain(dir, (r / rSegments) * viewshedRadius);
    }
  }

  const greenVerts: number[] = [];
  const redVerts:   number[] = [];

  for (let h = 0; h < hSegments; h++) {
    const hDirMid = getHDir(h + 0.5);
    for (let r = 0; r < rSegments; r++) {
      const distMid = ((r + 0.5) / rSegments) * viewshedRadius;
      let isVisible = true;

      if (distMid > 3) {
        const terrainMid = findTerrain(hDirMid, distMid);
        const toTerrain  = terrainMid.clone().sub(observer);
        const losDir     = toTerrain.clone().normalize();
        const losDist    = toTerrain.length();
        raycaster.set(observer, losDir);
        raycaster.far = losDist + 5;
        (raycaster as any).firstHitOnly = true;
        const hits = raycaster.intersectObject(tiles.group, true);
        if (hits.length > 0 && hits[0].distance < losDist * 0.9) isVisible = false;
      }

      const p00 = terrainGrid[h][r];
      const p10 = terrainGrid[h + 1][r];
      const p01 = terrainGrid[h][r + 1];
      const p11 = terrainGrid[h + 1][r + 1];
      const tgt = isVisible ? greenVerts : redVerts;
      tgt.push(
        p00.x, p00.y, p00.z, p10.x, p10.y, p10.z, p11.x, p11.y, p11.z,
        p00.x, p00.y, p00.z, p11.x, p11.y, p11.z, p01.x, p01.y, p01.z,
      );
    }
  }

  return {
    greenVerts: new Float32Array(greenVerts),
    redVerts:   new Float32Array(redVerts),
    observer:   observer.clone(),
    surfaceNormal: surfaceNormal.clone(),
  };
}

function drawCachedLOS(cache: LOSCache) {
  const group          = new THREE.Group();
  const viewshedRadius = 400;

  const makeMesh = (verts: Float32Array, color: number) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.4,
      side: THREE.DoubleSide, depthWrite: false,
    }));
  };

  if (cache.greenVerts.length > 0) group.add(makeMesh(cache.greenVerts, 0x00ff44));
  if (cache.redVerts.length   > 0) group.add(makeMesh(cache.redVerts,   0xff2222));

  const domeQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), cache.surfaceNormal
  );

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(viewshedRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false })
  );
  dome.position.copy(cache.observer);
  dome.quaternion.copy(domeQuat);
  group.add(dome);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(viewshedRadius, 1.5, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 })
  );
  ring.position.copy(cache.observer);
  ring.quaternion.copy(domeQuat);
  group.add(ring);

  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(3, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffff00 })
  );
  dot.position.copy(cache.observer);
  group.add(dot);

  scene.add(group);
  losObjects.push(group);
}

function checkMarkerTiming() {
  if (!flyActive || !losCacheReady || losCache.length === 0) return;
  const now = Date.now();
  if (lastLOSTriggerTime === 0) lastLOSTriggerTime = now;

  const elapsed = now - lastLOSTriggerTime;
  const nextIdx = (activeMarkerLOS + 1) % losCache.length;

  if (elapsed >= LOS_INTERVAL || activeMarkerLOS === -1) {
    const newIdx = activeMarkerLOS === -1 ? 0 : nextIdx;
    if (newIdx === 0 && activeMarkerLOS > 0) clearAllLOS();
    activeMarkerLOS    = newIdx;
    lastLOSTriggerTime = now;
    drawCachedLOS(losCache[activeMarkerLOS]);
  }
}

function updateRouteMarkers() {
  const time = Date.now() * 0.001;
  for (const group of routeMarkers) {
    const sNorm = group.userData.surfaceNormal as THREE.Vector3;
    for (const child of group.children) {
      if (child.name === 'diamond') {
        child.rotateOnWorldAxis(sNorm, 0.02);
        const bob = Math.sin(time * 2 + group.id) * 0.5;
        child.position.copy(sNorm).multiplyScalar(
          Math.max(flyAltitude * 0.15, 30) + Math.max(flyAltitude * 0.02, 4) + bob
        );
      }
      if (child.name === 'ring') child.rotateOnWorldAxis(sNorm, -0.03);
    }
  }
}

function updateFlythrough() {
  if (!flyActive) return;
  flyAngle += 0.0008;

  const offset = new THREE.Vector3()
    .addScaledVector(flyEast,  Math.cos(flyAngle) * flyOrbitRadius)
    .addScaledVector(flyNorth, Math.sin(flyAngle) * flyOrbitRadius);

  const surfaceNormal = flyCenterECEF.clone().add(offset).normalize();
  camera.position.copy(surfaceNormal).multiplyScalar(earthRadius + flyAltitude);
  camera.lookAt(flyCenterECEF);
  camera.up.copy(surfaceNormal);
}

// ─── GAMEPAD → GlobeControls (Quest 2 thumbsticks on desktop mode) ────────────
const canvas = renderer.domElement;
let leftDragging  = false;
let rightDragging = false;
let leftPos  = { x: 0, y: 0 };
let rightPos = { x: 0, y: 0 };

function firePointer(type: string, x: number, y: number, button: number) {
  canvas.dispatchEvent(new PointerEvent(type, {
    clientX: x, clientY: y, button,
    buttons: button === 0 ? 1 : 2,
    pointerId: button === 0 ? 100 : 101,
    pointerType: 'mouse', bubbles: true, cancelable: true,
  }));
}

function handleGamepadSticks() {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const dz = 0.15;
  const ds = 3;

  for (const gp of navigator.getGamepads()) {
    if (!gp) continue;
    const ax = gp.axes;
    const lx = Math.abs(ax[0]) > dz ? ax[0] : 0;
    const ly = Math.abs(ax[1]) > dz ? ax[1] : 0;
    const rx = Math.abs(ax[2]) > dz ? ax[2] : 0;
    const ry = Math.abs(ax[3]) > dz ? ax[3] : 0;

    if (lx !== 0 || ly !== 0) {
      if (!leftDragging) { leftPos = { x: cx, y: cy }; firePointer('pointerdown', cx, cy, 0); leftDragging = true; }
      leftPos.x += lx * ds; leftPos.y += ly * ds;
      firePointer('pointermove', leftPos.x, leftPos.y, 0);
    } else if (leftDragging) {
      firePointer('pointerup', leftPos.x, leftPos.y, 0); leftDragging = false;
    }

    if (rx !== 0 || ry !== 0) {
      if (!rightDragging) { rightPos = { x: cx, y: cy }; firePointer('pointerdown', cx, cy, 2); rightDragging = true; }
      rightPos.x += rx * ds; rightPos.y += ry * ds;
      firePointer('pointermove', rightPos.x, rightPos.y, 2);
    } else if (rightDragging) {
      firePointer('pointerup', rightPos.x, rightPos.y, 2); rightDragging = false;
    }
  }
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ─── VR THUMBSTICK FLIGHT (WebXR session) ────────────────────────────────────
let vrSpeed = 10_000;
const _move  = new THREE.Vector3();
const _timer = new THREE.Timer();

function handleVRControllers() {
  const session = renderer.xr.getSession();
  if (!session) return;

  _timer.update();
  const delta = _timer.getDelta();

  for (const source of session.inputSources) {
    const gp = source.gamepad;
    if (!gp) continue;
    const axes = gp.axes;

    if (source.handedness === 'left') {
      const panX = axes[2] ?? 0;
      const panY = axes[3] ?? 0;
      if (Math.abs(panX) > 0.1 || Math.abs(panY) > 0.1) {
        cameraRig.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -panX * delta * 0.5);
        cameraRig.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0),  panY * delta * 0.5);
      }
    }

    if (source.handedness === 'right') {
      const zoomY = axes[3] ?? 0;
      if (Math.abs(zoomY) > 0.1) {
        camera.getWorldDirection(_move);
        _move.multiplyScalar(-zoomY * vrSpeed * delta);
        cameraRig.position.add(_move);
        vrSpeed = Math.max(100, cameraRig.position.length() * 0.05);
      }
    }
  }
}

// ─── AUTO-START FLY after tiles load ─────────────────────────────────────────
let flyStarted = false;
tiles.addEventListener('load-tile-set' as any, () => {
  if (!flyStarted) {
    flyStarted = true;
    setTimeout(() => flyBtn.click(), 3000);
  }
});

// ─── RESIZE ──────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  tiles.setResolutionFromRenderer(camera, renderer);
});

// ─── RENDER LOOP ─────────────────────────────────────────────────────────────
renderer.setAnimationLoop(() => {
  handleGamepadSticks();
  handleVRControllers();
  updateFlythrough();
  updateRouteMarkers();
  checkMarkerTiming();
  controls.update();
  camera.updateMatrixWorld();
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.update();
  renderer.render(scene, camera);
});