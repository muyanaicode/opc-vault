#!/bin/bash
# 把 OPC Vault 主密码存入 macOS 钥匙串（交互输入、不回显、不落盘）
set -euo pipefail
SERVICE="${OPC_VAULT_KEYCHAIN_SERVICE:-opc-vault-mcp}"
ACCOUNT="${OPC_VAULT_KEYCHAIN_ACCOUNT:-master}"
printf '输入 OPC Vault 主密码（不回显）: '; read -r -s PW; echo
if [ -z "$PW" ]; then echo "空密码，取消"; exit 1; fi
security add-generic-password -U -s "$SERVICE" -a "$ACCOUNT" -w "$PW" >/dev/null
unset PW
echo "已存入钥匙串：service=$SERVICE account=$ACCOUNT（MCP 启动时自动读取）"
