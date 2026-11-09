import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo, /api se redirige al servidor Rust local (cargo run --bin main → puerto 3000).
export default defineConfig({
  plugins: [react()],
  server: {
    // IPv4 explícito: en Windows Vite puede quedar escuchando solo en ::1 y el navegador no lo encuentra.
    host: '127.0.0.1',
    port: 5173,
    // No vigilar la salida de Rust: cuando cargo recompila bloquea los .exe y Vite se cae con EBUSY.
    watch: { ignored: ['**/target/**', '**/server/**', '**/api/**', '**/migrations/**'] },
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
