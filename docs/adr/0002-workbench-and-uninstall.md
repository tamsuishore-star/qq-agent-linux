# ADR-0002：新版工作台与模块卸载语义

- 状态：已接受
- 日期：2026-10-19
- 决策人：项目所有者 + Harness

## 背景

V1.0 工作台继承 Windows 版布局：顶部页签拥挤、含 Windows 专用入口、无删除能力、模块来源不可区分。V1.1.0 要求独立设计语言与真实卸载能力。

## 决策

### 1. 新版工作台独立目录，先挂 `/next`

- 新 UI 在 `ui-next/`，由 `app.js` 静态服务以 `/next` 前缀提供；
- 旧 `ui/` 完全不动，默认根路径仍是旧版；
- 验证通过后再切换默认，旧版保留到 `v1.1.0` 发布。

### 2. 设计语言

- 深色默认、浅色可切换；主题用 CSS 变量，不引第三方 UI 库；
- 左侧栏导航（总览 / 能力 / 日志 / 关于），顶部栏放状态与操作；
- 所有状态与数字来自真实接口（`/api/status`、`/api/overview`、`/api/modules`、`/api/logs`、`/api/version`）；
- 无构建工具、无新依赖；页面脚本按职责拆分，单文件控制在 500 行内。

### 3. 模块来源与卸载

- `config/builtin-modules.json`：V1.0 内置模块快照（44 个），只允许禁用；
- `data/modules-registry.json`：用户安装登记（市场安装时写入），只有登记过的模块可卸载；
- 卸载 = 停用 → 目录移入 `data/.trash/<时间戳>/` → 清 `config.skills[id]` → 注销登记 → 重扫；
- 拒绝符号链接、越界路径、非法 id；路径从已加载模块的 `relDir` 推导，不接受前端传路径；
- 暂不提供彻底删除（后续只对回收站开放）。

### 4. 外部入口

- `kondius.cn` 相关入口标注“外部资源”，不占主导航；
- SnowLuma / QQ 便携端入口从新 UI 移除，后端路由保留给未来 Windows 版。

## 影响

- 后端：新增 `GET /api/modules`、`DELETE /api/modules/:kind/:id`、`src/modules/*`；
- 静态服务：`/next` 指向 `ui-next/`；
- 数据：新增两个 JSON（内置快照入库，安装登记不入库）；
- 旧 UI 与现有功能不受影响。

## 验证

隔离 staging 实测：`/next` 200、`/api/modules` 正常、fixture 模块卸载后目录进回收站且配置/登记清空、内置模块卸载返回 403。

## 回滚

- 停用 `/next`：还原 `src/app.js` 与 `src/routes.js`，重启；`ui-next/` 可保留不影响；
- 卸载误操作：从 `data/.trash/` 把目录移回 `skills|plugins/`，并在 `data/modules-registry.json` 补登记，重扫。
