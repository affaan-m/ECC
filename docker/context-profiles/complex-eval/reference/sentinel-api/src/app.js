'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const config = require('./config');
const store = require('./store');

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = text => text.replace(/[&<>"']/g, char => HTML_ESCAPES[char]);

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

function readBody(req, res, callback) {
  const chunks = [];
  let bytes = 0;
  let rejected = false;
  req.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > config.MAX_BODY_BYTES && !rejected) {
      rejected = true;
      sendJson(res, 413, { error: 'payload too large' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => { if (!rejected) callback(Buffer.concat(chunks).toString('utf8')); });
}

function page(paste) {
  return `<!doctype html><html><head><title>paste ${paste.id}</title></head>`
    + `<body><main><pre class="paste">${escapeHtml(paste.content)}</pre></main></body></html>`;
}

function createApp() {
  const adminToken = process.env.ADMIN_TOKEN || null;

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/pastes') {
      readBody(req, res, body => {
        let parsed;
        try { parsed = JSON.parse(body); } catch {
          sendJson(res, 400, { error: 'invalid JSON body' });
          return;
        }
        if (typeof parsed.content !== 'string') {
          sendJson(res, 400, { error: 'content must be a string' });
          return;
        }
        const paste = store.create(parsed.content);
        sendJson(res, 201, { id: paste.id, deleteToken: paste.deleteToken });
      });
      return;
    }

    const pasteMatch = /^\/pastes\/([\w-]+)$/.exec(url.pathname);
    if (pasteMatch && req.method === 'GET') {
      const paste = store.get(pasteMatch[1]);
      if (!paste) { sendJson(res, 404, { error: 'not found' }); return; }
      sendJson(res, 200, { id: paste.id, content: paste.content });
      return;
    }
    if (pasteMatch && req.method === 'DELETE') {
      const paste = store.get(pasteMatch[1]);
      if (!paste) { sendJson(res, 404, { error: 'not found' }); return; }
      if (req.headers['x-delete-token'] !== paste.deleteToken) {
        sendJson(res, 403, { error: 'bad delete token' });
        return;
      }
      store.remove(paste.id);
      res.writeHead(204);
      res.end();
      return;
    }

    const pageMatch = /^\/p\/([\w-]+)$/.exec(url.pathname);
    if (pageMatch && req.method === 'GET') {
      const paste = store.get(pageMatch[1]);
      if (!paste) { sendJson(res, 404, { error: 'not found' }); return; }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(page(paste));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/files') {
      const name = url.searchParams.get('name') || '';
      const resolved = path.resolve(config.FILES_DIR, name);
      if (resolved !== config.FILES_DIR && !resolved.startsWith(config.FILES_DIR + path.sep)) {
        sendJson(res, 400, { error: 'invalid file name' });
        return;
      }
      try {
        const content = fs.readFileSync(resolved);
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(content);
      } catch {
        sendJson(res, 404, { error: 'not found' });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/stats') {
      if (!adminToken || req.headers['x-admin-token'] !== adminToken) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      sendJson(res, 200, store.stats());
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });
}

module.exports = { createApp };
