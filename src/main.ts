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
} from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { TilesRenderer, Scheduler } from '3d-tiles-renderer';

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
    0.1,
    4000
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

  offsetParent = new Group();
  offsetParent.rotation.x = Math.PI / 2;
  offsetParent.position.y = 32;
  scene.add(offsetParent);

  tiles = new TilesRenderer(
    'https://raw.githubusercontent.com/NASA-AMMOS/3DTilesSampleData/master/msl-dingo-gap/0528_0260184_to_s64o256_colorize/scene-tileset.json'
  );
  offsetParent.add(tiles.group);

  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);

  tiles.lruCache.maxSize = 1200;
  tiles.lruCache.minSize = 900;

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

  if (tiles.getBoundingBox(box)) {
    box.getCenter(tiles.group.position);
    tiles.group.position.multiplyScalar(-1);
  } else if (tiles.getBoundingSphere(sphere)) {
    tiles.group.position.copy(sphere.center);
    tiles.group.position.multiplyScalar(-1);
  }

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
