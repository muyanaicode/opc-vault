/**
 * Host half of the OPC Vault bundle.
 *
 * Exposes one authenticated web route `/plugins/opc-vault/recognize` that turns a
 * pasted blob of enterprise info into structured JSON using the Harness's local
 * LLM (`ctx.llm` with the current default model). The Client half posts to this
 * same-origin route ("AI 识别（本地模型）"), then imports the result. If the route
 * or model is unavailable the Client transparently falls back to its offline
 * rule-based parser, so a missing model never breaks the panel.
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROUTE_PATH = '/plugins/opc-vault/recognize';
const STATE_ROUTE = '/plugins/opc-vault/state';
const VAULT_DIR = process.env.OPC_VAULT_DIR || join(homedir(), '.opc-vault');
const VAULT_FILE = process.env.OPC_VAULT_FILE || join(VAULT_DIR, 'vault.json');
const MAX_BODY = 1_000_000;
const MODEL_TIMEOUT_MS = 45_000;

const SYSTEM_PROMPT = [
  '你是中国企业资料结构化解析器。',
  '输入是用户粘贴的杂乱文本，可能没有换行、没有字段标签，也可能包含多家公司、表格或多段说明。',
  '请把它解析为一个 JSON 数组：每个元素代表一家企业，键用中文，尽量填充下列字段（没有的留空、不要臆造）：',
  '公司名称、统一社会信用代码、法定代表人、法人手机、法人身份证号、注册资本、成立日期、注册地址、经营范围、',
  '基本户开户行、账号、基本户密码、一般户开户行、一般户账号、一般户密码、',
  '电子税务局账号、电子税务局密码、个税密码、社保账号、社保密码、公积金账号、公积金密码、所在地区。',
  '区分「基本户」与「一般户」：出现“一般户”字样的银行/账号归一般户，否则归基本户。',
  '只输出 JSON 数组本身：不要解释、不要 Markdown 代码块、不要多余文字。',
].join('');

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve(value);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { done(new Error('request body too large')); try { req.destroy(); } catch (e) {} return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return done(null, {});
      try { done(null, JSON.parse(raw)); } catch (e) { done(new Error('invalid JSON body')); }
    });
    req.on('aborted', () => done(new Error('request aborted')));
    req.on('error', (e) => done(e));
  });
}

async function runModel(ctx, text) {
  const llm = ctx.get('llm');
  if (!llm || typeof llm.stream !== 'function') throw new Error('llm service unavailable');
  const modelSvc = ctx.get('agentDefaultModel');
  const sel = modelSvc && typeof modelSvc.currentSelection === 'function' ? modelSvc.currentSelection() : null;
  if (!sel || !sel.provider || !sel.model) throw new Error('no default model selected');

  const ac = new AbortController();
  const timer = setTimeout(() => { try { ac.abort(); } catch (e) {} }, MODEL_TIMEOUT_MS);
  let out = '';
  try {
    const stream = llm.stream({
      provider: sel.provider,
      model: sel.model,
      system: SYSTEM_PROMPT,
      temperature: 0,
      signal: ac.signal,
      messages: [{ role: 'user', content: [{ type: 'text', text: String(text) }] }],
    });
    for await (const ch of stream) {
      if (!ch) continue;
      if (ch.type === 'error') throw new Error((ch.error && ch.error.message) || 'model error');
      if (typeof ch.text === 'string' && (ch.type === 'text-delta' || ch.type === 'text' || ch.type === 'content' || ch.type === undefined)) out += ch.text;
      else if (typeof ch.delta === 'string') out += ch.delta;
    }
  } finally {
    clearTimeout(timer);
  }
  if (!out.trim()) throw new Error('empty model output');
  return out;
}

export function apply(ctx) {
  let registered = false;

  const mount = () => {
    if (registered) return true;
    const webServer = ctx.get('webServer') || ctx.get('httpServer');
    if (!webServer || typeof webServer.register !== 'function') return false;
    registered = true;
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (req, res) => {
        const send = (code, obj) => {
          if (res.writableEnded) return;
          res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(JSON.stringify(obj));
        };
        try {
          if (req.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' });

          const conn = ctx.get('connection');
          if (conn && typeof conn.requestRejection === 'function') {
            const rejection = conn.requestRejection(req);
            if (rejection !== undefined) return send(rejection, { ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' });
          }

          const body = await readJsonBody(req, MAX_BODY);
          const text = body && typeof body.text === 'string' ? body.text : '';
          if (!text.trim()) return send(400, { ok: false, error: 'empty text' });

          const raw = await runModel(ctx, text);
          return send(200, { ok: true, raw });
        } catch (e) {
          return send(500, { ok: false, error: String(e && e.message ? e.message : e) });
        }
      },
    }), 'opc-vault: recognize route');

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: STATE_ROUTE,
      handler: async (req, res) => {
        const send = (code, obj) => { if (res.writableEnded) return; res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
        try {
          if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,OPTIONS', 'access-control-allow-headers': 'content-type' }); return res.end(); }
          if (req.method !== 'GET' && req.method !== 'PUT') return send(405, { ok: false, error: 'method not allowed' });
          const conn = ctx.get('connection');
          if (conn && typeof conn.requestRejection === 'function') { const rejection = conn.requestRejection(req); if (rejection !== undefined) return send(rejection, { ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' }); }
          if (req.method === 'GET') {
            try { const txt = await readFile(VAULT_FILE, 'utf8'); return send(200, JSON.parse(txt)); }
            catch (e) { if (e && e.code === 'ENOENT') return send(404, { error: 'empty' }); throw e; }
          }
          const body = await readJsonBody(req, 20_000_000);
          if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { ok: false, error: 'state must be object' });
          await mkdir(VAULT_DIR, { recursive: true, mode: 0o700 });
          const tmp = VAULT_FILE + '.tmp-' + process.pid;
          await writeFile(tmp, JSON.stringify(body), { mode: 0o600 });
          await rename(tmp, VAULT_FILE);
          return send(200, { ok: true });
        } catch (e) { return send(500, { ok: false, error: String(e && e.message ? e.message : e) }); }
      },
    }), 'opc-vault: state route');
    return true;
  };

  if (!mount()) {
    // Register the route whenever the web server service becomes available.
    try {
      ctx.on('internal/service', () => { mount(); });
    } catch (e) { /* no event bus: route simply stays unavailable */ }
  }
}
