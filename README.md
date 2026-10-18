# QQ Agent（Linux 部署版）

> 一个运行在 Linux 服务器上的 QQ AI 聊天机器人：接入 OpenAI 兼容 API，带人设、长期记忆、插件与技能体系，通过浏览器控制台管理。
>
> 本仓库是 **K0nd1us/QQ-agent**（MIT）在 Linux 上实际部署、验证后整理的维护快照，**不是上游官方仓库**。QQ 接入层由上游的 SnowLuma 替换为 **NapCat**，程序以无界面（headless）方式由 systemd 托管运行。

---

## 1. 项目简介

QQ Agent 原本是一个 Windows 桌面程序（Electron 窗口 + Node.js 内核）。本项目把它迁移到 Linux 后：

- 保留全部业务代码（`src/`、`ui/`、`skills/`、`plugins/`）；
- 去掉桌面窗口，改用 `node src/server.js` 无界面运行，浏览器访问控制台；
- QQ 登录与消息收发改由 **NapCat（OneBot v11）** 提供；
- 用 systemd 管理进程，开机自启、崩溃自动重启。

机器人实际具备的能力（已在实际环境中运行验证）：

| 能力 | 状态 |
|---|---|
| 私聊自动回复 | ✅ 已验证 |
| 群聊 @ / 关键词唤醒 / 关键词退出 | ✅ 已验证 |
| 人设（角色卡）与长期记忆 | ✅ 已验证（数据迁移后可用） |
| OpenAI 兼容 API（DeepSeek 等） | ✅ 已验证 |
| 表情包、插件、技能扩展 | ✅ 已验证 |
| 语音收发（TTS/ASR 相关技能） | ✅ 已验证 |

> 不同技能依赖的第三方 API 不同，是否可用取决于对应 Key 与网络环境。

---

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Node.js ≥ 20（ESM） |
| 运行时依赖 | `ws`、`undici`、`js-yaml`（纯 JS，无原生模块） |
| 控制台 | 原生 HTML/CSS/JS，由内置 HTTP 服务提供 |
| QQ 接入 | NapCat（Docker，OneBot v11，HTTP + WebSocket） |
| 进程管理 | systemd |
| 数据 | 本地 JSON 文件（`data/`） |

---

## 3. 架构

```
QQ 客户端（手机/PC）
        │
        ▼
 NapCat 容器（Linux 版 QQ + OneBot v11）
        │  ws://127.0.0.1:3001（仅本机）
        ▼
 QQ Agent（Node.js，headless，systemd）
        │
        ├── 控制台 http://127.0.0.1:3210（建议 SSH 隧道访问）
        ├── 人设 / 记忆 / 会话    → data/
        └── 插件 / 技能          → plugins/ skills/
```

---

## 4. 目录结构

```
.
├── src/                 # 核心代码（服务端、OneBot、LLM、记忆、路由等）
├── ui/                  # 浏览器控制台
├── skills/              # 技能（每个技能一个目录，含 skill.json）
├── plugins/             # 插件（每个插件一个目录，含 plugin.json）
├── assets/              # 图标等静态资源
├── electron/            # 上游桌面入口（Linux 部署不使用）
├── config/              # 配置模板（真实配置在 data/config.json）
├── deploy/              # systemd / Nginx 部署模板
├── docs/                # 部署、配置、排障文档
├── scripts/             # 运维脚本（备份等）
├── data/                # 运行时数据（*不纳入版本控制*）
├── package.json
└── README.md
```

> `data/` 内含 `config.json`（API Key）、聊天记录、记忆、表情缓存，**已被 .gitignore 排除**，需要单独备份与迁移。

---

## 5. 环境要求

- Linux（本项目在 Ubuntu 22.04 x86_64 上验证）
- Node.js ≥ 20
- Docker（运行 NapCat）
- 建议 ≥ 2GB 内存 + 2GB swap（2 核 2G 可运行，但偏紧）
- 可访问：AI API（如 DeepSeek）、NapCat 镜像源

---

## 6. 快速开始（全新 Linux）

> 完整步骤见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

```bash
# 1) 代码
sudo mkdir -p /opt/qq-agent
sudo chown $USER:$USER /opt/qq-agent
git clone <本仓库地址> /opt/qq-agent
cd /opt/qq-agent

# 2) 依赖
npm install --omit=dev

# 3) 配置（从模板复制后填入自己的 Key）
mkdir -p data
cp config/config.example.json data/config.json
# 编辑 data/config.json：api.apiKey / providers[].apiKey / snowluma.accessToken

# 4) 启动
node src/server.js
# 浏览器访问 http://127.0.0.1:3210
```

QQ 侧需要先启动 NapCat 并登录账号，详见部署文档。

---

## 7. 配置说明

真实配置位于 `data/config.json`（不纳入 Git）。关键字段：

| 字段 | 说明 |
|---|---|
| `api.baseUrl` / `api.apiKey` / `api.model` | AI 接口地址、密钥、模型名 |
| `providers[]` | 多提供商配置（支持中转站） |
| `dshProviderKeys` | 各提供商的真实 Key（优先级高于 `api.apiKey`） |
| `snowluma.wsUrl` / `httpUrl` | OneBot v11 的 WebSocket / HTTP 地址（指向 NapCat） |
| `snowluma.accessToken` | OneBot 访问令牌 |
| `persona.*` | 机器人昵称、角色卡、规则 |
| `server.port` | 控制台端口，默认 3210 |
| `extensions.hotReload` | **必须保持 `false`**（见“已知问题”） |

配置模板见 [config/config.example.json](config/config.example.json)，详细说明见 [docs/CONFIGURATION.md](docs/CONFIGURATION.md)。

支持的环境变量：

- `QQ_AGENT_PORT`：控制台端口
- `QQ_AGENT_DATA_DIR`：数据目录（默认 `./data`）

---

## 8. 运行与运维

```bash
systemctl start qq-agent      # 启动
systemctl stop qq-agent       # 停止
systemctl restart qq-agent    # 重启
systemctl status qq-agent     # 状态
journalctl -u qq-agent -f     # 实时日志
journalctl -u qq-agent -n 100 --no-pager   # 最近 100 行
```

健康检查：

```bash
curl -s http://127.0.0.1:3210/api/status
# 期望：{"onebot":{"connected":true,...,"userId":"..."}}
```

NapCat：

```bash
docker ps --filter name=napcat
docker logs napcat --tail 50
docker restart napcat
```

---

## 9. 更新

```bash
cd /opt/qq-agent
git pull
npm install --omit=dev
systemctl restart qq-agent
journalctl -u qq-agent -n 50 --no-pager
```

更新前先备份 `data/`（见下）。

---

## 10. 备份与恢复

```bash
# 备份（默认写到 /root）
scripts/backup.sh

# 手动
tar czf /root/qq-agent-data-$(date +%F).tar.gz -C /opt/qq-agent data
```

恢复：

```bash
systemctl stop qq-agent
tar xzf /root/qq-agent-data-YYYY-MM-DD.tar.gz -C /opt/qq-agent
chown -R qqagent:qqagent /opt/qq-agent/data
systemctl start qq-agent
```

---

## 11. 安全注意事项

- **不要提交 `data/`**：里面有 API Key、聊天记录、记忆。
- 控制台默认只监听 `127.0.0.1`，请通过 SSH 隧道或带认证的反向代理访问，不要直接暴露公网。
- NapCat WebUI（6099）同样只应本机访问。
- 建议使用 QQ 小号；第三方协议存在风控/封号风险。
- 不要在 Issue、日志或截图中粘贴 Key、Token、QQ 密码。
- 详见 [SECURITY.md](SECURITY.md)。

---

## 12. 已知问题

1. **`extensions.hotReload` 必须为 `false`**。开启后每次文件变动都会重载技能/插件，内存持续上涨（实测 3 分钟内涨到 1GB 并反复崩溃）。关闭后稳定在约 250MB。
2. **2 核 2G 资源偏紧**。NapCat + Node 常驻约 700–900MB，建议保留 2–4GB swap，不要在同一台机器上再跑 MySQL 等重服务。
3. **上游桌面功能不适用**：控制台里的 “SnowLuma” 页签在 Linux 下无意义（本项目使用 NapCat），只看 OneBot 连接状态即可。
4. **QQ 登录风控**：新设备/新 IP 登录可能触发验证或踢下线，需要手机 QQ 扫码并完成安全验证。
5. `skills/`、`plugins/` 中部分内容来自社区作者，版权归各自作者所有。

---

## 13. 后续方向

- 控制台加访问认证（Nginx + HTTPS + Basic Auth 或私有组网）
- 增加基础自动化测试与 CI
- 拆分 `.env` / 配置读取，减少明文 Key 落盘
- 插件目录瘦身与按需加载，降低内存基线

---

## 14. 来源与许可

- 上游项目：[K0nd1us/QQ-agent](https://github.com/K0nd1us/QQ-agent)（MIT）
- 本仓库：在其基础上完成 Linux 部署、NapCat 接入、运行验证与文档整理
- 许可证：[LICENSE](LICENSE)（MIT，保留原作者版权声明）
- 上游原始说明已保留在 [docs/UPSTREAM_README.md](docs/UPSTREAM_README.md)
- NapCat 为独立第三方项目，本仓库不包含其代码
