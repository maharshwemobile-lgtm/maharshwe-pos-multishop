const { spawnSync } = require('child_process');

const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: process.env,
  maxBuffer: 20 * 1024 * 1024,
});

const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim().split(/\r?\n/);
const tail = output.slice(-140).join('\n');
if (tail) process.stdout.write(`${tail}\n`);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status || 0);
