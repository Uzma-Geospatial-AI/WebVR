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
renderer.setClearColor(0x000000);
document.body.appendChild(renderer.domElement);

// --- Scene ---
const scene = new THREE.Scene();

// --- Camera: start above 4.967290, 118.196778 (Sabah, Malaysia) ---
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1e8);
const startPos = new THREE.Vector3();
WGS84_ELLIPSOID.getCartographicToPosition(
  5.061014 * Math.PI / 180,   // lat in radians
  118.220144 * Math.PI / 180, // lon in radians
  500,                         // 500m above ground
  startPos
);
camera.position.copy(startPos);
camera.lookAt(0, 0, 0);

// --- Sky dome (gradient sky) ---
const skyGeo = new THREE.SphereGeometry(5e7, 32, 32);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    topColor: { value: new THREE.Color(0x4da6ff) },
    bottomColor: { value: new THREE.Color(0xd6ecff) },
    offset: { value: 0.0 },
    exponent: { value: 0.6 },
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
const sky = new THREE.Mesh(skyGeo, skyMat);
scene.add(sky);

// --- Lighting ---
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(1, 2, 1).normalize();
scene.add(dirLight);
const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x556b2f, 0.4);
scene.add(hemiLight);

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
  padding: 6px 14px; font-size: 12px; font-weight: bold;
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
let flyAngle = 0;
const flyBtn = document.createElement('button');
flyBtn.textContent = 'FLY';
flyBtn.style.cssText = btnStyle;
flyBtn.addEventListener('click', () => {
  flyActive = !flyActive;
  flyBtn.textContent = flyActive ? 'STOP' : 'FLY';
  flyBtn.style.background = flyActive ? '#c62828' : '#333';

  if (flyActive) {
    // Only calculate on first run, reuse on subsequent plays
    if (markerGroundPositions.length === 0) {
      // Capture current center point (where camera is looking at on surface)
      flyCenterECEF.copy(camera.position).normalize().multiplyScalar(earthRadius);
      flyAltitude = camera.position.length() - earthRadius;
      if (flyAltitude < 200) flyAltitude = 200;

      // Build local east/north frame at center
      const up = flyCenterECEF.clone().normalize();
      flyEast.set(0, 1, 0).cross(up).normalize();
      if (flyEast.length() < 0.01) flyEast.set(1, 0, 0).cross(up).normalize();
      flyNorth.copy(up).cross(flyEast).normalize();

      // Orbit radius: circle around the area (wider when higher)
      flyOrbitRadius = Math.max(flyAltitude * 4, 1000);

      // Place route markers along the orbit path
      placeRouteMarkers();

      // Pre-calculate all LOS viewsheds (heavy work done once)
      setTimeout(() => preCalculateAllLOS(), 500);
    }

    flyAngle = 0;
    lastLOSTriggerTime = 0;
    activeMarkerLOS = -1;
    clearAllLOS2();

    controls.enabled = false;
  } else {
    // Stop flying but keep all markers and LOS drawings
    controls.enabled = true;
  }
});
btnContainer.appendChild(flyBtn);

// Fly state
const earthRadius = 6_378_137;
const flyCenterECEF = new THREE.Vector3();
const flyEast = new THREE.Vector3();
const flyNorth = new THREE.Vector3();
let flyAltitude = 500;
let flyOrbitRadius = 2000;

// Route markers
const routeMarkers: THREE.Group[] = [];
const markerGroundPositions: THREE.Vector3[] = [];
let activeMarkerLOS = -1; // which marker currently has LOS shown
const markerLabels = ['A', 'B', 'C', 'D', 'E'];
const markerColors = [0x00ff44, 0x00ff44, 0xff2222, 0x00ff44, 0xff2222];

function clearRouteMarkers() {
  for (const m of routeMarkers) scene.remove(m);
  routeMarkers.length = 0;
  markerGroundPositions.length = 0;
  activeMarkerLOS = -1;
  clearAllLOS2();
}

function placeRouteMarkers() {
  clearRouteMarkers();

  const numMarkers = 5;
  const markerHeight = Math.max(flyAltitude * 0.15, 30);
  const pinRadius = Math.max(flyAltitude * 0.02, 4);

  // Random offsets to place markers inside the circle
  const randomOffsets = [0.35, 0.55, 0.25, 0.6, 0.4];
  const angleOffsets = [0.3, -0.2, 0.5, -0.4, 0.1];

  for (let i = 0; i < numMarkers; i++) {
    const angle = (i / numMarkers) * Math.PI * 2 + angleOffsets[i];

    // Position inside the orbit circle (not on the path)
    const inwardFactor = randomOffsets[i]; // 0-1, how far inside
    const offset = new THREE.Vector3()
      .addScaledVector(flyEast, Math.cos(angle) * flyOrbitRadius * inwardFactor)
      .addScaledVector(flyNorth, Math.sin(angle) * flyOrbitRadius * inwardFactor);
    const surfPoint = flyCenterECEF.clone().add(offset);
    const sNorm = surfPoint.clone().normalize();

    // Raycast down to find actual terrain surface
    const highPt = sNorm.clone().multiplyScalar(earthRadius + flyAltitude + 500);
    raycaster.set(highPt, sNorm.clone().negate());
    raycaster.far = 2000;
    (raycaster as any).firstHitOnly = true;
    const terrainHits = raycaster.intersectObject(tiles.group, true);
    // Try multiple raycasts from different heights to find terrain
    let groundPos: THREE.Vector3 | null = null;
    for (const extraH of [500, 1000, 200, 50]) {
      const hp = sNorm.clone().multiplyScalar(earthRadius + flyAltitude + extraH);
      raycaster.set(hp, sNorm.clone().negate());
      raycaster.far = 3000;
      (raycaster as any).firstHitOnly = true;
      const hits = raycaster.intersectObject(tiles.group, true);
      if (hits.length > 0) {
        groundPos = hits[0].point.clone();
        break;
      }
    }
    if (!groundPos) groundPos = sNorm.clone().multiplyScalar(earthRadius);

    // Sink 2m into ground so pole base is always below surface
    const anchoredPos = groundPos.clone().addScaledVector(sNorm, -2);

    const markerGroup = new THREE.Group();
    markerGroup.position.copy(anchoredPos);

    // Vertical pole (extra length to compensate for anchor)
    const poleLen = markerHeight + 4;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(pinRadius * 0.15, pinRadius * 0.15, poleLen, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
    );
    const poleQuat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), sNorm
    );
    pole.quaternion.copy(poleQuat);
    pole.position.copy(sNorm).multiplyScalar(poleLen / 2);
    markerGroup.add(pole);

    // Floating diamond at top (rotates)
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(pinRadius, 0),
      new THREE.MeshBasicMaterial({ color: markerColors[i], transparent: true, opacity: 0.9 })
    );
    diamond.position.copy(sNorm).multiplyScalar(markerHeight + pinRadius);
    diamond.name = 'diamond';
    markerGroup.add(diamond);

    // Ring around diamond (rotates opposite)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(pinRadius * 1.5, pinRadius * 0.2, 8, 24),
      new THREE.MeshBasicMaterial({ color: markerColors[i], transparent: true, opacity: 0.6 })
    );
    ring.position.copy(diamond.position);
    ring.name = 'ring';
    markerGroup.add(ring);

    // Label sprite
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 128;
    labelCanvas.height = 128;
    const ctx = labelCanvas.getContext('2d')!;
    // Black circle background
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    // Colored border
    ctx.strokeStyle = '#' + markerColors[i].toString(16).padStart(6, '0');
    ctx.lineWidth = 6;
    ctx.stroke();
    // White text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 72px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(markerLabels[i], 64, 66);

    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false })
    );
    label.position.copy(sNorm).multiplyScalar(markerHeight + pinRadius * 4);
    label.scale.setScalar(pinRadius * 3);
    markerGroup.add(label);

    // Store surface normal for rotation axis
    markerGroup.userData.surfaceNormal = sNorm.clone();

    scene.add(markerGroup);
    routeMarkers.push(markerGroup);
    markerGroundPositions.push(groundPos.clone());
  }
}

// Pre-calculated LOS data cache
interface LOSCache {
  greenVerts: Float32Array;
  redVerts: Float32Array;
  observer: THREE.Vector3;
  surfaceNormal: THREE.Vector3;
}
const losCache: LOSCache[] = [];
let losCacheReady = false;

function preCalculateAllLOS() {
  losCache.length = 0;
  losCacheReady = false;
  console.log('Pre-calculating LOS for all markers...');

  for (let i = 0; i < markerGroundPositions.length; i++) {
    console.log(`  Calculating LOS ${i + 1}/${markerGroundPositions.length}...`);
    const data = calculateLOSData(markerGroundPositions[i]);
    losCache.push(data);
  }

  losCacheReady = true;
  console.log('LOS pre-calculation complete.');
}

function calculateLOSData(observerPos: THREE.Vector3): LOSCache {
  const surfaceNormal = observerPos.clone().normalize();
  const observer = observerPos.clone().addScaledVector(surfaceNormal, 2);

  const up = surfaceNormal.clone();
  const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
  if (east.length() < 0.01) east.set(1, 0, 0).cross(up).normalize();
  const north = up.clone().cross(east).normalize();

  const viewshedRadius = 400;
  const hSegments = 120;
  const rSegments = 40;

  const getHDir = (hIdx: number) => {
    const a = (hIdx / hSegments) * Math.PI * 2;
    return new THREE.Vector3()
      .addScaledVector(east, Math.cos(a))
      .addScaledVector(north, Math.sin(a)).normalize();
  };

  const findTerrain = (dir: THREE.Vector3, dist: number): THREE.Vector3 => {
    const ang = dist / earthRadius;
    const sp = observerPos.clone()
      .multiplyScalar(Math.cos(ang))
      .addScaledVector(dir, earthRadius * Math.sin(ang));
    const sn = sp.clone().normalize();
    const hp = sn.clone().multiplyScalar(observerPos.length() + 500);
    raycaster.set(hp, sn.clone().negate());
    raycaster.far = 2000;
    (raycaster as any).firstHitOnly = true;
    const h = raycaster.intersectObject(tiles.group, true);
    if (h.length > 0) return h[0].point.clone().addScaledVector(sn, 15);
    return sn.multiplyScalar(observerPos.length() + 15);
  };

  // Build terrain grid
  const terrainGrid: THREE.Vector3[][] = [];
  for (let h = 0; h <= hSegments; h++) {
    terrainGrid[h] = [];
    const dir = getHDir(h % hSegments);
    for (let r = 0; r <= rSegments; r++) {
      if (r === 0) {
        terrainGrid[h][0] = observerPos.clone().addScaledVector(surfaceNormal, 2);
      } else {
        terrainGrid[h][r] = findTerrain(dir, (r / rSegments) * viewshedRadius);
      }
    }
  }

  const greenVerts: number[] = [];
  const redVerts: number[] = [];

  for (let h = 0; h < hSegments; h++) {
    const hDirMid = getHDir(h + 0.5);
    for (let r = 0; r < rSegments; r++) {
      const distMid = ((r + 0.5) / rSegments) * viewshedRadius;

      let isVisible = true;
      if (distMid > 3) {
        const terrainMid = findTerrain(hDirMid, distMid);
        const toTerrain = terrainMid.clone().sub(observer);
        const losDir = toTerrain.clone().normalize();
        const losDist = toTerrain.length();

        raycaster.set(observer, losDir);
        raycaster.far = losDist + 5;
        (raycaster as any).firstHitOnly = true;
        const losHits = raycaster.intersectObject(tiles.group, true);
        if (losHits.length > 0 && losHits[0].distance < losDist * 0.9) {
          isVisible = false;
        }
      }

      const p00 = terrainGrid[h][r];
      const p10 = terrainGrid[h + 1][r];
      const p01 = terrainGrid[h][r + 1];
      const p11 = terrainGrid[h + 1][r + 1];

      const target = isVisible ? greenVerts : redVerts;
      target.push(
        p00.x, p00.y, p00.z, p10.x, p10.y, p10.z, p11.x, p11.y, p11.z,
        p00.x, p00.y, p00.z, p11.x, p11.y, p11.z, p01.x, p01.y, p01.z,
      );
    }
  }

  return {
    greenVerts: new Float32Array(greenVerts),
    redVerts: new Float32Array(redVerts),
    observer: observer.clone(),
    surfaceNormal: surfaceNormal.clone(),
  };
}

// Draw LOS from cached data (instant, no raycasting)
function drawCachedLOS(cache: LOSCache) {
  const group = new THREE.Group();
  const viewshedRadius = 400;

  if (cache.greenVerts.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(cache.greenVerts, 3));
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x00ff44, transparent: true, opacity: 0.4,
      side: THREE.DoubleSide, depthWrite: false,
    })));
  }

  if (cache.redVerts.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(cache.redVerts, 3));
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xff2222, transparent: true, opacity: 0.4,
      side: THREE.DoubleSide, depthWrite: false,
    })));
  }

  // White dome
  const domeGeo = new THREE.SphereGeometry(viewshedRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const domeMesh = new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.08,
    side: THREE.DoubleSide, depthWrite: false,
  }));
  domeMesh.position.copy(cache.observer);
  const domeQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), cache.surfaceNormal
  );
  domeMesh.quaternion.copy(domeQuat);
  group.add(domeMesh);

  // Ring
  const ringMesh = new THREE.Mesh(
    new THREE.TorusGeometry(viewshedRadius, 1.5, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 })
  );
  ringMesh.position.copy(cache.observer);
  ringMesh.quaternion.copy(domeQuat);
  group.add(ringMesh);

  // Marker
  const markerSize = 3;
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(markerSize, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffff00 })
  );
  marker.position.copy(cache.observer);
  group.add(marker);

  scene.add(group);
  los2AllDomes.push(group);
}

// Timer-based LOS drawing from cache
let lastLOSTriggerTime = 0;
const LOS_INTERVAL = 12000;

function checkMarkerTiming() {
  if (!flyActive || !losCacheReady || losCache.length === 0) return;

  const now = Date.now();
  if (lastLOSTriggerTime === 0) lastLOSTriggerTime = now;

  const elapsed = now - lastLOSTriggerTime;
  const nextIdx = (activeMarkerLOS + 1) % losCache.length;

  if (elapsed >= LOS_INTERVAL || activeMarkerLOS === -1) {
    const newIdx = activeMarkerLOS === -1 ? 0 : nextIdx;

    if (newIdx === 0 && activeMarkerLOS > 0) {
      clearAllLOS2();
    }

    activeMarkerLOS = newIdx;
    lastLOSTriggerTime = now;
    drawCachedLOS(losCache[activeMarkerLOS]); // instant draw from cache
  }
}

function updateRouteMarkers() {
  const time = Date.now() * 0.001;
  for (const group of routeMarkers) {
    const sNorm = group.userData.surfaceNormal as THREE.Vector3;
    for (const child of group.children) {
      if (child.name === 'diamond') {
        // Rotate diamond around surface normal + bob up/down
        child.rotateOnWorldAxis(sNorm, 0.02);
        const bob = Math.sin(time * 2 + group.id) * 0.5;
        child.position.copy(sNorm).multiplyScalar(
          Math.max(flyAltitude * 0.15, 30) + Math.max(flyAltitude * 0.02, 4) + bob
        );
      }
      if (child.name === 'ring') {
        child.rotateOnWorldAxis(sNorm, -0.03);
      }
    }
  }
}

function updateFlythrough() {
  if (!flyActive) return;

  // Slow orbit: ~60 seconds for a full circle
  flyAngle += 0.0008;

  // Camera orbits around the center point on the surface
  const offset = new THREE.Vector3()
    .addScaledVector(flyEast, Math.cos(flyAngle) * flyOrbitRadius)
    .addScaledVector(flyNorth, Math.sin(flyAngle) * flyOrbitRadius);

  const orbitSurface = flyCenterECEF.clone().add(offset);
  const surfaceNormal = orbitSurface.clone().normalize();
  camera.position.copy(surfaceNormal).multiplyScalar(earthRadius + flyAltitude);

  // Always look at the center point on the ground
  camera.lookAt(flyCenterECEF);

  // Keep camera level
  camera.up.copy(surfaceNormal);
}

// LOS objects (unused now, kept for potential manual mode)
let losMarker: THREE.Mesh | null = null;
let losLines: THREE.Group | null = null;
const losMode = false; // disabled - auto LOS at markers now
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function clearLOS() {
  if (losMarker) { scene.remove(losMarker); losMarker = null; }
  if (losLines) { scene.remove(losLines); losLines = null; }
}

// performLOS removed - using auto LOS 2 at markers instead

// --- LOS 2: Terrain viewshed (auto-triggered at markers) ---
let los2Dome: THREE.Group | null = null;
const los2AllDomes: THREE.Group[] = []; // keep all drawn LOS until loop resets

function clearLOS2() {
  if (los2Dome) { scene.remove(los2Dome); los2Dome = null; }
}

function clearAllLOS2() {
  for (const d of los2AllDomes) scene.remove(d);
  los2AllDomes.length = 0;
  los2Dome = null;
}

function performLOS2(observerPos: THREE.Vector3) {
  // Don't clear previous - accumulate all LOS until loop resets

  const surfaceNormal = observerPos.clone().normalize();
  const observer = observerPos.clone().addScaledVector(surfaceNormal, 2);

  const up = surfaceNormal.clone();
  const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
  if (east.length() < 0.01) east.set(1, 0, 0).cross(up).normalize();
  const north = up.clone().cross(east).normalize();

  const viewshedRadius = 400;
  const hSegments = 120;  // every 3 degrees
  const rSegments = 40;   // every 10m

  los2Dome = new THREE.Group();

  // Pre-compute terrain grid points (cache to avoid redundant raycasts)
  // Grid: [h][r] where h=0..hSegments, r=0..rSegments
  const terrainGrid: THREE.Vector3[][] = [];

  const getHDir = (hIdx: number) => {
    const a = (hIdx / hSegments) * Math.PI * 2;
    return new THREE.Vector3()
      .addScaledVector(east, Math.cos(a))
      .addScaledVector(north, Math.sin(a)).normalize();
  };

  const findTerrainPoint = (dir: THREE.Vector3, dist: number): THREE.Vector3 => {
    const ang = dist / earthRadius;
    const sp = observerPos.clone()
      .multiplyScalar(Math.cos(ang))
      .addScaledVector(dir, earthRadius * Math.sin(ang));
    const sn = sp.clone().normalize();
    const hp = sn.clone().multiplyScalar(observerPos.length() + 500);
    raycaster.set(hp, sn.clone().negate());
    raycaster.far = 2000;
    (raycaster as any).firstHitOnly = true;
    const h = raycaster.intersectObject(tiles.group, true);
    if (h.length > 0) return h[0].point.clone().addScaledVector(sn, 15);
    return sn.multiplyScalar(observerPos.length() + 15);
  };

  // Build terrain grid
  for (let h = 0; h <= hSegments; h++) {
    terrainGrid[h] = [];
    const dir = getHDir(h % hSegments);
    for (let r = 0; r <= rSegments; r++) {
      const dist = (r / rSegments) * viewshedRadius;
      if (r === 0) {
        // Center point (same for all h)
        terrainGrid[h][0] = observerPos.clone().addScaledVector(surfaceNormal, 2);
      } else {
        terrainGrid[h][r] = findTerrainPoint(dir, dist);
      }
    }
  }

  // Check LOS for each cell center and build mesh
  const greenVerts: number[] = [];
  const redVerts: number[] = [];

  for (let h = 0; h < hSegments; h++) {
    const hDirMid = getHDir(h + 0.5);

    for (let r = 0; r < rSegments; r++) {
      const distMid = ((r + 0.5) / rSegments) * viewshedRadius;

      // LOS check at cell center
      let isVisible = true;
      if (distMid > 3) {
        const terrainMid = findTerrainPoint(hDirMid, distMid);
        const toTerrain = terrainMid.clone().sub(observer);
        const losDir = toTerrain.clone().normalize();
        const losDist = toTerrain.length();

        raycaster.set(observer, losDir);
        raycaster.far = losDist + 5;
        (raycaster as any).firstHitOnly = true;
        const losHits = raycaster.intersectObject(tiles.group, true);

        if (losHits.length > 0 && losHits[0].distance < losDist * 0.9) {
          isVisible = false;
        }
      }

      const p00 = terrainGrid[h][r];
      const p10 = terrainGrid[h + 1][r];
      const p01 = terrainGrid[h][r + 1];
      const p11 = terrainGrid[h + 1][r + 1];

      const target = isVisible ? greenVerts : redVerts;
      target.push(
        p00.x, p00.y, p00.z, p10.x, p10.y, p10.z, p11.x, p11.y, p11.z,
        p00.x, p00.y, p00.z, p11.x, p11.y, p11.z, p01.x, p01.y, p01.z,
      );
    }
  }

  // Green terrain overlay (visible)
  if (greenVerts.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(greenVerts), 3));
    geo.computeVertexNormals();
    los2Dome.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x00ff44, transparent: true, opacity: 0.4,
      side: THREE.DoubleSide, depthWrite: false,
    })));
  }

  // Red terrain overlay (blocked)
  if (redVerts.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(redVerts), 3));
    geo.computeVertexNormals();
    los2Dome.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xff2222, transparent: true, opacity: 0.4,
      side: THREE.DoubleSide, depthWrite: false,
    })));
  }

  // Observer marker
  const markerSize = Math.max(camera.position.distanceTo(observer) * 0.003, 1.5);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(markerSize, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffff00 })
  );
  marker.position.copy(observer);
  los2Dome.add(marker);

  // White transparent dome over the viewshed
  const domeGeo = new THREE.SphereGeometry(viewshedRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const domeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const domeMesh = new THREE.Mesh(domeGeo, domeMat);
  // Position at observer and orient up along surface normal
  domeMesh.position.copy(observer);
  const domeQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), surfaceNormal
  );
  domeMesh.quaternion.copy(domeQuat);
  los2Dome.add(domeMesh);

  // Dome edge ring for visibility
  const ringGeo = new THREE.TorusGeometry(viewshedRadius, 1.5, 8, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.25,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.position.copy(observer);
  ringMesh.quaternion.copy(domeQuat);
  los2Dome.add(ringMesh);

  scene.add(los2Dome);
  los2AllDomes.push(los2Dome);
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

// LOS click handler removed - auto-triggered at markers during fly

// --- Auto-start fly after tiles load ---
let flyStarted = false;
tiles.addEventListener('load-tile-set' as any, () => {
  if (!flyStarted) {
    flyStarted = true;
    // Wait for some tiles to render before starting fly
    setTimeout(() => {
      flyBtn.click();
    }, 3000);
  }
});

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
  updateRouteMarkers();
  checkMarkerTiming();
  controls.update();
  camera.updateMatrixWorld();
  tiles.update();
  renderer.render(scene, camera);
});
