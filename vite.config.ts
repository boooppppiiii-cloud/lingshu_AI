import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type ServerOptions } from 'vite';

/**
 * 远程用浏览器打开 `http://公网IP:3000` 时，若 HMR WebSocket 连错 host（常见为连到 localhost），
 * 会出现 `[vite] server connection lost` 后整页刷新。在运行 Vite 的环境（如 .env）里设 `DEV_HMR_HOST=公网IP`。
 * 不需要热更新时设 `DISABLE_HMR=true` 或 `npm run dev:stable` 可彻底避免该类刷新。
 */
function resolveHmr(): ServerOptions['hmr'] {
  if (process.env.DISABLE_HMR === 'true') return false;
  const publicHost = process.env.DEV_HMR_HOST?.trim();
  if (publicHost) {
    const port = Number(process.env.DEV_HMR_PORT || 3000);
    const clientPort = Number(process.env.DEV_HMR_CLIENT_PORT || port);
    return { host: publicHost, port, clientPort };
  }
  return true;
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    optimizeDeps: {
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: resolveHmr(),
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
      },
    },
    preview: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
      },
    },
  };
});
