#!/usr/bin/env node
// OPC Vault local server: serves the PWA and the single encrypted vault file.
// One vault file (~/.opc-vault/vault.json) is shared by the DSH plugin and the
// local web app at http://127.0.0.1:5240. The file stores only ciphertext.
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.env.PORT || 5240);
const HOST = process.env.HOST || '127.0.0.1';
const VAULT_DIR = process.env.OPC_VAULT_DIR || join(homedir(), '.opc-vault');
const VAULT_FILE = process.env.OPC_VAULT_FILE || join(VAULT_DIR, 'vault.json');
const MAX_BODY = 20 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

function safe(urlPath) {
  const p = normalize(join(ROOT, decodeURIComponent(urlPath.split('?')[0])));
  return p.startsWith(ROOT) ? p : null;
}
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Private-Network': 'true',
    'Cache-Control': 'no-store',
  };
}
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }, cors()));
  res.end(body);
}
function readBody(req, max) {
  return new Promise((resolvePromise, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(new Error('body too large')); try { req.destroy(); } catch (e) {} return; } chunks.push(c); });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readState() {
  try { const txt = await readFile(VAULT_FILE, 'utf8'); return JSON.parse(txt); }
  catch (e) { if (e && e.code === 'ENOENT') return null; throw e; }
}
async function writeState(state) {
  await mkdir(VAULT_DIR, { recursive: true, mode: 0o700 });
  const tmp = VAULT_FILE + '.tmp-' + process.pid;
  await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
  await rename(tmp, VAULT_FILE);
}

createServer(async (req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  try {
    if (pathname === '/api/state') {
      if (req.method === 'OPTIONS') { res.writeHead(204, cors()); return res.end(); }
      if (req.method === 'GET') {
        const st = await readState();
        if (st == null) return json(res, 404, { error: 'empty' });
        return json(res, 200, st);
      }
      if (req.method === 'PUT') {
        const raw = await readBody(req, MAX_BODY);
        let obj; try { obj = JSON.parse(raw); } catch (e) { return json(res, 400, { error: 'invalid json' }); }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return json(res, 400, { error: 'state must be object' });
        await writeState(obj);
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: 'method not allowed' });
    }

    let fp = safe(pathname === '/' ? '/index.html' : req.url || '/');
    if (!fp) { res.writeHead(403); return res.end('Forbidden'); }
    let info = await stat(fp).catch(() => null);
    if (info && info.isDirectory()) { fp = join(fp, 'index.html'); info = await stat(fp).catch(() => null); }
    if (!info) { res.writeHead(404); return res.end('Not found'); }
    const body = await readFile(fp);
    const ext = extname(fp).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-cache',
    };
    res.writeHead(200, headers);
    res.end(body);
  } catch (e) { try { json(res, 500, { error: e.message }); } catch (e2) { res.writeHead(500); res.end('Server error'); } }
}).listen(PORT, HOST, () => {
  console.log(`\n  OPC Vault single-vault server: http://127.0.0.1:${PORT}`);
  console.log(`  Vault file: ${VAULT_FILE}\n`);
});
