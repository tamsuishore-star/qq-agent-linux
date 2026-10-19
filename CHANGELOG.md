# Changelog

本项目遵循语义化版本：`MAJOR.MINOR.PATCH`。
Linux QQ Agent 的产品版本从 **V1.0.0** 起算；上游 `package.json` 的 `0.4.0` 仅为源码版本号，不代表本项目版本。

## [Unreleased] — V1.1.0 开发中

### 计划（未完成，勿视为已发布）

- 工作台信息架构重构：总览 / 对话 / 记忆 / 能力 / 模型 / 系统
- 失效入口处理：外部服务入口统一标注“外部服务”，新增外部链接页
- Skill / 插件：启用、禁用、重载、详情、状态（物理删除暂不做）
- 稳定性：定位 `Runtime_MapGrow` 相关内存增长；增加运行观测
- 平台边界：`wmic/taskkill/explorer` 收敛到 `src/platform/`
- 工程化：最小测试（node:test）、发布流程

### 已完成（2026-10-19）

- **运维：Node 堆上限 640MB → 960MB**（缓解 OOM，见下）
  - 位置：`/etc/systemd/system/qq-agent.service.d/limits.conf`
  - 原因：2026-10-19 13:43、16:25 两次 `JavaScript heap out of memory`，V8 栈显示 `Runtime_MapGrow`，判断存在持续累积的数据结构
  - 验证：重启后 `active`、OneBot `connected:true`，RSS 约 286MB
  - 回滚：把该值改回 `640`，`systemctl daemon-reload && systemctl restart qq-agent`
  - 遗留：根因未定位，960MB 只是缓冲；需在后续版本用堆快照/内存观测继续排查

## [1.0.0] — 2026-10-19

首个可运行、可回滚的 Linux 部署基线。

- 仓库：`tamsuishore-star/qq-agent-linux`，标签 `v1.0.0`，提交 `a2f08e8`
- 运行：Ubuntu 22.04 / Node 20 / systemd / NapCat（Docker，OneBot v11）
- 功能：私聊、群聊、@/上下文插话、`/退出` 静默、AI 回复、人设、记忆、语音、表情、插件与技能
- 数据：人设与记忆迁移完成；`data/` 不入库
- 文档：`docs/Linux_QQ机器人使用说明与优化指南.md`
- 已知问题：2GB 内存偏紧；控制台无认证；无自动化测试
