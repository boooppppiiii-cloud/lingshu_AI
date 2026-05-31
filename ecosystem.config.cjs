/**
 * PM2 进程配置
 *
 * 生产（推荐关终端长期跑）：
 *   npm run build
 *   pm2 start ecosystem.config.cjs --only lingqi-prod
 *
 * 开发（API 8787 + Vite 3000，与 npm run dev 等价，但不用 tsx watch）：
 *   pm2 start ecosystem.config.cjs --only lingqi-dev-api,lingqi-dev-vite
 */
const path = require('node:path');
const appDir = __dirname;

module.exports = {
  apps: [
    {
      name: 'pocketbase',
      cwd: '/home/ubuntu/pocketbase',
      script: './pocketbase',
      args: 'serve --http=0.0.0.0:8090',
      interpreter: 'none',
      autorestart: true,
      max_memory_restart: '256M',
    },
    {
      name: 'lingqi-prod',
      cwd: appDir,
      script: 'server/index.ts',
      interpreter: '/usr/local/bin/node',
      node_args: '--import tsx/esm',
      env_file: path.join(appDir, '.env'),
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '800M',
      autorestart: true,
    },
    {
      name: 'lingqi-dev-api',
      cwd: appDir,
      script: 'server/index.ts',
      interpreter: '/usr/local/bin/node',
      node_args: '--import tsx/esm',
      env_file: path.join(appDir, '.env'),
      env: {
        NODE_ENV: 'development',
        PORT: 8787,
      },
      max_memory_restart: '600M',
      autorestart: true,
    },
    {
      name: 'lingqi-dev-vite',
      cwd: appDir,
      script: 'npx',
      args: 'vite --port=3000 --host=0.0.0.0',
      interpreter: 'none',
      env: {
        NODE_ENV: 'development',
      },
      max_memory_restart: '600M',
      autorestart: true,
    },
  ],
};
