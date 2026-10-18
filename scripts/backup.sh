#!/usr/bin/env bash
# 备份 QQ Agent 运行时数据（人设、记忆、会话、表情、插件状态）
# 用法：scripts/backup.sh [输出目录]
set -euo pipefail

APP_DIR="${QQ_AGENT_HOME:-/opt/qq-agent}"
OUT_DIR="${1:-/root}"
KEEP_DAYS="${KEEP_DAYS:-7}"

if [ ! -d "$APP_DIR/data" ]; then
  echo "找不到 $APP_DIR/data，请检查 QQ_AGENT_HOME" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
STAMP="$(date +%F-%H%M)"
FILE="$OUT_DIR/qq-agent-data-$STAMP.tar.gz"

tar czf "$FILE" -C "$APP_DIR" data
chmod 600 "$FILE"

# 清理旧备份
find "$OUT_DIR" -maxdepth 1 -name 'qq-agent-data-*.tar.gz' -mtime "+$KEEP_DAYS" -delete 2>/dev/null || true

echo "备份完成：$FILE"
echo "大小：$(du -h "$FILE" | cut -f1)"
echo "提示：该文件含 API Key 与聊天记录，请妥善保管。"
