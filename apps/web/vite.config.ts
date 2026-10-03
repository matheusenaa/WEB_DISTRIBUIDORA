import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

export default defineConfig({
  // Sem isso o Vite procura .env em apps/web e nao encontra o da raiz,
  // quebrando a embebida de VITE_API_URL no bundle de producao.
  envDir: repoRoot,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
      '@webdist/shared': path.resolve(repoRoot, 'packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,
    strictPort: false,
    proxy: {
      // Em desenvolvimento o frontend fala com a API pelo mesmo origin,
      // evitando configuracao de CORS e simplificando o deploy.
      '/api': {
        target: 'http://127.0.0.1:3333',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Separa libraries em chunks para cache do navegador ser eficiente.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          forms: ['react-hook-form', '@hookform/resolvers'],
        },
      },
    },
  },
});
