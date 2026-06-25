const { spawn } = require('child_process');

const services = [
  'alphaedge-auth.js',
  'alphaedge-stripe-server.js',
  'alphaedge-signals.js'
];

services.forEach(service => {
  const proc = spawn('node', [service], { stdio: 'inherit' });
  proc.on('close', code => console.log(`${service} exited with code ${code}`));
  console.log(`Started ${service}`);
});