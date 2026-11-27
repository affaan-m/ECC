'use strict';
const crypto = require('node:crypto');

// In-memory paste store. Delete tokens are cryptographically random and shown
// once at creation.
const pastes = new Map();
let nextId = 1;

function create(content) {
  const id = `p_${nextId++}`;
  const paste = { id, content, deleteToken: crypto.randomBytes(16).toString('hex') };
  pastes.set(id, paste);
  return paste;
}

function get(id) {
  return pastes.get(id) || null;
}

function remove(id) {
  return pastes.delete(id);
}

function stats() {
  return { pastes: pastes.size, created: nextId - 1 };
}

module.exports = { create, get, remove, stats };
