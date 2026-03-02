const { spawn } = require('child_process');

function run(name, command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });

  return child;
}

const api = run('api', 'node', ['server/server.cjs']);
const web = run('web', 'npx', ['vite', '--port=3000', '--host=0.0.0.0']);

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { api.kill('SIGINT'); } catch {}
  try { web.kill('SIGINT'); } catch {}
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
