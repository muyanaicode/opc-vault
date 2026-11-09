#!/bin/bash
# 一键准备：把最近一次「导出」的 vault 复制到 ~/.opc-vault/agent-vault.json，并存入钥匙串
set -euo pipefail
mkdir -p "$HOME/.opc-vault"
LATEST="$(ls -t "$HOME/Downloads"/opc-vault-*.vault.json 2>/dev/null | head -1 || true)"
if [ -n "${1:-}" ]; then LATEST="$1"; fi
if [ -z "$LATEST" ] || [ ! -f "$LATEST" ]; then
  echo "未找到导出文件。请在 OPC Vault 点「导出」，或传入路径：agent/setup.sh /path/to/opc-vault-*.vault.json"; exit 1
fi
cp -f "$LATEST" "$HOME/.opc-vault/agent-vault.json"
echo "已复制导出到 ~/.opc-vault/agent-vault.json"
"$(cd "$(dirname "$0")" && pwd)/install-keychain.sh"
echo "完成。重启 DSH 后即可使用 opc-vault MCP（vault_list_keys / vault_run_with_key / vault_test_key）。"
