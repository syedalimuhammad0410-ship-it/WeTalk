import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: (id: string) => (/node_modules\/(react|react-dom|react-router|scheduler)\//.test(id) ? 'react' : id.includes('node_modules/motion') || id.includes('node_modules/framer-motion') ? 'motion' : undefined) } },
  },
});
