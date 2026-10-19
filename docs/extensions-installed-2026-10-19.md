# 扩展安装记录（2026-10-19）

本次从 7 个压缩包安装并适配 Linux 版，全部加载成功（`broken: 0`）。

| 扩展 | 类型 | 版本 | 默认启用 | 依赖 / 适配说明 |
|---|---|---|---|---|
| agent-reach | skill | 1.0.1 | 是 | 补了 `apiVersion: 1`；网页/B站搜索/RSS/渠道体检，走 `web_fetch` |
| cross-group-memory | skill | 1.1.0 | 是（已手动启用） | 跨群印象 + 信息衰减；数据写入宿主记忆与 `data/memory-curve/` |
| share-card | plugin | 1.1.0 | 是 | 分享卡片/链接正文读取、加好友/入群处理；OCR 默认关闭 |
| speech-to-text-qq | plugin | 1.0.0 | 是（已手动启用） | 走 NapCat `fetch_ptt_text`，不装 whisper；令牌读 `snowluma.httpAccessToken/accessToken` |
| video-frames | plugin | 1.0.1 | 是 | 依赖系统 ffmpeg；新增 `ffmpegPath` 设置（留空走 PATH） |
| affinity-proactive | plugin | 1.1.0 | 是 | 依赖 `skills/affinity` 的好感度存档 `data/affinity.json`；未安装 affinity 时按默认低等级处理 |
| bili-video | plugin | 1.0.1 | 是 | B站链接自动下载转发；已安装 `ffmpeg/ffprobe`（apt） |

## 环境变更

- `apt-get install ffmpeg`：提供 `/usr/bin/ffmpeg`、`/usr/bin/ffprobe`；
- 实测抽帧：3 秒测试视频抽出 3 帧，耗时正常，无错误；
- 未安装 tesseract：share-card 的 OCR 走视觉模型/远程识别，不依赖本地 tesseract。

## 启用状态

- 已启用：agent-reach、cross-group-memory、share-card、speech-to-text-qq、video-frames、affinity-proactive、bili-video；
- 技能/插件页可直接看到并配置；
- affinity-proactive 若要真正按好感度工作，需要另装 `skills/affinity`（当前未提供）。

## 验证

- `POST /api/skills/reload` 后 7 个模块均 `loaded: true`；
- `video.frames.available` 能力存在；
- speech-to-text-qq 的 NapCat 接口 `fetch_ptt_text` 存在（空参数返回 schema 错误，说明路由可用）。
