import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    base: './',
    define: { __STANDALONE__: JSON.stringify(standalone) },
    resolve: { alias: { '@shared': path.resolve(__dirname, '../shared') } },
    server: { port: 5173, proxy: { '/api': 'http://localhost:3000' }, fs: { allow: ['..'] } },
    build: { outDir: standalone ? 'dist-standalone' : 'dist', chunkSizeWarningLimit: 1500 },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'XPOS – Smart Multi-Business POS', short_name: 'XPOS', start_url: './', scope: './',
          display: 'standalone', background_color: '#0f172a', theme_color: '#4f46e5',
          icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: []
        }
      })
    ]
  };
});
