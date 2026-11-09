#!/usr/bin/env node
/* OPC Vault · 本地 Agent 桥
 * 解密「导出」的 opc-vault-*.vault.json（整库加密），供本地 Agent 按名取用：
 *   OPC_VAULT_PASSWORD='<主密码>' node agent/vault-bridge.mjs list --file <vault.json>
 *   OPC_VAULT_PASSWORD='<主密码>' node agent/vault-bridge.mjs run --file <vault.json> --key OPENAI_API_KEY -- <命令...>
 * 安全：list 只打印 名称/分类/服务商/环境变量，绝不打印明文；run 仅把指定 Key 注入子进程 env，密钥不落日志、不进模型上下文。
 * 主密码取自环境变量 OPC_VAULT_PASSWORD（不落 argv / 不落日志）。
 */
import { webcrypto as crypto } from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const te = new TextEncoder(), td = new TextDecoder();
const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const ITER = 600000;

function arg(name){ const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i+1] : null; }
function afterDash(){ const i = process.argv.indexOf('--'); return i >= 0 ? process.argv.slice(i+1) : []; }

async function deriveKEK(pw, salt){
  const base = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations:ITER, hash:'SHA-256' }, base, { name:'AES-GCM', length:256 }, false, ['wrapKey','unwrapKey']);
}
async function decryptVault(pw, file){
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!j || j.app !== 'opc-vault' || !j.meta || !j.meta.wrappedDEK || !j.vault) throw new Error('不是有效的 OPC Vault 备份文件');
  const kek = await deriveKEK(pw, b64(j.meta.saltB64));
  const w = j.meta.wrappedDEK;
  const dek = await crypto.subtle.unwrapKey('raw', b64(w.wrapped), kek, { name:'AES-GCM', iv:b64(w.iv) }, { name:'AES-GCM', length:256 }, true, ['encrypt','decrypt']);
  const v = j.vault;
  const pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv:b64(v.iv) }, dek, b64(v.ct));
  return JSON.parse(td.decode(pt));
}
function getPw(){
  const pw = process.env.OPC_VAULT_PASSWORD;
  if (!pw) { console.error('缺少 OPC_VAULT_PASSWORD 环境变量（主密码）。出于安全不使用命令行参数传密码。'); process.exit(2); }
  return pw;
}
async function main(){
  const cmd = process.argv[2];
  const file = arg('--file');
  if (!cmd || cmd === 'help' || !file) { console.log('用法: OPC_VAULT_PASSWORD=*** node agent/vault-bridge.mjs <list|run> --file <opc-vault-*.vault.json> [--key ENV -- 命令...]'); return; }
  const data = await decryptVault(getPw(), file);
  const keys = data.apiKeys || [];
  if (cmd === 'list') {
    console.log('可用密钥（不显示明文）  共 ' + keys.length + ' 个');
    keys.forEach((k) => console.log('- [' + (k.category || '') + '] ' + (k.name || '') + '  <' + (k.envName || '(无env)') + '>  ' + (k.provider || '')));
    return;
  }
  if (cmd === 'run') {
    const want = arg('--key'); const rest = afterDash();
    if (!want) { console.error('缺少 --key <环境变量名>'); process.exit(2); }
    if (!rest.length) { console.error('缺少命令：在 -- 之后'); process.exit(2); }
    const k = keys.find((x) => x.envName === want) || keys.find((x) => x.name === want);
    if (!k || !k.value) { console.error('未找到可用的密钥：' + want); process.exit(3); }
    const env = Object.assign({}, process.env); env[k.envName || want] = k.value;
    const child = spawn(rest[0], rest.slice(1), { env, stdio: 'inherit' });
    child.on('exit', (code, sig) => process.exit(code == null ? (sig ? 1 : 0) : code));
    return;
  }
  console.error('未知命令: ' + cmd); process.exit(2);
}
main().catch((e) => { console.error('错误: ' + (e && e.message ? e.message : e)); process.exit(1); });
