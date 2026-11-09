#!/bin/bash
# OPC Vault MCP 启动器：主密码从 macOS 钥匙串读取（不落配置/argv/日志）
set -euo pipefail
SERVICE="${OPC_VAULT_KEYCHAIN_SERVICE:-opc-vault-mcp}"
ACCOUNT="${OPC_VAULT_KEYCHAIN_ACCOUNT:-master}"
if [ -z "${OPC_VAULT_PASSWORD:-}" ]; then
  PW="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w 2>/dev/null || true)"
  if [ -z "$PW" ]; then
    echo "OPC Vault MCP: 未找到钥匙串密码(service=$SERVICE account=$ACCOUNT)。请先运行 agent/install-keychain.sh。" >&2
    exit 1
  fi
  export OPC_VAULT_PASSWORD="$PW"
fi
FILE="${OPC_VAULT_FILE:-$HOME/.opc-vault/agent-vault.json}"
if [ ! -f "$FILE" ]; then
  echo "OPC Vault MCP: 找不到导出文件 $FILE（应用里「导出」后放到该路径，或设 OPC_VAULT_FILE）" >&2
  exit 1
fi
export OPC_VAULT_FILE="$FILE"
exec /usr/bin/env node "$(cd "$(dirname "$0")" && pwd)/vault-mcp.mjs"
