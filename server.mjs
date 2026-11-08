#!/usr/bin/env node
// Local static server for the OPC Vault PWA.
// Serves over http://localhost:PORT (a WebAuthn-valid origin) so Passkey works
// during local testing, and so the app is installable (localhost is a secure context).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';

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

createServer(async (req, res) => {
  try {
    let fp = safe(req.url === '/' ? '/index.html' : req.url);
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
    };
    // Service worker should never be cached long; app shell short.
    headers['Cache-Control'] = ext === '.js' && fp.endsWith('sw.js') ? 'no-cache' : 'no-cache';
    res.writeHead(200, headers);
    res.end(body);
  } catch (e) { res.writeHead(500); res.end('Server error: ' + e.message); }
}).listen(PORT, HOST, () => {
  console.log(`\n  OPC Vault (PWA) running at   http://localhost:${PORT}\n`);
  console.log('  Open it in Chrome/Edge, then install (address bar → Install). Passkey works on localhost.\n');
});
