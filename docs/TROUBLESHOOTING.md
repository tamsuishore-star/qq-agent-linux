# 故障排查

## 1. 机器人不回消息

按顺序检查：

```bash
systemctl is-active qq-agent
docker ps --filter name=napcat
curl -s http://127.0.0.1:3210/api/status
```

- `active` 但 `"connected":false`：看 `diagnosis` 字段，多为 QQ 掉线或 OneBot 未启动；
- NapCat 不在 `Up`：`docker logs napcat --tail 50`；
- 都正常但仍不回：`journalctl -u qq-agent -f`，再发一条消息，看是否出现事件日志与 AI 调用错误。

## 2. QQ 被踢下线 / 要求重新登录

原因：新设备、异地 IP、同账号在别处登录。

```bash
docker restart napcat
docker logs napcat --tail 30
```

- 日志出现二维码：用手机 QQ 扫码并完成安全验证；
- 若提示 `Login Error, ErrType: 1 ErrCode: 3`：登录态失效，需要重新扫码；
- 同一账号不要同时在两台机器登录，否则会互踢。

登录成功后，`ACCOUNT` 环境变量会让后续重启自动快速登录。

## 3. 进程反复重启 / 内存溢出

```bash
journalctl -u qq-agent --since "-10min" --no-pager | grep -c "heap out of memory"
free -h
```

常见原因与处理：

1. `extensions.hotReload` 被改成 `true` → 改回 `false` 并重启；
2. 堆上限过低 → 在 `limits.conf` 中调整 `--max-old-space-size`（2G 机器建议 640–896）；
3. NapCat 与 Node 同时吃内存 → 确认没有其它重服务，保留 swap。

## 4. OneBot 连接被拒（ECONNREFUSED 127.0.0.1:3001）

- NapCat 没启动：`docker start napcat`；
- 端口没映射：`ss -tlnp | grep 3001`；
- Token 不一致：核对 `data/config.json` 与 `onebot11_<QQ>.json`。

## 5. 控制台打不开

- 默认只监听本机：需 SSH 隧道 `ssh -N -L 13210:127.0.0.1:3210 root@<IP>`；
- 本机 3210 被占用：换一个本地端口（如 13210）；
- 端口没监听：`ss -tlnp | grep 3210`，并看 systemd 日志。

## 6. Docker 拉取镜像失败

国内直连 Docker Hub 常超时，可换镜像站：

```bash
docker pull docker.m.daocloud.io/mlikiowa/napcat-docker:latest
docker tag docker.m.daocloud.io/mlikiowa/napcat-docker:latest mlikiowa/napcat-docker:latest
```

拉取中断后重试前，先确认没有多个 `docker pull` 并发（会互相等锁）。

## 7. 宝塔面板 404

宝塔有“安全入口”，根路径固定 404。完整地址用：

```bash
bt default
```

形如 `https://<IP>:28817/<安全入口>`。面板还开启了 IP + User-Agent 验证，curl 直接访问会 404，浏览器正常。

## 8. 日志在哪

| 内容 | 位置 |
|---|---|
| 机器人服务日志 | `journalctl -u qq-agent` |
| 应用文件日志 | `data/logs/qq-agent-YYYY-MM-DD.log` |
| NapCat | `docker logs napcat` |
| systemd 启动失败 | `systemctl status qq-agent` |
