# LingShu 备份与恢复流程

## 这次改动会不会导致历史客户消息消失？

不会。应用的每日任务会先把当前数据复制到 `data/backups/YYYY-MM-DD/`，再把这些备份文件上传到 Cloudflare R2。同步成功后，只会删除 7 天前的本地备份目录。

它不会删除这些正在使用的数据源：

- `data/whatsapp-customers.json`
- `data/whatsapp-interactions.json`
- PocketBase 正库数据
- 最近 7 天的本地备份

## 生产环境变量

在服务器 `.env.production` 中配置：

```bash
R2_ACCOUNT_ID=你的 Cloudflare Account ID
R2_ACCESS_KEY_ID=你的 R2 Access Key
R2_SECRET_ACCESS_KEY=你的 R2 Secret Key
R2_BUCKET_NAME=overseas-assets
R2_PUBLIC_URL=https://你的公开域名或 r2.dev
R2_BACKUP_PREFIX=lingshu-backups
R2_BACKUP_LOCAL_RETENTION_DAYS=7
```

`R2_BACKUP_PREFIX` 对应 R2 里的目录前缀。默认备份路径类似：

```text
lingshu-backups/2026-07-14/whatsapp-customers.json
lingshu-backups/2026-07-14/whatsapp-interactions.json
lingshu-backups/2026-07-14/whatsapp-import-status.json
lingshu-backups/2026-07-14/enterprise.json
```

## 恢复演练：从 R2 恢复到新服务器

以下命令假设你已经把新服务器代码部署到 `/opt/lingshu`，并且已经配置好 `.env.production`。

### 方式 A：用 rclone 拉取最新备份

1. 安装 rclone：

```bash
curl https://rclone.org/install.sh | sudo bash
```

2. 配置 R2：

```bash
rclone config
```

选择 `n` 新建 remote，类型选择 `s3`，provider 选择 `Cloudflare`，填入 R2 的 `access_key_id`、`secret_access_key`、`endpoint`：

```text
https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
```

假设 remote 名叫 `r2`。

3. 查看备份日期：

```bash
rclone lsf r2:overseas-assets/lingshu-backups/
```

4. 拉取最新日期备份：

```bash
cd /opt/lingshu
mkdir -p data
rclone copy r2:overseas-assets/lingshu-backups/2026-07-14 ./data --progress
```

5. 重启服务：

```bash
docker compose --env-file .env.production up -d --build
```

### 方式 B：用 AWS CLI 拉取

```bash
aws configure
export AWS_ENDPOINT_URL=https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
cd /opt/lingshu
mkdir -p data
aws s3 sync s3://overseas-assets/lingshu-backups/2026-07-14 ./data --endpoint-url "$AWS_ENDPOINT_URL"
docker compose --env-file .env.production up -d --build
```

## PocketBase 备份恢复

如果你使用 `deploy/backup.sh` 生成了 `pb_data_*.tar.gz`，恢复新服务器 PocketBase 数据：

```bash
cd /opt/lingshu
docker compose --env-file .env.production stop pocketbase
mkdir -p pb_data
tar xzf backups/pb_data_YYYY-MM-DD_HHMMSS.tar.gz -C pb_data
docker compose --env-file .env.production up -d pocketbase
```

## 每月恢复演练

建议每月至少演练一次：

1. 新开一台临时服务器。
2. 从 R2 拉取最新备份。
3. 启动服务。
4. 检查“我的客户”是否能看到最近客户消息。
5. 演练完成后销毁临时服务器。
