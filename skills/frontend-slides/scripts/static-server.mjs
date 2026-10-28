// static-server.mjs - Loopback-only static file server for export-pdf.sh
//
// Serves the presentation folder so fonts and relative assets load over HTTP.
// It binds to 127.0.0.1 only, rejects foreign Host headers (DNS rebinding),
// and never serves a file that resolves outside the served folder.

import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

export const LOOPBACK_HOST = '127.0.0.1';

const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost']);

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(root + sep);
}

function isAllowedHost(hostHeader) {
  if (typeof hostHeader !== 'string') return false;
  const match = hostHeader.trim().toLowerCase().match(/^([^:]+)(?::\d{1,5})?$/);
  return Boolean(match) && ALLOWED_HOSTNAMES.has(match[1]);
}

// Map a request URL to an absolute file path inside root.
// Returns { status } on rejection, or { filePath } on success.
export function resolveRequestPath(root, indexFile, rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, `http://${LOOPBACK_HOST}`).pathname);
  } catch {
    return { status: 400 };
  }
  if (pathname.includes('\0')) return { status: 400 };
  const relative = pathname === '/' ? indexFile : pathname;
  const filePath = resolve(root, '.' + sep + relative);
  if (!isInside(root, filePath)) return { status: 403 };
  return { filePath };
}

export async function startStaticServer({ serveDir, indexFile, port = 0 }) {
  const root = await realpath(serveDir);

  const server = createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'text/plain' });
      res.end(body);
    };
    if (!isAllowedHost(req.headers.host)) return send(403, 'Forbidden host');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed');

    const resolved = resolveRequestPath(root, indexFile, req.url);
    if (resolved.status === 400) return send(400, 'Bad request');
    if (resolved.status === 403) return send(403, 'Forbidden');

    try {
      // Follow symlinks before the final check so a link cannot point outside root.
      const realFile = await realpath(resolved.filePath);
      if (!isInside(root, realFile)) return send(403, 'Forbidden');
      const content = await readFile(realFile);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(realFile).toLowerCase()] || 'application/octet-stream' });
      return res.end(req.method === 'HEAD' ? undefined : content);
    } catch {
      return send(404, 'Not found');
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, LOOPBACK_HOST, resolveListen);
  });

  return { server, port: server.address().port };
}
