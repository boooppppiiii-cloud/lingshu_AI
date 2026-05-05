import PocketBase from 'pocketbase';

// 仅 `VITE_POCKETBASE_URL` 会打进前端包；根目录 `.env` 里的 `POCKETBASE_URL` 只给 Node 用，改它不会让浏览器换地址。
const rawUrl = import.meta.env.VITE_POCKETBASE_URL ?? 'http://127.0.0.1:8090';
const baseUrl = rawUrl.replace(/\/$/, '');

/** Shared PocketBase client (browser). Points at local PocketBase unless `VITE_POCKETBASE_URL` is set. */
export const pb = new PocketBase(baseUrl);
