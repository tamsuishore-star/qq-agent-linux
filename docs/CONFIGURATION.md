# 配置说明

真实配置：`data/config.json`（已被 `.gitignore` 排除）。
模板：[config/config.example.json](../config/config.example.json)。

> 修改配置后执行 `systemctl restart qq-agent` 生效。
> 修改 `extensions.hotReload` 除外——它应始终为 `false`。

---

## 1. AI 接口

| 字段 | 说明 |
|---|---|
| `api.baseUrl` | OpenAI 兼容接口地址，如 `https://api.deepseek.com` |
| `api.apiKey` | 接口密钥（明文，仅保存在服务器） |
| `api.model` | 默认模型名 |
| `api.vision` / `api.video` | 是否启用图片/视频理解 |
| `api.temperature` / `api.maxRounds` | 采样温度、单轮最大工具轮数 |
| `providers[]` | 多提供商（直连/中转站），每项含 `id`、`baseURL`、`models` |
| `dshProviderKeys` | 各提供商真实 Key，**优先级高于 `api.apiKey`** |

### 更换 API Key 的两种方式

1. **控制台**：设置 → 模型 / 提供商 → 对应提供商 → 修改 Key → 保存。  
   保存的是 `dshProviderKeys`，优先生效，无需重启。
2. **直接改文件**：编辑 `data/config.json` 的 `api.apiKey` 与 `dshProviderKeys`，然后重启。

> 不要把 Key 写进 README、Issue、截图或提交记录。

---

## 2. OneBot / NapCat

| 字段 | 说明 |
|---|---|
| `snowluma.wsUrl` | OneBot WebSocket 地址，如 `ws://127.0.0.1:3001` |
| `snowluma.httpUrl` | OneBot HTTP API 地址，如 `http://127.0.0.1:3000` |
| `snowluma.accessToken` | WebSocket 访问令牌 |
| `snowluma.httpAccessToken` | HTTP 访问令牌 |
| `snowluma.autoLaunch` | 是否由本程序拉起 QQ 端；Linux 下应为 `false` |

字段名沿用上游的 `snowluma` 命名，实际指向 NapCat，不影响使用。

---

## 3. 人设

| 字段 | 说明 |
|---|---|
| `persona.botName` | 机器人名字 |
| `persona.selfNickname` | 自称 |
| `persona.roleText` | 角色卡（Markdown，可很长） |
| `persona.participation` | 参与度 0–4 |
| `persona.customRules` | 额外规则 |
| `persona.systemPromptOverride` | 完全覆盖系统提示词 |
| `customPersonas` / `personaByChat` | 多套人设、按会话绑定 |

人设属于个人创作内容，建议只保存在服务器 `data/` 与私人备份中。

---

## 4. 会话与记忆

| 字段 | 说明 |
|---|---|
| `memory.enabled` | 是否启用长期记忆 |
| `allow` / `deny` | 允许/禁止的会话（群号或 QQ 号） |
| `allowAllWhenEmpty` | 列表为空时是否对所有会话生效 |
| `wakeDelayMs` / `drainDelayMs` | 唤醒合并与冷静窗口 |
| `maxConcurrentRuns` | 最大并发处理数（2G 机器建议 1–2） |

---

## 5. 服务与界面

| 字段 | 说明 |
|---|---|
| `server.port` | 控制台端口，默认 3210 |
| `server.token` | 控制台访问令牌；留空表示只监听 127.0.0.1 |
| `server.autoStart` | 启动时是否自动开始处理消息 |
| `ui.*` | 界面偏好 |

> `server.token` 不是 HTTPS 替代品。公网访问请用 Nginx + HTTPS + Basic Auth。

---

## 6. 扩展

```json
"extensions": { "hotReload": false }
```

**必须为 `false`**。开启后文件变动会触发技能/插件重载，内存持续上涨（实测 3 分钟内到 1GB 并崩溃）。修改技能后手动 `systemctl restart qq-agent`。

---

## 7. 环境变量

| 变量 | 作用 |
|---|---|
| `QQ_AGENT_PORT` | 覆盖控制台端口 |
| `QQ_AGENT_DATA_DIR` | 覆盖数据目录（默认 `./data`） |
| `NODE_OPTIONS` | 建议 `--max-old-space-size=640`（2G 机器） |

systemd 中的设置见 `deploy/qq-agent.service` 与 `limits.conf`。
