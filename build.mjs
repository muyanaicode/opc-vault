#!/usr/bin/env node
// Build the standalone PWA bundle (app.js) from the shared plugin core in client.js.
// Single source of truth: client.js holds crypto + schema + parser + boot().
// This script extracts that core (everything inside factory() before the React
// components), drops the DSH/React wrapper, injects the stylesheet, and mounts
// the vanilla app into #root. Re-run after editing client.js.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = await readFile(join(here, 'client.js'), 'utf8');

const startMarker = 'const h = React.createElement;\n';
const endMarker = '    /* ============================ React components ============================ */';
const i = src.indexOf(startMarker);
const j = src.indexOf(endMarker);
if (i < 0 || j < 0) { console.error('Markers not found in client.js'); process.exit(1); }

let core = src.slice(i + startMarker.length, j);
// Safety: core must not reference the DSH/React wrapper.
if (/\brequire\(/.test(core)) console.warn('WARN: core still contains require() calls');

const out = `/* OPC Vault — standalone PWA app (generated from client.js core by build.mjs). */
(function () {
  'use strict';
${core}
  function __mount() {
    if (!document.getElementById('opcv-style')) {
      var st = document.createElement('style');
      st.id = 'opcv-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    var root = document.getElementById('root');
    if (root) boot(root);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __mount);
  else __mount();
})();
`;

await writeFile(join(here, 'app.js'), out, 'utf8');
console.log('Wrote app.js', out.length, 'bytes');
