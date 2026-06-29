module.exports = {
  apps: [
    {
      name: 'pocketbase',
      script: 'pocketbase.exe',
      args: 'serve --http=127.0.0.1:8091 --dir=pb_data',
      cwd: 'D:\\xiazai\\AI\\overseas-workbench\\overseas-workbench',
      autorestart: true,
      watch: false,
    },
    {
      name: 'backend',
      script: 'node_modules\\tsx\\dist\\cli.mjs',
      args: 'server/index.ts',
      cwd: 'D:\\xiazai\\AI\\overseas-workbench\\overseas-workbench',
      interpreter: 'node',
      autorestart: true,
      watch: false,
      env: { NODE_ENV: 'development' },
    },
    {
      name: 'frontend',
      script: 'node_modules\\vite\\bin\\vite.js',
      cwd: 'D:\\xiazai\\AI\\overseas-workbench\\overseas-workbench',
      interpreter: 'node',
      autorestart: true,
      watch: false,
    },
  ],
};
