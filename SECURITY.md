# 安全说明

## 1. 敏感数据边界

以下内容**不得**提交到 Git、不得发到聊天/Issue/截图：

- `data/config.json`（含 AI API Key、OneBot Token）
- `data/sessions/`、`data/memory*/`、`data/messages/`（聊天记录与记忆）
- NapCat 的 `config/`、`qq/` 数据（登录态）
- 服务器 SSH 私钥、宝塔账号密码、GitHub Token
- `.env` 及任何真实凭据文件

仓库通过 `.gitignore` 排除了上述路径，但**不能只依赖 .gitignore**：提交前请用 `git status` 与 `git ls-files` 复核。

## 2. 网络暴露面

| 端口 | 用途 | 建议 |
|---|---|---|
| 3210 | 机器人控制台 | 仅监听 127.0.0.1，通过 SSH 隧道或带认证的反代访问 |
| 3000/3001 | OneBot HTTP/WS | 仅监听 127.0.0.1 |
| 6099 | NapCat WebUI | 仅监听 127.0.0.1，用完即关 |
| 22 | SSH | 限制来源 IP，禁用密码登录（可选） |

公网访问控制台的最低要求：

1. HTTPS（有效证书）；
2. 一层独立认证（HTTP Basic Auth 或 OAuth）；
3. 不要把 NapCat WebUI 暴露到公网；
4. 建议再加 fail2ban 或访问频率限制。

## 3. 凭据管理

- API Key 只保存在服务器 `data/config.json`，权限 `600`，属主为运行用户；
- 更换 Key 后确认旧 Key 已在服务商侧吊销；
- 不要把 Token 写进 Remote URL、README、提交信息；
- 如果怀疑泄露，立即轮换并把 `data/config.json` 从备份中清理。

## 4. 平台风险

QQ 机器人使用第三方协议（NapCat），存在被风控、限制登录或封号的可能。请使用小号，并自行承担相应风险。

## 5. 漏洞反馈

本项目为私人维护仓库，如发现问题请直接通过仓库 Issue（私有）说明，不要在公开渠道披露 Token 或账号信息。
