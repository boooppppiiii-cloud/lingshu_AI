/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POCKETBASE_URL?: string;
  /** 仅当前端与 API 不同域时设置，例如 https://api.你的域名.com（不要尾斜杠）。同域部署留空即可。 */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
