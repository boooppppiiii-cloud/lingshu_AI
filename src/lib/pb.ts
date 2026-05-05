import PocketBase from 'pocketbase';

// 推荐写法：优先读取环境变量，没有则用你的服务器公网 IP
const baseUrl = import.meta.env.VITE_POCKETBASE_URL || 'http://43.156.182.61:8090';

export const pb = new PocketBase(baseUrl);
