# CloudBase Run 部署说明

目标：把当前工具部署成客户可直接访问的线上链接。当前项目是 React + Express + PocketBase，不是纯静态网页，所以应部署到 CloudBase 云托管 / CloudBase Run。

## 推荐架构

- CloudBase Run：运行主应用，也就是本仓库。
- PocketBase：单独部署，并开启持久化存储。不要把正式数据放在 CloudBase Run 容器本地目录里。
- 对象存储 COS：后续用于长期保存素材、生成视频、封面和音频。

## CloudBase Run 配置

使用仓库根目录的 `Dockerfile` 构建。

服务端口：

```bash
8788
```

构建过程会执行：

```bash
npm ci
npm run build
```

启动命令已写在镜像里：

```bash
npm run start
```

## 必填环境变量

在 CloudBase Run 服务的环境变量中配置：

```bash
PB_URL=https://your-pocketbase.example.com
PB_ADMIN_EMAIL=your-admin@example.com
PB_ADMIN_PASSWORD=your-strong-password
RENDER_TOKEN_SECRET=change-to-a-long-random-secret
PUBLIC_BASE_URL=https://your-cloudbase-domain.example.com
```

至少配置一个大模型服务：

```bash
GEMINI_API_KEY=your-key
```

或：

```bash
OVERSEAS_LLM_BACKEND=qwen
DASHSCOPE_API_KEY=your-key
```

如需启用视频生成，再配置：

```bash
SEEDANCE_API_KEY=your-key
SEEDANCE_VIDEO_ENABLED=true
```

## PocketBase 初始化

PocketBase 服务启动后，在本项目环境变量指向该 PocketBase，再执行一次初始化：

```bash
npm run setup:pb
```

如果是在本地执行初始化，需要先在本地 `.env` 中填好同样的 `PB_URL`、`PB_ADMIN_EMAIL`、`PB_ADMIN_PASSWORD`。

## 健康检查

部署完成后访问：

```bash
https://your-domain.example.com/api/overseas/health
```

正常会返回：

```json
{
  "status": "ok",
  "service": "overseas-marketing-agent"
}
```

## 重要注意

CloudBase Run 容器本地目录适合临时文件，不适合保存正式客户数据。当前代码里仍有一部分素材、项目草稿、音频和封面默认写入 `data/` 目录；正式商用前建议迁移到 COS 或 PocketBase 文件字段。

如果只做小范围演示，可以先用 CloudBase Run + 外部 PocketBase 跑起来；如果要给付费客户长期使用，应优先完成文件存储迁移和定期备份。
