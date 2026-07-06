// ── Páginas de login e registro (HTML inline) ─────────────────────────────
// Mesma identidade visual da dashboard (dark, azul, Inter). Servidas em
// /login e /register. Postam para /login e /register (form-urlencoded/JSON).
function page(opts) {
  const isRegister = opts.mode === 'register';
  const title = isRegister ? 'Criar conta' : 'Entrar';
  const other = isRegister
    ? '<a href="/login">Já tenho conta — entrar</a>'
    : '<a href="/register">Criar uma conta nova</a>';
  const error = opts.error
    ? '<div class="msg err">' + escapeHtml(opts.error) + '</div>' : '';
  const nameField = isRegister
    ? '<label>Nome <span class="opt">(opcional)</span>' +
      '<input name="name" type="text" autocomplete="name" maxlength="80" placeholder="Seu nome"></label>'
    : '';
  const firstNote = isRegister
    ? '<p class="note">A primeira conta criada vira o administrador e herda os dados já existentes.</p>'
    : '';

  return `<!doctype html>
<html lang="pt-BR" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#04050a">
<title>${title} — Painel de Rastreamento</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--bg:#04050a;--card:#0a0c16;--border:#1e2438;--text:#f8fafc;--text-sub:#cbd5e1;--text-muted:#64748b;--accent:#3b82f6;--accent-dark:#1d4ed8;--error:#ef4444;--focus:#52a8ff}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    background:radial-gradient(1200px 600px at 50% -10%,#0b1220 0,var(--bg) 60%);color:var(--text);
    font-family:'Inter',system-ui,sans-serif;line-height:1.5}
  .card{width:100%;max-width:400px;background:var(--card);border:1px solid var(--border);border-radius:16px;
    padding:32px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:24px}
  .brand .dot{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,var(--accent),var(--accent-dark));
    display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px}
  .brand h1{font-size:16px;margin:0;font-weight:600}
  h2{font-size:22px;margin:0 0 4px;font-weight:700}
  .sub{color:var(--text-muted);font-size:14px;margin:0 0 24px}
  label{display:block;font-size:13px;font-weight:500;color:var(--text-sub);margin-bottom:14px}
  .opt{color:var(--text-muted);font-weight:400}
  input{width:100%;margin-top:6px;padding:11px 13px;background:#070912;border:1px solid var(--border);
    border-radius:9px;color:var(--text);font-size:15px;font-family:inherit;outline:none;transition:border-color .15s}
  input:focus{border-color:var(--focus);box-shadow:0 0 0 3px rgba(82,168,255,.15)}
  button{width:100%;margin-top:8px;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:9px;
    font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;transition:background .15s}
  button:hover{background:var(--accent-dark)}
  button:disabled{opacity:.6;cursor:default}
  .foot{margin-top:20px;text-align:center;font-size:14px}
  .foot a{color:var(--accent);text-decoration:none}
  .foot a:hover{text-decoration:underline}
  .msg{padding:10px 13px;border-radius:9px;font-size:13.5px;margin-bottom:18px}
  .err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#fca5a5}
  .note{font-size:12.5px;color:var(--text-muted);margin:0 0 20px}
</style>
</head>
<body>
  <div class="card">
    <div class="brand"><div class="dot">R</div><h1>Painel de Rastreamento</h1></div>
    <h2>${title}</h2>
    <p class="sub">${isRegister ? 'Configure seus pixels, gateways e links.' : 'Acesse sua dashboard.'}</p>
    ${error}
    ${firstNote}
    <form id="f" method="POST" action="/${isRegister ? 'register' : 'login'}">
      ${nameField}
      <label>E-mail
        <input name="email" type="email" autocomplete="email" required placeholder="voce@email.com"></label>
      <label>Senha
        <input name="password" type="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}" required minlength="8" placeholder="${isRegister ? 'Mínimo 8 caracteres' : '••••••••'}"></label>
      <button type="submit" id="btn">${title}</button>
    </form>
    <div class="foot">${other}</div>
  </div>
<script>
  var f=document.getElementById('f'),btn=document.getElementById('btn');
  f.addEventListener('submit',function(e){
    e.preventDefault();
    btn.disabled=true;btn.textContent='Aguarde...';
    var data={};new FormData(f).forEach(function(v,k){data[k]=v});
    fetch(f.action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
      .then(function(r){return r.json()})
      .then(function(j){
        if(j&&j.ok){location.href='/dashboard';return}
        showErr((j&&j.error)||'Não foi possível continuar.');
      })
      .catch(function(){showErr('Erro de conexão. Tente novamente.')});
  });
  function showErr(m){
    btn.disabled=false;btn.textContent=${JSON.stringify(title)};
    var ex=document.querySelector('.msg.err');
    if(ex){ex.textContent=m;return}
    var d=document.createElement('div');d.className='msg err';d.textContent=m;
    f.parentNode.insertBefore(d,f);
  }
</script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loginPage(opts) { return page(Object.assign({ mode: 'login' }, opts || {})); }
function registerPage(opts) { return page(Object.assign({ mode: 'register' }, opts || {})); }

module.exports = { loginPage, registerPage };
