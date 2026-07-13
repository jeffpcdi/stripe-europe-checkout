// ── Inicializador de desenvolvimento ────────────────────────────────────────
// Mantém Express (porta pública) e Next.js (dashboard interna) no mesmo ciclo
// de vida. O Express faz proxy de /dashboard/* para o Next na porta 3001.
const { spawn } = require('child_process');
const path = require('path');

const rootDir = __dirname;
const dashboardDir = path.join(rootDir, 'dashboard');
const nextBin = path.join(dashboardDir, 'node_modules', 'next', 'dist', 'bin', 'next');

const children = new Set();
let shuttingDown = false;

function start(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || rootDir,
    env: { ...process.env, ...(options.env || {}) },
    stdio: 'inherit',
  });
  children.add(child);

  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    console.error(`[dev] ${label} encerrou (${signal || `código ${code}`}). Encerrando o Preview.`);
    shutdown(code || 1);
  });

  child.on('error', (error) => {
    console.error(`[dev] Não foi possível iniciar ${label}: ${error.message}`);
    shutdown(1);
  });

  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  const force = setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill('SIGKILL');
    }
    process.exit(exitCode);
  }, 5_000);
  force.unref();
  if (children.size === 0) process.exit(exitCode);
  Promise.all([...children].map((child) => new Promise((resolve) => child.once('exit', resolve))))
    .finally(() => process.exit(exitCode));
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (error) => {
  console.error('[dev] Erro não tratado:', error);
  shutdown(1);
});

start('Next.js', process.execPath, [nextBin, 'dev', '-p', '3001'], {
  cwd: dashboardDir,
  env: { PORT: '3001' },
});
start('Express', process.execPath, ['server.js']);
