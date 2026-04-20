import { defineConfig } from 'vite';

export default defineConfig({
  // For GitHub Pages: set to your repo name
  // e.g. if repo is https://github.com/youruser/WebVR -> base: '/WebVR/'
  base: '/WebVR/',
  build: {
    outDir: 'dist',
  },
  server: {
    host: true,
  },
});
