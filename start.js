// ── Start de produção (Railway) ──────────────────────────────────────
// Sobe os dois processos no mesmo serviço:
//   1. Next.js (dashboard nova) na porta interna 3001, sob /dashboard
//   2. Express (API + páginas públicas) na porta pública ($PORT)
// O Express faz proxy reverso de /dashboard/* para o Next — um domínio só.
const { spawn } = require('child_process');
const path = require('path');

const nextBin = path.join(__dirname, 'dashboard', 'node_modules', 'next', 'dist', 'bin', 'next');
const nextProc = spawn(process.execPath, [nextBin, 'start', '-p', '3001'], {
  cwd: path.join(__dirname, 'dashboard'),
  stdio: 'inherit',
  env: { ...process.env, PORT: '3001' },
});

nextProc.on('exit', (code) => {
  console.error(`[start] Next.js saiu com código ${code} — encerrando o serviço`);
  process.exit(code || 1);
});

// Express assume o processo principal (usa $PORT do Railway)
require('./server.js');
