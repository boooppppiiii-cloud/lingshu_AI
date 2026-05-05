import PocketBase from 'pocketbase';
// 必须使用公网 IP，否则你在本地浏览器访问时，代码会尝试连接你电脑本地的 8090 端口
export const pb = new PocketBase('http://43.156.182.61:8090');
const baseUrl = rawUrl.replace(/\/$/, '');

/** Shared PocketBase client (browser). Points at local PocketBase unless `VITE_POCKETBASE_URL` is set. */
export const pb = new PocketBase(baseUrl);
