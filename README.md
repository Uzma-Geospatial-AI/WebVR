# Cesium 3D Terrain VR Viewer for Meta Quest 2

A web-based VR application for flying through Cesium 3D terrain on a Meta Quest 2, built with Three.js + 3DTilesRendererJS + WebXR. No Unity, no Unreal, no Android build pipeline.

## The Problem This Project Solves

View Cesium 3D terrain (photogrammetry meshes, Cesium Ion assets, optionally Google Photorealistic 3D Tiles) in VR on a Meta Quest 2 and fly around inside it.

### Why not CesiumJS?

CesiumJS does not support WebXR. It has been on their roadmap for years but is not implemented. Attempts to shim WebXR into CesiumJS's render loop fail because CesiumJS owns its own framebuffer and frustum in ways that conflict with WebXR's stereo frame callback.

### Why not Cesium for Unreal?

It works and is the officially supported VR path, but the native build pipeline (Android SDK, NDK, Unreal packaging) is heavy. We want iteration to be "save file -> reload browser on headset."

### The Solution

Use **3d-tiles-renderer** (originally from NASA JPL, now Cesium-grant-funded). It renders the same OGC 3D Tiles data that CesiumJS consumes, but inside Three.js -- and Three.js has first-class WebXR support. The Quest 2 browser (Meta Browser or Wolvic) runs WebXR natively.

## Tech Stack

| Concern | Choice | Reason |
|---------|--------|--------|
| 3D runtime | Three.js (latest stable) | Native WebXR support |
| 3D Tiles | 3d-tiles-renderer (npm) | Official-ish 3D Tiles impl for Three.js, supports Cesium Ion + Google Tiles via auth plugins |
| Language | TypeScript | Better DX with typed code |
| Build / dev server | Vite | Fast HMR, built-in `--https` flag for WebXR testing |
| VR entry | Three.js VRButton addon | Standard WebXR session boilerplate |
| Hosting | GitHub Pages | Free HTTPS static hosting, auto-deploy on push |

## Getting Started

```bash
npm install
npm run dev
```

Opens at `https://localhost:5173` (HTTPS required for WebXR).

## Build & Deploy

Every push to `main` auto-deploys to GitHub Pages via GitHub Actions.

To build locally:

```bash
npm run build
npm run preview
```

## Accessing on Quest 2

1. Open **Meta Browser** on your Quest 2
2. Navigate to `https://uzma-geospatial-ai.github.io/WebVR/`
3. Click **"Enter VR"**
4. Fly through terrain

## Key Constraints

- **WebXR requires HTTPS** -- even on local dev (Vite `--https` or tunneling)
- **Quest 2 browser** is the target runtime -- test on-device, not just desktop
- **No native build pipeline** -- everything runs in the browser
- **OGC 3D Tiles** is the data format -- same tileset URLs that CesiumJS / Cesium Ion serves
