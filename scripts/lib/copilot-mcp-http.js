'use strict';

const http = require('http');
const https = require('https');
const { findPotentialSecrets, hasUnsafeControlCharacters } = require('./memory-vault-format');
const MAX_BYTES = 64 * 1024;
const PROTOCOL = '2025-03-26';
function remoteUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\s${}]/.test(value)
    || hasUnsafeControlCharacters(value) || findPotentialSecrets(value).length) throw new Error('Invalid remote MCP URL.');
  const url = new URL(value);
  const loopback = ['127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username || url.password || url.search || url.hash) {
    throw new Error('Remote MCP requires HTTPS or literal loopback HTTP without URL credentials, query or fragment.');
  }
  return url;
}
function mapRemote(server, tools) {
  if (Object.keys(server).some(key => !['type', 'url', 'description', 'tools', 'headers'].includes(key))) {
    throw new Error('Mixed or unsupported remote MCP fields.');
  }
  remoteUrl(server.url);
  if (server.headers !== undefined && (!server.headers || typeof server.headers !== 'object'
    || Array.isArray(server.headers) || Object.keys(server.headers).length)) {
    throw new Error('Remote credential headers require an explicitly verified authentication adapter.');
  }
  return { type: server.type === 'streamable-http' ? 'http' : server.type,
    url: server.url, headers: {}, tools: [...tools] };
}
function validResponse(response) {
  return response && response.jsonrpc === '2.0' && response.id === 1 && !response.error
    && response.result?.protocolVersion === PROTOCOL
    && response.result.capabilities && typeof response.result.capabilities === 'object'
    && !Array.isArray(response.result.capabilities)
    && response.result.serverInfo && !Array.isArray(response.result.serverInfo)
    && typeof response.result.serverInfo.name === 'string' && typeof response.result.serverInfo.version === 'string';
}
function probeHttp(server, { timeoutMs = 3000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Invalid HTTP probe timeout.');
  if (!['http', 'streamable-http'].includes(server?.type)) return Promise.resolve({ status: 'unsupported-transport' });
  let url;
  try { mapRemote(server, []); url = remoteUrl(server.url); }
  catch { return Promise.resolve({ status: 'invalid-config', attempts: 0, tool_calls: 0 }); }
  return new Promise(resolve => {
    let settled = false; let response; let bytes = 0; let raw = ''; let sse = false;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    });
    const finish = status => {
      if (settled) return;
      settled = true; clearTimeout(timer); response?.destroy(); request.destroy();
      resolve({ status, attempts: 1, tool_calls: 0 });
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    request.on('error', () => finish('network-error'));
    request.on('response', incoming => {
      if (settled) { incoming.destroy(); return; }
      response = incoming;
      if ([401, 403].includes(incoming.statusCode)) return finish('auth-required');
      if (incoming.statusCode >= 300 && incoming.statusCode < 400) return finish('redirect-not-followed');
      if (incoming.statusCode !== 200) return finish('http-error');
      const type = String(incoming.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!['application/json', 'text/event-stream'].includes(type)) return finish('invalid-response');
      sse = type === 'text/event-stream';
      incoming.on('error', () => finish('network-error'));
      incoming.on('aborted', () => finish('network-error'));
      incoming.on('data', chunk => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > MAX_BYTES) return finish('output-limit');
        try { raw += decoder.decode(chunk, { stream: true }); }
        catch { finish('invalid-response'); return; }
        if (sse) raw = consumeEvents(raw, finish);
      });
      incoming.on('end', () => {
        if (settled) return;
        try { raw += decoder.decode(); }
        catch { finish('invalid-response'); return; }
        if (sse) { consumeEvents(raw, finish); if (!settled) finish('invalid-response'); }
        else {
          try { finish(validResponse(JSON.parse(raw)) ? 'healthy' : 'invalid-response'); }
          catch { finish('invalid-response'); }
        }
      });
    });
    request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'ecc-copilot-doctor', version: '1' },
    } }));
  });
}
function consumeEvents(raw, finish) {
  let remaining = raw.replace(/\r\n/g, '\n');
  let end;
  while ((end = remaining.indexOf('\n\n')) >= 0) {
    const block = remaining.slice(0, end); remaining = remaining.slice(end + 2);
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) continue;
    try {
      const response = JSON.parse(data);
      if (response.id === 1) finish(validResponse(response) ? 'healthy' : 'invalid-response');
    } catch { finish('invalid-response'); }
  }
  return remaining;
}
module.exports = { mapRemote, probeHttp };
