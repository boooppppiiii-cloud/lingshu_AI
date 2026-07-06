import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type ServerOptions } from 'vite';

function resolveHmr(): ServerOptions['hmr'] {
  if (process.env.DISABLE_HMR === 'true') return false;
  const publicHost = process.env.DEV_HMR_HOST?.trim();
  if (publicHost) {
    const port = Number(process.env.DEV_HMR_PORT || 5177);
    const clientPort = Number(process.env.DEV_HMR_CLIENT_PORT || port);
    return { host: publicHost, port, clientPort };
  }
  return true;
}

const devApiTarget = process.env.DEV_API_TARGET ?? 'http://127.0.0.1:8788';

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    // 合并版使用独立端口，避免和 overseas / 新手引导两个工作区互相抢占。
    port: Number(process.env.DEV_PORT || 5177),
    strictPort: true,
    host: '0.0.0.0',
    hmr: resolveHmr(),
    watch: {
      // 后端会在 data/ 下写入账号状态、token 用量、任务等运行时数据。
      // 这些文件变化不应触发前端整页 reload，否则新手任务会被反复卸载/挂载。
      ignored: ['**/data/**'],
    },
    proxy: {
      // 8788 被 Cursor 的 lingqi-ai 扩展占用；当前本地 watch 后端稳定监听 8790。
      '/api/overseas': {
        target: devApiTarget,
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      // 素材库 / BGM 曲库的文件由后端静态托管
      '/media': {
        target: devApiTarget,
        changeOrigin: true,
      },
      '/bgm': {
        target: devApiTarget,
        changeOrigin: true,
      },
      '/tts': {
        target: devApiTarget,
        changeOrigin: true,
      },
      '/covers': {
        target: devApiTarget,
        changeOrigin: true,
      },
    },
  },
}));
