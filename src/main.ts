import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // sky blue

// --- Camera ---
const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  10000
);
camera.position.set(0, 1.6, 3); // eye height

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

// --- Placeholder: spinning cube (will be replaced with 3D Tiles) ---
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0x00b4d8 });
const cube = new THREE.Mesh(geometry, material);
cube.position.set(0, 1, -2);
scene.add(cube);

// --- Ground plane ---
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.MeshStandardMaterial({ color: 0x556b2f })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// --- Handle resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Render loop (WebXR-compatible) ---
renderer.setAnimationLoop((_time, frame) => {
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;

  // When in XR, Three.js handles stereo cameras automatically
  if (frame) {
    // XR frame - could read controller input here later
  }

  renderer.render(scene, camera);
});
