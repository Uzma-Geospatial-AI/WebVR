/**
 * Official NASA-AMMOS 3DTilesRendererJS VR example
 * Adapted for Vite build - minimal changes from original
 * Source: https://github.com/NASA-AMMOS/3DTilesRendererJS/blob/master/example/three/vr.js
 */
import {
  Scene,
  DirectionalLight,
  AmbientLight,
  WebGLRenderer,
  PerspectiveCamera,
  Box3,
  Raycaster,
  Mesh,
  MeshBasicMaterial,
  Group,
  TorusGeometry,
  GridHelper,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  AdditiveBlending,
  Line,
  Vector3,
  RingGeometry,
  Sphere,
  Quaternion,
} from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { TilesRenderer, Scheduler, WGS84_ELLIPSOID } from '3d-tiles-renderer';
import {
  CesiumIonAuthPlugin,
  TileCompressionPlugin,
  GLTFExtensionsPlugin,
  TilesFadePlugin,
} from '3d-tiles-renderer/plugins';

const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN;
const DEG2RAD = Math.PI / 180;

// Start location: Kuala Lumpur, 500m up
const START_LAT = 3.1398 * DEG2RAD;
const START_LON = 101.6878 * DEG2RAD;
const START_ALT = 500;

let camera: PerspectiveCamera,
  scene: Scene,
  renderer: WebGLRenderer,
  tiles: TilesRenderer;
let workspace: Group;
let box: Box3, sphere: Sphere, grid: GridHelper;
let raycaster: Raycaster, fwdVector: Vector3, intersectRing: Mesh;
let offsetParent: Group;
let controller: any, controllerGrip: any;
let xrSession: XRSession | null = null;
const upVector = new Vector3(0, 1, 0);

init();

function init() {
  scene = new Scene();

  renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0xbbbbbb);
  renderer.xr.enabled = true;

  document.body.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 1;

  renderer.setAnimationLoop(animate);

  workspace = new Group();
  scene.add(workspace);

  grid = new GridHelper(10, 10, 0xffffff, 0xffffff);
  (grid.material as any).transparent = true;
  (grid.material as any).opacity = 0.5;
  (grid.material as any).depthWrite = false;
  workspace.add(grid);

  camera = new PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    1,
    1e8
  );
  camera.position.set(0, 1, 0);
  workspace.add(camera);

  const dirLight = new DirectionalLight(0xffffff);
  dirLight.position.set(1, 2, 3);
  scene.add(dirLight);

  const ambLight = new AmbientLight(0xffffff, 0.2);
  scene.add(ambLight);

  box = new Box3();
  sphere = new Sphere();

  // offsetParent: transforms ECEF so our start location is at scene origin with Y-up
  offsetParent = new Group();
  scene.add(offsetParent);

  // Compute ECEF position and surface normal for start location
  const startECEF = new Vector3();
  WGS84_ELLIPSOID.getCartographicToPosition(START_LAT, START_LON, START_ALT, startECEF);
  const surfaceNormal = new Vector3().copy(startECEF).normalize();
  const alignQuat = new Quaternion().setFromUnitVectors(surfaceNormal, new Vector3(0, 1, 0));

  offsetParent.quaternion.copy(alignQuat);
  const rotatedStart = new Vector3().copy(startECEF).applyQuaternion(alignQuat);
  offsetParent.position.copy(rotatedStart).negate();

  tiles = new TilesRenderer();

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

  offsetParent.add(tiles.group);

  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);

  raycaster = new Raycaster();
  fwdVector = new Vector3(0, 0, 1);

  const rayIntersectMat = new MeshBasicMaterial({ color: 0xb2dfdb });
  intersectRing = new Mesh(
    new TorusGeometry(1.5, 0.2, 16, 100),
    rayIntersectMat
  );
  intersectRing.visible = false;
  scene.add(intersectRing);

  document.body.appendChild(VRButton.createButton(renderer));

  controller = renderer.xr.getController(0);
  controller.addEventListener('selectstart', () => {
    if (intersectRing.visible) {
      workspace.position.copy(intersectRing.position);
    }
  });
  controller.addEventListener('connected', function (this: any, event: any) {
    this.controllerActive = true;
    this.add(buildController(event.data));
  });
  controller.addEventListener('disconnected', function (this: any) {
    this.controllerActive = false;
    this.remove(this.children[0]);
  });
  workspace.add(controller);

  const controllerModelFactory = new XRControllerModelFactory();
  controllerGrip = renderer.xr.getControllerGrip(0);
  controllerGrip.add(
    controllerModelFactory.createControllerModel(controllerGrip)
  );
  workspace.add(controllerGrip);

  onWindowResize();
  window.addEventListener('resize', onWindowResize, false);
}

function buildController(data: any) {
  let geometry, material;

  switch (data.targetRayMode) {
    case 'tracked-pointer':
      geometry = new BufferGeometry();
      geometry.setAttribute(
        'position',
        new Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3)
      );
      geometry.setAttribute(
        'color',
        new Float32BufferAttribute([0.5, 0.5, 0.5, 0, 0, 0], 3)
      );

      material = new LineBasicMaterial({
        vertexColors: true,
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });

      return new Line(geometry, material);

    case 'gaze':
      geometry = new RingGeometry(0.02, 0.04, 32).translate(0, 0, -1);
      material = new MeshBasicMaterial({ opacity: 0.5, transparent: true });
      return new Mesh(geometry, material);
  }
}

function onWindowResize() {
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function handleCamera() {
  if (renderer.xr.isPresenting) {
    if (xrSession === null) {
      const xrCamera = renderer.xr.getCamera();

      tiles.cameras.forEach((c) => tiles.deleteCamera(c));
      tiles.setCamera(xrCamera);

      const leftCam = xrCamera.cameras[0];
      if (leftCam) {
        tiles.setResolution(
          xrCamera,
          leftCam.viewport.z,
          leftCam.viewport.w
        );
      }

      xrSession = renderer.xr.getSession();
      Scheduler.setXRSession(xrSession!);
    }
  } else {
    if (xrSession !== null) {
      tiles.cameras.forEach((c) => tiles.deleteCamera(c));

      tiles.setCamera(camera);
      tiles.setResolutionFromRenderer(camera, renderer);

      camera.position.set(0, 1, 0);

      xrSession = null;
      Scheduler.setXRSession(null as unknown as XRSession);
    }
  }
}

function animate() {
  grid.visible = true;

  // For Earth tiles, the bounding center is at (0,0,0) = Earth center.
  // offsetParent handles the transform to bring our start location to origin.

  handleCamera();

  tiles.update();

  if (controller.controllerActive) {
    const { ray } = raycaster;
    (raycaster as any).firstHitOnly = true;

    ray.origin.copy(controller.position).applyMatrix4(workspace.matrixWorld);
    controller.getWorldDirection(ray.direction).multiplyScalar(-1);

    const results = raycaster.intersectObject(tiles.group, true);
    if (results.length) {
      const hit = results[0];

      hit.face!.normal.transformDirection(tiles.group.matrixWorld);
      intersectRing.position.copy(hit.point);
      intersectRing.quaternion.setFromUnitVectors(fwdVector, hit.face!.normal);
      intersectRing.visible = true;

      const scale =
        (workspace.position.distanceTo(intersectRing.position) * camera.fov) /
        4000;
      intersectRing.scale.setScalar(scale);

      if (hit.face!.normal.dot(upVector) < 0.15) {
        intersectRing.visible = false;
      }
    } else {
      intersectRing.visible = false;
    }
  } else {
    intersectRing.visible = false;
  }

  renderer.render(scene, camera);
}
