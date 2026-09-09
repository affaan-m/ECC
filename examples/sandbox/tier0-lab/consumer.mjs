let input = '';

for await (const chunk of process.stdin) {
  input += chunk;
}

const message = JSON.parse(input);
if (message.sender !== 'process A' || message.body !== 'hello from process A') {
  throw new Error('unexpected producer message');
}

process.stdout.write(`process B received: ${message.body}\n`);
