'use strict';

const users = [
  { name: 'Ada_Lovelace', role: 'admin' },
  { name: 'Grace-Hopper', role: 'engineer' }
];

/** The trap taken: the habitual lowercase-and-trim, with punctuation left alone. */
function findUser(name) {
  const wanted = String(name).trim().toLowerCase();
  return users.find(user => user.name.toLowerCase() === wanted);
}

module.exports = { users, findUser };
