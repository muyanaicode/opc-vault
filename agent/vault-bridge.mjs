#!/usr/bin/env node
/* OPC Vault · 本地 Agent 桥 / CLI
 * 用法（主密码只走环境变量 OPC_VAULT_PASSWORD，不进 argv/日志）：
 *   list  [--tag T] [--subject S] [--agent A]
 *   run   --key ENV [--agent A] -- <命令...>
 *   test  --key ENV
 * 安全：list 只输出名称/分类/服务商/环境变量/标签；run 只把指定 Key 注入子进程 env；test 只调用服务 /models 返回状态码，不打印 Key。
 */
import { webcrypto as crypto } from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const te = new TextEncoder(), td = new TextDecoder();
const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const ITER = 600000;
const ENDPOINTS = {
  'OpenAI': { url: 'https://api.openai.com/v1/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
  'Anthropic': { url: 'https://api.anthropic.com/v1/models', headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }) },
  'DeepSeek': { url: 'https://api.deepseek.com/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
  'Google Gemini': { url: (k) => 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(k), headers: () => ({}) },
  'Moonshot 月之暗面': { url: 'https://api.moonshot.cn/v1/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
  '阿里云百炼/通义': { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
  '智谱 GLM': { url: 'https://open.bigmodel.cn/api/paas/v4/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
  'xAI Grok': { url: 'https://api.x.ai/v1/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
  'Mistral': { url: 'https://api.mistral.ai/v1/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
  'OpenRouter': { url: 'https://openrouter.ai/api/v1/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
  'Stripe': { url: 'https://api.stripe.com/v1/balance', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
  'GitHub': { url: 'https://api.github.com/user', headers: (k) => ({ Authorization: 'token ' + k }) },
  'Cloudflare': { url: 'https://api.cloudflare.com/client/v4/user/tokens/verify', headers: (k) => ({ Authorization: 'Bearer ' + k }) }
};
function arg(name){ const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i+1] : null; }
function afterDash(){ const i = process.argv.indexOf('--'); return i >= 0 ? process.argv.slice(i+1) : []; }
async function deriveKEK(pw, salt){ const base = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations:ITER, hash:'SHA-256' }, base, { name:'AES-GCM', length:256 }, false, ['wrapKey','unwrapKey']); }
async function decryptVault(pw, file){
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!j || j.app !== 'opc-vault' || !j.meta || !j.meta.wrappedDEK || !j.vault) throw new Error('不是有效的 OPC Vault 备份文件');
  const kek = await deriveKEK(pw, b64(j.meta.saltB64)); const w = j.meta.wrappedDEK;
  const dek = await crypto.subtle.unwrapKey('raw', b64(w.wrapped), kek, { name:'AES-GCM', iv:b64(w.iv) }, { name:'AES-GCM', length:256 }, true, ['encrypt','decrypt']);
  const v = j.vault; const pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv:b64(v.iv) }, dek, b64(v.ct));
  return JSON.parse(td.decode(pt));
}
function getPw(){ const pw = process.env.OPC_VAULT_PASSWORD; if (!pw) { console.error('缺少 OPC_VAULT_PASSWORD（主密码），不使用命令行传密码。'); process.exit(2); } return pw; }
function matchSubject(data, k, subj){ if (!subj) return true; if (k.subjectId === subj) return true; const s = (data.subjects || []).find((x) => x.id === subj || (x.values && x.values.companyName === subj)); return !!(s && k.subjectId === s.id); }
function allowed(k, agent){ if (!k.allowAgents) return true; if (!agent) return false; return k.allowAgents.split(/[,，\s]+/).filter(Boolean).indexOf(agent) >= 0; }
async function main(){
  const cmd = process.argv[2]; const file = arg('--file');
  if (!cmd || cmd === 'help' || !file) { console.log('用法: OPC_VAULT_PASSWORD=*** node agent/vault-bridge.mjs <list|run|test> --file <vault.json> [--key ENV] [--tag T] [--subject S] [--agent A] [-- 命令]'); return; }
  const data = await decryptVault(getPw(), file);
  const keys = (data.apiKeys || []).filter((k) => matchSubject(data, k, arg('--subject')) && (!arg('--tag') || String(k.tags || '').split(/[,，\s]+/).indexOf(arg('--tag')) >= 0));
  if (cmd === 'list') {
    console.log('可用密钥（不显示明文） 共 ' + keys.length + ' 个');
    keys.forEach((k) => console.log('- [' + (k.category || '') + '] ' + (k.name || '') + '  <' + (k.envName || '(无env)') + '>  ' + (k.provider || '') + (k.tags ? '  #' + k.tags : '') + (k.allowAgents ? '  agent:' + k.allowAgents : '')));
    return;
  }
  const want = arg('--key'); const agent = arg('--agent');
  const k = keys.find((x) => x.envName === want) || keys.find((x) => x.name === want);
  if (cmd === 'run') {
    const rest = afterDash();
    if (!want) { console.error('缺少 --key'); process.exit(2); } if (!rest.length) { console.error('缺少命令（-- 之后）'); process.exit(2); }
    if (!k || !k.value) { console.error('未找到密钥：' + want); process.exit(3); }
    if (!allowed(k, agent)) { console.error('该 Key 未授权给 Agent: ' + (agent || '(未指定)')); process.exit(4); }
    const env = Object.assign({}, process.env); env[k.envName || want] = k.value;
    const child = spawn(rest[0], rest.slice(1), { env, stdio: 'inherit' });
    child.on('exit', (code, sig) => process.exit(code == null ? (sig ? 1 : 0) : code));
    return;
  }
  if (cmd === 'test') {
    if (!k || !k.value) { console.error('未找到密钥：' + want); process.exit(3); }
    if (!allowed(k, agent)) { console.error('未授权给 Agent: ' + (agent || '(未指定)')); process.exit(4); }
    const ep = ENDPOINTS[k.provider]; if (!ep) { console.error('该服务商无内置测试端点：' + (k.provider || k.name)); process.exit(5); }
    const url = typeof ep.url === 'function' ? ep.url(k.value) : ep.url; const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    try { const r = await fetch(url, { method: 'GET', headers: ep.headers(k.value), signal: ctrl.signal }); clearTimeout(t); console.log('status=' + r.status + ' ok=' + r.ok + ' provider=' + k.provider); process.exit(0); }
    catch (e) { clearTimeout(t); console.error('请求失败: ' + (e && e.message ? e.message : e)); process.exit(1); }
  }
  console.error('未知命令: ' + cmd); process.exit(2);
}
main().catch((e) => { console.error('错误: ' + (e && e.message ? e.message : e)); process.exit(1); });
