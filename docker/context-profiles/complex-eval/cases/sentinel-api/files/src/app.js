'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const config = require('./config');
const store = require('./store');

function readBody(req, callback) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => callback(body));
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

function page(paste) {
  return `<!doctype html><html><head><title>paste ${paste.id}</title></head>`
    + `<body><main><pre class="paste">${paste.content}</pre></main></body></html>`;
}

function createApp() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/pastes') {
      readBody(req, body => {
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
      try {
        const content = fs.readFileSync(path.join(config.FILES_DIR, name));
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(content);
      } catch {
        sendJson(res, 404, { error: 'not found' });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/stats') {
      if (req.headers['x-admin-token'] !== config.ADMIN_TOKEN) {
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
