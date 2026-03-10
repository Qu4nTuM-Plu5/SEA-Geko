const { spawn } = require('child_process');
const net = require('net');

function run(name, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });

  return child;
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    // Probe exactly like Node HTTP server default bind (usually :::port on Windows).
    server.listen({ port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort, maxChecks = 20) {
  for (let i = 0; i < maxChecks; i += 1) {
    const candidate = startPort + i;
    // eslint-disable-next-line no-await-in-loop
    const available = await canListenOnPort(candidate);
    if (available) return candidate;
  }
  return startPort;
}

async function main() {
  const apiPort = await findAvailablePort(Number(process.env.PORT || 8787));
  if (apiPort !== Number(process.env.PORT || 8787)) {
    console.log(`[dev-local] API port ${process.env.PORT || 8787} is busy; using ${apiPort}.`);
  }

  const api = run('api', 'node', ['server/server.cjs'], { PORT: String(apiPort) });
  const web = run('web', 'npx', ['vite', '--port=3000', '--host=0.0.0.0'], { VITE_API_PORT: String(apiPort) });

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
}

main().catch((err) => {
  console.error('[dev-local] startup failed:', err?.message || err);
  process.exit(1);
});
