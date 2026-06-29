/* eslint-disable */
/**
 * Electron 主进程。
 * 加载工作台网页（默认指向本机 express，它同时服务 dist 静态页 + /api），
 * 并提供 render:start IPC：用本机原生 ffmpeg 合成成片，完成后在文件管理器中显示。
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { composite, exportCapcutPackage } = require('./render.cjs');

// express 服务（npm start）默认 8790，同时提供 UI 与 /api。也可用 DESKTOP_URL 覆盖（如 vite dev）。
const APP_URL = process.env.DESKTOP_URL || 'http://localhost:8790';

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: '灵枢 AI 工作台',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(APP_URL);
}

ipcMain.handle('render:start', async (_event, manifest) => {
  const result = await composite(manifest, pct => {
    if (win && !win.isDestroyed()) win.webContents.send('render:progress', pct);
  });
  // 合成成功后在系统文件管理器中高亮该文件，方便用户取片
  if (result.ok && result.outputPath) {
    shell.showItemInFolder(result.outputPath);
  }
  return result;
});

ipcMain.handle('capcut:open', async (_event, payload) => {
  const result = await exportCapcutPackage(payload);
  if (result.ok && result.dir) shell.openPath(result.dir);
  return result;
});

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
