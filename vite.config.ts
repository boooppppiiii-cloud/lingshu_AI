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
    // 5173 与 8788 都被 Cursor 的 lingqi-ai 扩展占用（它在 127.0.0.1 上跑了一份旧构建，
    // 会遮蔽我们 0.0.0.0 的 dev server）。前端改用 5174，strictPort 防止静默撞端口。
    port: 5174,
    strictPort: true,
    host: '0.0.0.0',
    hmr: resolveHmr(),
    proxy: {
      '/api/overseas': {
        // 8788 被 Cursor 的 lingqi-ai 扩展占用，本地后端改用 8790（与 .env 的 PORT 一致）
        target: process.env.DEV_API_TARGET ?? 'http://127.0.0.1:8790',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
}));
