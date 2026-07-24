# 本地部署 API 配置交接

## 推荐文件位置

把真实密钥放在当前用户目录：

```text
~/.config/lingshu-ai/.env.local
```

项目启动时会读取：

1. 项目 `.env`
2. `~/.config/lingshu-ai/.env`
3. `~/.config/lingshu-ai/.env.local`
4. 项目 `.env.local`（最高优先级）

同事先复制 `.env.local-deploy.example`，再通过密码管理器填写真实值：

```bash
mkdir -p ~/.config/lingshu-ai
cp .env.local-deploy.example ~/.config/lingshu-ai/.env.local
chmod 600 ~/.config/lingshu-ai/.env.local
```

## 能力与凭证对应关系

| 能力 | 必需配置 | 备注 |
|---|---|---|
| 文案、分析、客服 | `DASHSCOPE_API_KEY` 或 `GEMINI_API_KEY` | 推荐 Qwen 默认、Gemini 补充视觉能力 |
| 图片/视频视觉分析 | `GEMINI_API_KEY` | Gemini 不可用时部分流程会回退 Qwen |
| Instagram/Facebook/TikTok 抓取兜底 | `APIFY_TOKEN` | Actor 名称通常使用模板默认值 |
| MiniMax 配音、真人音色克隆 | `MINIMAX_API_KEY` | 当前这台电脑尚未找到可复用的 MiniMax Key |
| Seedance 视频生成 | `SEEDANCE_API_KEY` | 这是付费生成接口，需要设置预算限制 |
| 云端素材和备份 | `R2_*` | 纯本地演示可不配置 |
| 数据库管理 | `PB_ADMIN_EMAIL/PASSWORD` | 同事应使用自己的本地管理员密码 |
| 社媒账号授权发布 | OAuth Client ID/Secret | 仅抓取公开内容时不必配置 |

## 必须保密的内容

以下内容均按 Secret 处理：

- 所有 API Key、Access Token、Client Secret、签名 Secret。
- PocketBase 管理员邮箱和密码、管理员登录密码。
- Cloudflare R2 Access Key 与 Secret Key。
- YouTube/Meta/TikTok OAuth Client Secret，以及账号授权后的 Access/Refresh Token。
- `cookies.txt`、浏览器 Cookie、会话文件和任何客户账号登录态。
- `pb_data/`、客户资料、订单、WhatsApp 对话、企业资料和导出数据。

不要通过群聊、普通邮件、截图、Git 仓库或文档正文发送真实值。建议使用 1Password、Bitwarden、企业密码保险箱或带过期时间的一次性 Secret 链接。

## 不应直接复制的内容

- 不要把 Julia 本机的 `PB_ADMIN_PASSWORD`、`LOCAL_ADMIN_PASSWORD` 直接给同事。
- 不要复制个人浏览器 Cookie；同事如需采集登录态，应使用专用采集账号自行导出。
- 签名密钥应在同事电脑重新生成，例如：

```bash
openssl rand -base64 32
```

- 如需共享同一个付费 API 账号，应先确认供应商允许多人/多环境使用，并为同事创建独立子密钥或设置额度。

## 交接前检查

```bash
npm install
npm run lint
npm run dev:server
npm run dev
```

启动后分别验证登录、模型分析、Apify 抓取、配音和视频生成。任何未配置能力都应明确显示“未配置”，不要静默使用 Mock 结果冒充真实调用。
