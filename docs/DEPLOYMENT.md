# 部署文档（Linux / Ubuntu 22.04）

本文以一台全新的 Ubuntu 22.04 x86_64 服务器为例，从零部署到可用。

> 生产环境建议使用独立用户运行 Node 进程，NapCat 用 Docker 隔离。
> 下列命令默认以 root 执行；`sudo -u qqagent` 用于以服务用户身份操作。

---

## 1. 安装 Node.js 20

```bash
# 使用国内镜像下载官方二进制包
V=$(curl -s https://registry.npmmirror.com/-/binary/node/latest-v20.x/ \
    | grep -o 'node-v20[0-9.]*-linux-x64.tar.xz' | sort -V | tail -1)
curl -fL -o /tmp/node20.tar.xz "https://registry.npmmirror.com/-/binary/node/latest-v20.x/$V"
mkdir -p /opt/node20
tar -xJf /tmp/node20.tar.xz -C /opt/node20 --strip-components=1
ln -sf /opt/node20/bin/node /usr/local/bin/node
ln -sf /opt/node20/bin/npm  /usr/local/bin/npm
ln -sf /opt/node20/bin/npx  /usr/local/bin/npx

node -v   # 期望 v20.x
npm config set registry https://registry.npmmirror.com --location=global
```

## 2. 创建运行用户与目录

```bash
useradd -r -m -d /opt/qq-agent -s /usr/sbin/nologin qqagent
mkdir -p /opt/qq-agent
```

## 3. 获取代码并安装依赖

```bash
git clone <本仓库地址> /opt/qq-agent
cd /opt/qq-agent
npm install --omit=dev
chown -R qqagent:qqagent /opt/qq-agent
```

如果服务器访问 GitHub 困难，可在本地打包后上传（不要上传 `data/`、`node_modules/`）。

## 4. 部署 NapCat（Docker）

```bash
mkdir -p /opt/napcat/config /opt/napcat/qq /opt/napcat/plugins
TOKEN=$(openssl rand -hex 12)
echo "$TOKEN" > /opt/napcat/token && chmod 600 /opt/napcat/token

docker run -d --name napcat --restart unless-stopped \
  -e NAPCAT_UID=0 -e NAPCAT_GID=0 -e ACCOUNT=<你的机器人QQ号> \
  -p 127.0.0.1:3000:3000 -p 127.0.0.1:3001:3001 -p 127.0.0.1:6099:6099 \
  -v /opt/napcat/config:/app/napcat/config \
  -v /opt/napcat/qq:/app/.config/QQ \
  -v /opt/napcat/plugins:/app/napcat/plugins \
  mlikiowa/napcat-docker:latest
```

> 国内拉取失败时，可先用镜像站拉取再改标签，例如：
> `docker pull docker.m.daocloud.io/mlikiowa/napcat-docker:latest`
> `docker tag docker.m.daocloud.io/mlikiowa/napcat-docker:latest mlikiowa/napcat-docker:latest`

首次登录：手机 QQ 扫码。

```bash
docker logs napcat --tail 30
```

日志里会给出二维码路径与解码 URL；也可以访问 WebUI（本机）：

```
http://127.0.0.1:6099/webui?token=<webui token，见 /opt/napcat/config/webui.json>
```

登录成功后，`ACCOUNT` 参数会让后续重启自动快速登录，无需再扫码。

## 5. 配置 OneBot v11

编辑 `/opt/napcat/config/onebot11_<QQ号>.json`（首次登录后生成）：

```json
{
  "network": {
    "httpServers": [{
      "name": "http", "enable": true, "host": "0.0.0.0", "port": 3000,
      "token": "<TOKEN>", "enableCors": true, "enableWebsocket": false,
      "messagePostFormat": "array", "debug": false
    }],
    "websocketServers": [{
      "name": "ws", "enable": true, "host": "0.0.0.0", "port": 3001,
      "token": "<TOKEN>", "reportSelfMessage": false,
      "messagePostFormat": "array", "enableForcePushEvent": true,
      "debug": false, "heartInterval": 30000
    }],
    "httpClients": [], "websocketClients": [], "plugins": []
  },
  "musicSignUrl": "",
  "enableLocalFile2Url": false,
  "parseMultMsg": false
}
```

重启生效：

```bash
docker restart napcat
curl -s "http://127.0.0.1:3000/get_login_info?access_token=<TOKEN>"
```

返回 `"user_id"` 即正常。

## 6. 配置机器人

```bash
cd /opt/qq-agent
mkdir -p data
cp config/config.example.json data/config.json
```

至少修改：

- `api.apiKey`：你的 AI Key；
- `api.baseUrl` / `api.model`：接口地址与模型名；
- `snowluma.wsUrl`：`ws://127.0.0.1:3001`；
- `snowluma.httpUrl`：`http://127.0.0.1:3000`；
- `snowluma.accessToken` / `httpAccessToken`：与 OneBot 的 Token 一致；
- `snowluma.autoLaunch`：`false`（Linux 下由 Docker 管理 NapCat）；
- `persona.*`：机器人昵称与角色卡；
- `extensions.hotReload`：**false**。

```bash
chown qqagent:qqagent data/config.json
```

## 7. 安装 systemd 服务

```bash
cp deploy/qq-agent.service /etc/systemd/system/qq-agent.service
mkdir -p /etc/systemd/system/qq-agent.service.d
cat > /etc/systemd/system/qq-agent.service.d/limits.conf <<'EOF'
[Service]
Environment=NODE_OPTIONS=--max-old-space-size=640
EOF
systemctl daemon-reload
systemctl enable --now qq-agent
systemctl status qq-agent --no-pager
```

## 8. 验证

```bash
curl -s http://127.0.0.1:3210/api/status
journalctl -u qq-agent -n 50 --no-pager
docker ps --filter name=napcat
```

期望：`"connected":true` 且 `"self":{"userId":"..."}`。

如果要验证消息：用另一个 QQ 给机器人发私聊，观察日志与回复。

## 9. 控制台访问

默认只监听 `127.0.0.1:3210`，推荐 SSH 隧道：

```bash
ssh -N -L 13210:127.0.0.1:3210 root@<服务器IP>
# 浏览器打开 http://127.0.0.1:13210
```

如需公网访问，必须加认证（见 `deploy/nginx-qq-agent.conf.example`），不要直接暴露 3210/6099。

## 10. 更新与回滚

```bash
scripts/backup.sh          # 先备份 data/
git pull
npm install --omit=dev
systemctl restart qq-agent
```

回滚：

```bash
git log --oneline -5
git checkout <上一个稳定提交>
npm install --omit=dev
systemctl restart qq-agent
```

## 11. 资源建议

- 2 核 2G：可运行，但建议 2–4GB swap，且不要再跑 MySQL/Redis 等重服务；
- 常驻内存：Node 约 250MB，NapCat 约 300–500MB；
- 磁盘：代码+依赖约 100MB，Docker 镜像约 1.5GB，`data/` 随聊天量增长。
