import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// The site is published on GitHub Pages at https://abdurazzaqovjasur12-hub.github.io/ocean-explorer/, so the
// production build is served from /ocean-explorer/: every script, stylesheet and file in public/ is linked under
// it (code that fetches files reads import.meta.env.BASE_URL, see src/audio/files.js). `npm run preview` serves the
// build the same way (http://localhost:4173/ocean-explorer/); the dev server stays at /.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/ocean-explorer/' : '/',
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // host: true exposes the dev server on your LAN so you can test on a phone.
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: { manualChunks: { three: ['three'], vue: ['vue'], gsap: ['gsap'] } },
    },
  },
}));
