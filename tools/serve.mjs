#!/usr/bin/env node
// tools/serve.mjs — dependency-free static file server for local development.
//   npm run dev   →   http://localhost:4321
//
// Mirrors the production hosting rules: clean URLs, index.html at the root,
// correct MIME types for ES modules, and no caching so edits show up instantly.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = join(root, clean);
  // Never escape the project root.
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

async function tryFile(p) {
  try {
    const s = await stat(p);
    if (s.isFile()) return p;
    if (s.isDirectory()) {
      const idx = join(p, 'index.html');
      const si = await stat(idx);
      if (si.isFile()) return idx;
    }
  } catch (_) { /* not found */ }
  return null;
}

const server = createServer(async (req, res) => {
  const url = req.url || '/';
  const base = safeJoin(ROOT, url);
  if (!base) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // Clean URLs: /resume → /resume.html, directories → index.html.
  let file = await tryFile(base);
  if (!file && !extname(base)) file = await tryFile(base + '.html');

  // SPA fallback for *navigations only*. Falling back for `/src/missing.js`
  // would answer a dead module with 200 text/html, which the browser rejects
  // with "expected a JavaScript module script" — a blank page that every
  // `curl -sI` sweep would report as a clean 200. Vercel 404s those too.
  const wantsHtml = String(req.headers.accept || '').includes('text/html');
  if (!file && !extname(base) && wantsHtml) file = await tryFile(join(ROOT, 'index.html'));

  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('500 ' + (err && err.message ? err.message : 'Internal error'));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`career-quest dev server → http://${HOST}:${PORT}/`);
  console.log(`serving ${ROOT}`);
});
