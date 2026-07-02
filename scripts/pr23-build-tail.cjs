const { spawnSync } = require('node:child_process');

const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(command, ['run', 'build:full'], {
  cwd: process.cwd(),
  env: process.env,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});

const lines = `${result.stdout || ''}\n${result.stderr || ''}`.trim().split(/\r?\n/);
process.stdout.write(`${lines.slice(-120).join('\n')}\n`);

if (result.error) console.error(result.error.message);
process.exit(result.status === 0 ? 0 : 1);
