'use strict';
const { HttpError } = require('./service');

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
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
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'request body too large'));
        // Drain rather than destroy: the socket must live long enough to send the 413.
        req.resume();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (!body) { resolve({}); return; }
      try { resolve(JSON.parse(body)); } catch { reject(new HttpError(400, 'INVALID_JSON', 'body must be valid JSON')); }
    });
    req.on('error', reject);
  });
}

function createRouter(service) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'POST' && url.pathname === '/links') {
        service.assertRateLimit(req.socket.remoteAddress || 'unknown');
        const link = service.createLink(await readBody(req));
        sendJson(res, 201, { code: link.code, shortUrl: `/${link.code}`, expiresAt: link.expiresAt });
        return;
      }

      const statsMatch = /^\/links\/([A-Za-z0-9]{1,20})\/stats$/.exec(url.pathname);
      if (req.method === 'GET' && statsMatch) {
        sendJson(res, 200, service.stats(statsMatch[1]));
        return;
      }

      const linkMatch = /^\/links\/([A-Za-z0-9]{1,20})$/.exec(url.pathname);
      if (req.method === 'DELETE' && linkMatch) {
        service.deleteLink(linkMatch[1]);
        res.writeHead(204);
        res.end();
        return;
      }

      const redirectMatch = /^\/([A-Za-z0-9]{1,20})$/.exec(url.pathname);
      if (req.method === 'GET' && redirectMatch) {
        const link = service.resolveLink(redirectMatch[1]);
        res.writeHead(302, { location: link.url });
        res.end();
        return;
      }

      throw new HttpError(404, 'NOT_FOUND', 'not found');
    } catch (error) {
      sendError(res, error);
    }
  };
}

module.exports = { createRouter };
