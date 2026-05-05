import PocketBase from 'pocketbase';

const rawUrl = import.meta.env.VITE_POCKETBASE_URL ?? 'http://127.0.0.1:8090';
const baseUrl = rawUrl.replace(/\/$/, '');

/** Shared PocketBase client (browser). Points at local PocketBase unless `VITE_POCKETBASE_URL` is set. */
export const pb = new PocketBase(baseUrl);
