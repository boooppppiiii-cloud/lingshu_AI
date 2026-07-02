# Demo 部署说明

目标：给意向客户提供可外网访问的演示环境，重点保证完整试用链路顺畅，真实社媒/电商平台外发默认模拟。

## 环境

- Node.js 20+
- PocketBase
- Nginx + HTTPS
- 建议海外区域：新加坡优先，其次美国西部

## 初始化

```bash
cp .env.demo.example .env
npm install
npm run demo:seed
npm run build
npm run start
```

## Demo 开关

`.env` 中开启：

```bash
DEMO_MODE=true
DEMO_ALLOWED_ACCOUNTS=test1@example.com,test2@example.com
DEMO_DAILY_AI_CHAT_LIMIT=20
DEMO_DAILY_GENERATION_LIMIT=10
DEMO_DAILY_RENDER_LIMIT=3
DEMO_INVITE_CODE=your-demo-code
```

试用时长固定为 5 天。注册/登录白名单会读取 `DEMO_ALLOWED_ACCOUNTS` 和 `data/demo-account-registry.json`；线上部署后先执行 `npm run demo:sync-accounts`，把测试账号和管理员账号同步到 PocketBase。`DEMO_INVITE_CODE` 可留空；设置后注册还必须填写一致的邀请码。

## PM2 示例

```bash
pm2 start "npm run start" --name overseas-demo
pm2 save
```

## Nginx 示例

```nginx
server {
  server_name demo.example.com;

  location / {
    proxy_pass http://127.0.0.1:8790;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## 健康检查

```bash
curl https://demo.example.com/api/overseas/health
```

返回中包含 `demoMode` 和 `demoLimits`。

## 重置演示数据

```bash
npm run demo:reset
```

当前模板是占位模板，等行业信息确认后替换 `data/demo-templates.json` 即可。
