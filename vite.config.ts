import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type ServerOptions } from 'vite';

function resolveHmr(): ServerOptions['hmr'] {
  if (process.env.DISABLE_HMR === 'true') return false;
  const publicHost = process.env.DEV_HMR_HOST?.trim();
  if (publicHost) {
    const port = Number(process.env.DEV_HMR_PORT || 5173);
    const clientPort = Number(process.env.DEV_HMR_CLIENT_PORT || port);
    return { host: publicHost, port, clientPort };
  }
  return true;
}

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    hmr: resolveHmr(),
    proxy: {
      '/api/overseas': {
        target: 'http://127.0.0.1:8788',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
}));
