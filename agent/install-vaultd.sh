#!/bin/bash
set -euo pipefail
REPO="/Users/clarkfan/projects/opc-vault"
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { echo "node not found"; exit 1; }
mkdir -p "$HOME/.opc-vault"
PLIST="$HOME/Library/LaunchAgents/com.opcvault.vaultd.plist"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.opcvault.vaultd</string>
  <key>ProgramArguments</key><array><string>$NODE_BIN</string><string>$REPO/server.mjs</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key><dict><key>PORT</key><string>5240</string><key>HOST</key><string>127.0.0.1</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.opc-vault/vaultd.log</string>
  <key>StandardErrorPath</key><string>$HOME/.opc-vault/vaultd.err.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/com.opcvault.vaultd" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed: $PLIST"
