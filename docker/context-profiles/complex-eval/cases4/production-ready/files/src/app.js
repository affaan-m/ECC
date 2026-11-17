'use strict';
const http = require('node:http');

// Prototype state: happy path only.
const notes = new Map();
let nextId = 1;

function createApp() {
  return http.createServer((req, res) => {
    console.log('got a request');
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/notes') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        const id = `n_${nextId++}`;
        notes.set(id, { id, title: parsed.title, body: parsed.body });
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify(notes.get(id)));
      });
      return;
    }

    const match = /^\/notes\/([\w-]+)$/.exec(url.pathname);
    if (req.method === 'GET' && match) {
      const note = notes.get(match[1]);
      if (!note) {
        res.writeHead(404);
        res.end('<html><body>not found</body></html>');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(note));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/notes') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ notes: [...notes.values()] }));
      return;
    }

    res.writeHead(404);
    res.end('<html><body>not found</body></html>');
  });
}

module.exports = { createApp };
