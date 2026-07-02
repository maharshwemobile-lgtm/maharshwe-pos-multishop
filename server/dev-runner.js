const { spawn } = require('child_process');
const http = require('http');

const children = [];

function health() {
  return new Promise((resolve) => {
    const request = http.get('http://127.0.0.1:4000/api/health', (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          resolve({ running: response.statusCode === 200, server: data.server || '' });
        } catch {
          resolve({ running: response.statusCode === 200, server: '' });
        }
      });
    });
    request.setTimeout(800, () => { request.destroy(); resolve({ running: false, server: '' }); });
    request.on('error', () => resolve({ running: false, server: '' }));
  });
}

function start(command, args, label) {
  const child = spawn(command, args, { stdio: 'inherit', shell: true, env: process.env });
  children.push(child);
  child.on('exit', (code) => {
    if (code && label === 'api') console.error(`API stopped with code ${code}`);
  });
  return child;
}

async function waitForApi() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await health();
    if (status.running && status.server === 'mahar-pos-full-api') return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function run() {
  const status = await health();
  if (status.running && status.server !== 'mahar-pos-full-api') {
    console.error(`Old API is using port 4000 (${status.server || 'unknown'}). Stop old npm/node process and run again.`);
    process.exit(1);
  }

  if (status.running) console.log('Mahar POS Full API already running on port 4000');
  else {
    start('node', ['server/api-connected.js'], 'api');
    if (!await waitForApi()) {
      console.error('Mahar POS Full API failed to start on port 4000');
      process.exit(1);
    }
  }

  console.log('Full API ready. Starting web app...');
  start('npx', ['vite', '--host', '0.0.0.0', '--port', '5173'], 'web');
}

function stop() {
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
run().catch((error) => { console.error(error); stop(); });
