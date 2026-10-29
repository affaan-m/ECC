'use strict';
const http = require('node:http');

const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 64 * 1024);

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}

function sendError(res, error) {
  const known = error instanceof HttpError;
  sendJson(res, known ? error.status : 500, {
    error: { code: known ? error.code : 'INTERNAL', message: known ? error.message : 'internal error' },
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let settled = false;
    req.on('data', chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        settled = true;
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'request body exceeds 64 KB'));
        // Drain rather than destroy: the socket must live long enough to send the 413.
        req.resume();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(body)); } catch { reject(new HttpError(400, 'INVALID_JSON', 'body must be valid JSON')); }
    });
    req.on('error', reject);
  });
}

function validateNote(input) {
  if (!input || typeof input.title !== 'string' || !input.title.trim()) {
    throw new HttpError(400, 'INVALID_TITLE', 'title must be a non-empty string');
  }
  if (typeof input.body !== 'string') throw new HttpError(400, 'INVALID_BODY', 'body must be a string');
  return { title: input.title, body: input.body };
}

function createApp() {
  const notes = new Map();
  let nextId = 1;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { status: 'ok' });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/notes') {
        const fields = validateNote(await readBody(req));
        const id = `n_${nextId++}`;
        notes.set(id, { id, ...fields });
        sendJson(res, 201, notes.get(id));
        return;
      }
      const match = /^\/notes\/([\w-]+)$/.exec(url.pathname);
      if (req.method === 'GET' && match) {
        const note = notes.get(match[1]);
        if (!note) throw new HttpError(404, 'NOT_FOUND', 'no note with that id');
        sendJson(res, 200, note);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/notes') {
        sendJson(res, 200, { notes: [...notes.values()] });
        return;
      }
      throw new HttpError(404, 'NOT_FOUND', 'not found');
    } catch (error) {
      sendError(res, error);
    } finally {
      console.log(JSON.stringify({ method: req.method, path: url.pathname,
        status: res.statusCode, at: new Date().toISOString() }));
    }
  });
  return server;
}

module.exports = { createApp };
