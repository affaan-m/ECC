const message = Object.freeze({
  sender: 'process A',
  body: 'hello from process A',
});

process.stdout.write(`${JSON.stringify(message)}\n`);
