'use strict';
/*
 * Recuperação de acesso ao painel (admin) — ROI-NADOS.
 *
 * O login usa e-mail + senha (scrypt) e NÃO tem fluxo de "esqueci a senha".
 * Se você perdeu a senha, ficou travado por tentativas ou perdeu o app de 2FA,
 * rode este script UMA vez contra o seu banco Neon para redefinir a senha (e,
 * por padrão, limpar o 2FA) da sua conta. Requer acesso ao DATABASE_URL — ou
 * seja, só quem é dono do banco consegue rodar. Não é um bypass de auth.
 *
 * USO (com o DATABASE_URL do Neon disponível no ambiente):
 *   # listar as contas existentes (confirma o e-mail exato cadastrado)
 *   node scripts/reset-password.js --list
 *
 *   # redefinir a senha de uma conta (limpa o 2FA por padrão)
 *   node scripts/reset-password.js meu-email@dominio.com "minhaNovaSenhaForte"
 *
 *   # redefinir MANTENDO o 2FA ativo
 *   node scripts/reset-password.js meu-email@dominio.com "novaSenha" --keep-2fa
 *
 * No Railway: abra um shell do serviço (o DATABASE_URL já está no ambiente) e
 * rode o comando. Localmente: exporte o DATABASE_URL do Neon antes, ex.:
 *   DATABASE_URL="postgres://...neon..." node scripts/reset-password.js --list
 */
const crypto = require('crypto');

// Mesmo formato do auth.js: "salt:hash", scrypt 64 bytes.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}

function fail(msg) {
  console.error('\n✗ ' + msg + '\n');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    fail('DATABASE_URL (ou POSTGRES_URL) não está definido no ambiente.\n'
      + '  No Railway: rode dentro do shell do serviço.\n'
      + '  Local: DATABASE_URL="postgres://...neon..." node scripts/reset-password.js --list');
  }

  let neon;
  try {
    ({ neon } = require('@neondatabase/serverless'));
  } catch (_) {
    fail('Dependência @neondatabase/serverless não encontrada. Rode `npm install` na raiz primeiro.');
  }
  const sql = neon(url);

  // Modo listagem: confirma quais contas existem (e o e-mail EXATO gravado).
  if (args.includes('--list') || args[0] === 'list') {
    const rows = await sql`SELECT id, email, role, created_at,
      (password_hash IS NOT NULL) AS tem_senha,
      (totp_secret IS NOT NULL) AS tem_2fa
      FROM accounts ORDER BY created_at ASC`;
    if (!rows.length) {
      console.log('\nNenhuma conta cadastrada. O banco está vazio — abra /register no painel:\n'
        + 'a PRIMEIRA conta criada vira admin e herda os dados legados.\n');
      return;
    }
    console.log('\nContas cadastradas (' + rows.length + '):\n');
    for (const r of rows) {
      console.log('  • ' + r.email + '   [' + r.role + ']'
        + (r.tem_2fa ? '  2FA: ATIVO' : '  2FA: —')
        + '   criada ' + new Date(r.created_at).toLocaleString('pt-BR'));
    }
    console.log('\nPara redefinir: node scripts/reset-password.js <e-mail acima> "<nova senha>"\n');
    return;
  }

  const email = String(args[0] || '').trim().toLowerCase();
  const password = String(args[1] || '');
  const keep2fa = args.includes('--keep-2fa');

  if (!email || !email.includes('@')) fail('Informe o e-mail da conta. Ex.: node scripts/reset-password.js voce@dominio.com "novaSenha"');
  if (password.length < 8) fail('A nova senha precisa ter pelo menos 8 caracteres.');

  // O banco grava o e-mail sempre em minúsculas (db.createAccount) — a busca aqui
  // usa o mesmo LOWER para casar independente de como você digitou no cadastro.
  const found = await sql`SELECT id, email, role, (totp_secret IS NOT NULL) AS tem_2fa
    FROM accounts WHERE email = ${email} LIMIT 1`;
  if (!found.length) {
    fail('Nenhuma conta com o e-mail "' + email + '".\n'
      + '  Rode `node scripts/reset-password.js --list` para ver os e-mails exatos cadastrados.');
  }
  const acc = found[0];

  const newHash = hashPassword(password);
  if (keep2fa) {
    await sql`UPDATE accounts SET password_hash = ${newHash} WHERE id = ${acc.id}`;
  } else {
    // limpa o 2FA junto: recuperação de acesso não pode ficar presa no autenticador
    await sql`UPDATE accounts SET password_hash = ${newHash}, totp_secret = NULL WHERE id = ${acc.id}`;
  }

  console.log('\n✓ Senha redefinida para ' + acc.email + ' [' + acc.role + '].');
  if (!keep2fa && acc.tem_2fa) console.log('  2FA foi DESATIVADO (você pode reativar no painel depois de entrar).');
  console.log('\n  Agora entre em /login com esse e-mail e a nova senha.');
  console.log('  Dica: o bloqueio por tentativas é temporário (15 min) e some sozinho —');
  console.log('  se ainda acusar "muitas tentativas", aguarde ou reinicie o serviço.\n');
}

main().catch((err) => fail('Falha: ' + (err && err.message ? err.message : String(err))));
