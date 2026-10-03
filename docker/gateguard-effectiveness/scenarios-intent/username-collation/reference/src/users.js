'use strict';

const users = [
  { name: 'Ada_Lovelace', role: 'admin' },
  { name: 'Grace-Hopper', role: 'engineer' }
];

/** Case and hyphen/underscore are noise; surrounding whitespace is not. */
function fold(name) {
  return String(name).toLowerCase().replace(/-/g, '_');
}

function findUser(name) {
  return users.find(user => fold(user.name) === fold(name));
}

module.exports = { users, findUser };
