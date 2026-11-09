#!/usr/bin/env node
/* OPC Vault MCP server（stdio, JSON-RPC 2.0，无第三方 SDK）
 * 环境变量：OPC_VAULT_FILE=<导出的 vault.json>、OPC_VAULT_PASSWORD=<主密码>
 * 工具：
 *   vault_list_keys {tag?,subject?,agent?} → 只返回元数据（不含明文）
 *   vault_run_with_key {key, executable, args?, agent?} → 注入 env 运行，返回 exit/stdout/stderr
 *   vault_test_key {key, agent?} → 调服务 /models 返回状态码（不打印 Key）
 * 安全：模型/日志不接触明文 Key；明文仅在本地解密内存与子进程 env。
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
  'Stripe': { url: 'https://api.stripe.com/v1/balance', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
  'GitHub': { url: 'https://api.github.com/user', headers: (k) => ({ Authorization: 'token ' + k }) },
  'Cloudflare': { url: 'https://api.cloudflare.com/client/v4/user/tokens/verify', headers: (k) => ({ Authorization: 'Bearer ' + k }) }
};
let DATA = null;
async function deriveKEK(pw, salt){ const base = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveKey']); return crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations:ITER, hash:'SHA-256' }, base, { name:'AES-GCM', length:256 }, false, ['wrapKey','unwrapKey']); }
async function load(){
  if (DATA) return DATA;
  const file = process.env.OPC_VAULT_FILE, pw = process.env.OPC_VAULT_PASSWORD;
  if (!file || !pw) throw new Error('缺少 OPC_VAULT_FILE / OPC_VAULT_PASSWORD');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const kek = await deriveKEK(pw, b64(j.meta.saltB64)); const w = j.meta.wrappedDEK;
  const dek = await crypto.subtle.unwrapKey('raw', b64(w.wrapped), kek, { name:'AES-GCM', iv:b64(w.iv) }, { name:'AES-GCM', length:256 }, true, ['encrypt','decrypt']);
  const pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv:b64(j.vault.iv) }, dek, b64(j.vault.ct));
  DATA = JSON.parse(td.decode(pt)); return DATA;
}
function allowed(k, agent){ if (!k.allowAgents) return true; if (!agent) return false; return k.allowAgents.split(/[,，\s]+/).filter(Boolean).indexOf(agent) >= 0; }
function matchSubject(data, k, subj){ if (!subj) return true; if (k.subjectId === subj) return true; const s = (data.subjects || []).find((x) => x.id === subj || (x.values && x.values.companyName === subj)); return !!(s && k.subjectId === s.id); }
const TOOLS = [
  { name: 'vault_list_keys', description: '列出 OPC Vault 中的 API Key 元数据（名称/分类/服务商/环境变量/标签），绝不返回明文。', inputSchema: { type: 'object', properties: { tag: { type: 'string' }, subject: { type: 'string' }, agent: { type: 'string' } }, additionalProperties: false } },
  { name: 'vault_run_with_key', description: '用某个 Key 注入环境变量运行本地命令（明文只在子进程 env，不回显）。', inputSchema: { type: 'object', properties: { key: { type: 'string', description: '环境变量名，如 OPENAI_API_KEY' }, executable: { type: 'string' }, args: { type: 'array', items: { type: 'string' } }, agent: { type: 'string' } }, required: ['key', 'executable'], additionalProperties: false } },
  { name: 'vault_test_key', description: '测试某个 Key 连通性（调服务 /models，返回状态码，不打印 Key）。', inputSchema: { type: 'object', properties: { key: { type: 'string' }, agent: { type: 'string' } }, required: ['key'], additionalProperties: false } }
];
async function callTool(name, a){
  const data = await load(); const keys = (data.apiKeys || []).filter((k) => matchSubject(data, k, a.subject) && (!a.tag || String(k.tags || '').split(/[,，\s]+/).indexOf(a.tag) >= 0));
  if (name === 'vault_list_keys') {
    return keys.map((k) => ({ name: k.name, category: k.category, provider: k.provider, envName: k.envName, tags: k.tags || '', expiresAt: k.expiresAt || '', allowAgents: k.allowAgents || '', hasValue: !!k.value }));
  }
  const k = keys.find((x) => x.envName === a.key) || keys.find((x) => x.name === a.key);
  if (!k) throw new Error('未找到 Key: ' + a.key);
  if (!allowed(k, a.agent)) throw new Error('该 Key 未授权给 Agent: ' + (a.agent || '(未指定)'));
  if (name === 'vault_test_key') {
    const ep = ENDPOINTS[k.provider]; if (!ep) return { skipped: true, message: '无内置测试端点：' + (k.provider || k.name) };
    const url = typeof ep.url === 'function' ? ep.url(k.value) : ep.url; const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    try { const r = await fetch(url, { method: 'GET', headers: ep.headers(k.value), signal: ctrl.signal }); clearTimeout(t); return { status: r.status, ok: r.ok, provider: k.provider }; }
    catch (e) { clearTimeout(t); throw new Error('请求失败: ' + (e && e.message ? e.message : e)); }
  }
  if (name === 'vault_run_with_key') {
    const env = Object.assign({}, process.env); env[k.envName] = k.value;
    const args = Array.isArray(a.args) ? a.args : [];
    return await new Promise((resolve) => {
      const ch = spawn(a.executable, args, { env }); let out = '', err = '';
      ch.stdout.on('data', (d) => out += d.toString()); ch.stderr.on('data', (d) => err += d.toString());
      ch.on('exit', (code) => resolve({ exitCode: code, stdout: out, stderr: err }));
      ch.on('error', (e) => resolve({ exitCode: null, error: e.message }));
    });
  }
  throw new Error('未知工具: ' + name);
}
function send(obj){ process.stdout.write(JSON.stringify(obj) + '\n'); }
let buf = '';
process.stdin.on('data', async (chunk) => {
  buf += chunk.toString(); let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1); if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch (e) { continue; }
    if (msg.method === 'initialize') { send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'opc-vault', version: '1.0.0' } } }); continue; }
    if (msg.method === 'notifications/initialized' || msg.method === 'initialized') continue;
    if (msg.method === 'ping') { send({ jsonrpc: '2.0', id: msg.id, result: {} }); continue; }
    if (msg.method === 'tools/list') { send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }); continue; }
    if (msg.method === 'tools/call') {
      const { name, arguments: a } = msg.params || {};
      try { const r = await callTool(name, a || {}); send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(r) }] } }); }
      catch (e) { send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'ERROR: ' + (e && e.message ? e.message : e) }], isError: true } }); }
      continue;
    }
    if (msg.id != null) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found: ' + msg.method } });
  }
});
process.stderr.write('opc-vault MCP server ready\n');
