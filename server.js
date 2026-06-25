process.env.AUTH_PORT = '3000';
process.env.STRIPE_PORT = '3001';
process.env.SIGNALS_PORT = '3002';

const { spawn } = require('child_process');

const services = [
  { file: 'alphaedge-auth.js', port: '3000' },
  { file: 'alphaedge-stripe-server.js', port: '3001' },
  { file: 'alphaedge-signals.js', port: '3002' },
];

services.forEach(({ file, port }) => {
  const env = { ...process.env, PORT: port };
  const proc = spawn('node', [file], { stdio: 'inherit', env });
  proc.on('close', code => console.log(`${file} exited with code ${code}`));
  console.log(`Started ${file} on port ${port}`);
});