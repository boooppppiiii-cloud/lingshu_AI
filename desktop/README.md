# 桌面客户端（Electron + 本机原生 ffmpeg）

混剪工作台的成片合成（⑥）在**用户本机**用原生 ffmpeg 完成：满速、用用户自己的 CPU、零服务器算力、素材不出本机。服务器只负责「渲染授权」——下发原料清单（manifest）+ 短期签名令牌，由 `POST /api/overseas/studio/render` 返回。

## 组成

| 文件 | 职责 |
|---|---|
| `main.cjs` | Electron 主进程：加载工作台网页 + 提供 `render:start` IPC |
| `preload.cjs` | 向网页注入 `window.desktopRender` 桥（前端检测到即走本机合成） |
| `render.cjs` | 调 `ffmpeg-static` 自带二进制，按 manifest 合成 MP4，解析进度 |

前端逻辑见 [`src/components/AiCreateStudio.tsx`](../src/components/AiCreateStudio.tsx) 的 `goPreview`：
有桌面桥 → 本机 ffmpeg 真合成；纯网页 → 仅模拟进度（无法调本机程序）。

## 运行

```bash
npm install            # 含 electron + ffmpeg-static
npm start              # 起 express（默认 8790），同时服务 dist 静态页 + /api
npm run desktop        # 起 Electron，默认加载 http://localhost:8790
```

用 vite dev 调试 UI 时：`DESKTOP_URL=http://localhost:5173 npm run desktop`（需确保 vite 把 `/api` 代理到 express）。

## 现状 / 后续

- 当前 manifest 的 `timeline/voiceover/cover/bgm` 的 `url` 均为 `null`（TTS、封面出图、BGM 曲库尚未接入），`render.cjs` 用「纯色背景 + 烧录封面标题/口播 Hook + 静音音轨」合成一条**真实可播放的占位成片**，验证本机合成链路。
- 原料 url 填上后：把 `color` 背景换成封面图/片段拼接、`anullsrc` 换成配音 + BGM 混流即可，`composite()` 签名不变。
- 收费墙（A/D）接入后，签发令牌处先校验订阅、把 entitlement 写进 token，`render.cjs` 凭令牌上传成片回 R2 时由服务器校验。
