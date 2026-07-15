# 服务器收尾检查清单

## 1. 找出 32GB 被谁吃掉

SSH 到服务器后执行：

```bash
cd /opt/lingshu
bash deploy/server-audit.sh
```

重点看：

- `/opt/lingshu/data/media`
- `/opt/lingshu/data/bgm`
- `/opt/lingshu/data/tts`
- `/opt/lingshu/data/covers`
- `/opt/lingshu/data/backups`
- `/var/log`
- Docker images / containers / volumes
- 多份 `node_modules`
- `dist` 或历史构建产物

## 2. 媒体文件迁 R2，本地只留 7 天

当前代码已经支持 R2。生产环境需要补齐：

```bash
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=overseas-assets
R2_PUBLIC_URL=
R2_BACKUP_PREFIX=lingshu-backups
R2_BACKUP_LOCAL_RETENTION_DAYS=7
```

短期止血清理命令：

```bash
cd /opt/lingshu
find data/media data/bgm data/tts data/covers -type f -mtime +7 -print
```

确认列表没问题后再删：

```bash
find data/media data/bgm data/tts data/covers -type f -mtime +7 -delete
```

后续建议把创作室生成的视频/音频上传 R2 后，仅在本机保留 7 天缓存。

## 3. 日志轮转，上限 500MB

如果使用 PM2：

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 5
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 save
```

如果使用 Docker Compose，建议在 `docker-compose.yml` 的服务里加：

```yaml
logging:
  driver: json-file
  options:
    max-size: "100m"
    max-file: "5"
```

然后重启服务：

```bash
docker compose --env-file .env.production up -d
```

## 4. 加 2GB swap

2GB 内存服务器建议加 swap，防止偶发构建/视频处理/LLM 调用峰值把 Node 打死：

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

## 5. 云控制台必须手动做

这些需要云账号权限，不能通过代码仓库代替：

- 打开自动续费。到期日如果是 2026-10-12，已经不到三个月，必须现在开。
- 配磁盘告警：磁盘使用率 >85%。
- 配 CPU 告警：CPU 连续 5 分钟 >70%。
- 配公网流量告警。
- 配外部拨测：UptimeRobot 免费版，5 分钟探测一次 `https://lingshu.site/api/overseas/health`，微信/邮件告警。

## 6. 建议每周巡检

```bash
df -h
free -h
docker system df
bash deploy/server-audit.sh
```

磁盘超过 80% 就应该处理，超过 85% 必须立即处理。
