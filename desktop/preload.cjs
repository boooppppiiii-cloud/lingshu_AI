/* eslint-disable */
/**
 * 预加载脚本：向网页注入 window.desktopRender 桥。
 * 前端（AiCreateStudio）检测到该桥即调用本机 ffmpeg 合成，否则走网页模拟。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopRender', {
  available: true,
  /** @param {object} manifest 服务器下发的渲染清单 */
  render: manifest => ipcRenderer.invoke('render:start', manifest),
  /** 在系统文件管理器中定位本地文件 */
  showItemInFolder: filePath => ipcRenderer.invoke('file:showItemInFolder', filePath),
  /** 订阅进度，返回取消订阅函数 */
  onProgress: cb => {
    const listener = (_e, pct) => cb(pct);
    ipcRenderer.on('render:progress', listener);
    return () => ipcRenderer.removeListener('render:progress', listener);
  },
});
