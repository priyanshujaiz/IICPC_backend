import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Gateway API (auth, submit, runs)
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Leaderboard SSE stream
      '/scores': {
        target: 'http://localhost:4001',
        changeOrigin: true,
      },
      // Leaderboard chart data
      '/metrics': {
        target: 'http://localhost:4001',
        changeOrigin: true,
      },
    },
  },
});

