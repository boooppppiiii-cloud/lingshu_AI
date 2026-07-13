# 单台 Ubuntu 服务器部署说明

这份文档适合 Linux 小白照着做。目标是把整个工具部署到你自己的 Ubuntu 服务器上，让客户打开一个链接就能使用。

你的服务器：

- 系统：Ubuntu
- 配置：2 核 CPU、2GB 内存、40GB 磁盘
- IPv4：`43.159.41.222`

这台机器可以跑早期演示和小规模客户使用。视频生成、爬虫、批量分析比较吃资源，前期不要开太高并发。

## 你必须自己准备的东西

下面这些我不能替你完成，需要你自己操作：

1. 一个域名，或者两个子域名。
2. 把域名 DNS 解析到服务器 IP。
3. 能登录服务器的账号和密码/密钥。
4. 至少一个 AI 模型 Key，例如 Gemini API Key 或 DashScope API Key。

推荐准备两个子域名：

```text
app.example.com  -> 给客户打开工具
pb.example.com   -> 给你管理数据库后台
```

两个域名都添加 A 记录，指向：

```text
43.159.41.222
```

## 第 1 步：登录服务器

在你电脑的终端里执行，把 `root` 换成你的服务器用户名：

```bash
ssh root@43.159.41.222
```

这一步是在进入服务器。后面的命令都在服务器里执行。

## 第 2 步：安装基础环境

先安装一些基础工具、Docker 和防火墙规则：

```bash
sudo apt update
sudo apt install -y git ca-certificates curl ufw openssl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

这一步在做三件事：

- 安装 Git，用来拉取 GitHub 代码。
- 安装 Docker，用来运行应用、PocketBase 和 HTTPS 入口。
- 开放 80/443 端口，让客户可以通过网页访问。

执行完后，退出服务器再重新登录：

```bash
exit
ssh root@43.159.41.222
```

重新登录是为了让 Docker 权限生效。

## 第 3 步：下载项目代码

```bash
git clone https://github.com/boooppppiiii-cloud/lingshu_AI.git
cd lingshu_AI
```

这一步会把 GitHub 上的项目下载到服务器。

如果提示目录已经存在，就进入已有目录：

```bash
cd lingshu_AI
git pull
```

## 第 4 步：生成线上配置

执行：

```bash
bash deploy/make-production-env.sh
```

它会问你几个问题：

- 客户访问域名：填你的 `app.example.com`
- PocketBase 管理域名：填你的 `pb.example.com`
- PocketBase 管理邮箱：填你的邮箱
- PocketBase 管理密码：可以自己填，也可以直接回车自动生成
- Gemini / DashScope / Seedance Key：有就填，没有就先回车跳过

这一步会生成 `.env.production`，里面保存线上密钥。不要把这个文件发给别人。
其中 `TENANT_PLATFORM_APP_KEY` 用于加密每个租户的平台 App Secret 和 Token；脚本会自动生成。手动部署时可用 `openssl rand -base64 32` 生成，详见 `docs/tenant-platform-app-key.md`。

## 第 5 步：启动全部服务

```bash
bash deploy/start.sh
```

这一步会启动三个服务：

- `app`：你的工具本体
- `pocketbase`：数据库和账号系统
- `caddy`：自动 HTTPS 和域名转发

第一次启动会比较慢，因为服务器要下载镜像、安装依赖和构建前端。

## 第 6 步：创建 PocketBase 管理员

打开浏览器访问：

```text
https://你的PocketBase管理域名/_/
```

例如：

```text
https://pb.example.com/_/
```

第一次打开会要求创建管理员账号。这里要填写你刚才生成 `.env.production` 时使用的同一个邮箱和密码。

## 第 7 步：初始化数据库表

回到服务器终端，执行：

```bash
docker compose --env-file .env.production exec app npm run setup:pb
```

这一步会在 PocketBase 里创建项目需要的数据表。

## 第 8 步：检查是否部署成功

在浏览器打开：

```text
https://你的客户访问域名/api/overseas/health
```

正常会看到类似：

```json
{
  "status": "ok",
  "service": "overseas-marketing-agent"
}
```

然后打开客户访问域名：

```text
https://你的客户访问域名
```

如果页面能打开，说明客户已经可以使用这个工具。

## 常用命令

查看服务状态：

```bash
bash deploy/status.sh
```

查看全部服务：

```bash
docker compose --env-file .env.production ps
```

查看主应用日志：

```bash
docker compose --env-file .env.production logs -f app
```

查看 PocketBase 日志：

```bash
docker compose --env-file .env.production logs -f pocketbase
```

更新代码并重启：

```bash
bash deploy/update.sh
```

手动备份：

```bash
bash deploy/backup.sh
```

停止服务：

```bash
docker compose --env-file .env.production down
```

重新启动：

```bash
docker compose --env-file .env.production up -d
```

## 如果出错

如果域名打不开，先检查：

1. 域名 A 记录是否指向 `43.159.41.222`。
2. 服务器安全组是否放行 80 和 443。
3. 服务器防火墙是否放行 80 和 443。

查看 Caddy HTTPS 日志：

```bash
docker compose --env-file .env.production logs -f caddy
```

如果页面能打开但功能报错，查看主应用日志：

```bash
docker compose --env-file .env.production logs -f app
```

如果登录、账号、数据表异常，查看 PocketBase 日志：

```bash
docker compose --env-file .env.production logs -f pocketbase
```

## 数据保存在哪里

PocketBase 数据保存在 Docker volume 里。  
应用上传或生成的素材保存在项目的 `data/` 目录里。

建议你每次更新前都先备份：

```bash
bash deploy/backup.sh
```
