// HTML da dashboard (servido inline pela rota protegida /dashboard)
module.exports = `<!DOCTYPE html>
<html lang="pt" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dashboard — Teste A/B de Gateway</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0b0f14;
      --card: #151b23;
      --card-2: #1c242e;
      --border: #263140;
      --text: #e7edf3;
      --muted: #8a97a6;
      --accent: #14e0d0;
      --accent-soft: rgba(20, 224, 208, 0.12);
      --warn: #ff5c72;
      --radius: 16px;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px;
      min-height: 100vh;
    }
    .wrap { max-width: 960px; margin: 0 auto; }
    header {
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 16px; margin-bottom: 24px;
    }
    h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
    .sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .actions { display: flex; gap: 8px; }
    button {
      font-family: inherit; font-size: 13px; font-weight: 600;
      color: var(--text); background: var(--card-2);
      border: 1px solid var(--border); border-radius: 10px;
      padding: 9px 14px; cursor: pointer; transition: all .15s ease;
    }
    button:hover { border-color: var(--accent); color: var(--accent); }
    button.danger:hover { border-color: var(--warn); color: var(--warn); }
    .grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
    @media (min-width: 720px) { .grid { grid-template-columns: 1fr 1fr; } }
    .card {
      background: var(--card); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 22px;
    }
    .card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
    .gw { font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; }
    .dot.stripe { background: var(--accent); }
    .dot.cooud { background: #a78bfa; }
    .badge {
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
      padding: 4px 9px; border-radius: 999px; background: var(--accent-soft); color: var(--accent);
    }
    .badge.win { background: var(--accent-soft); color: var(--accent); }
    .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .metric { background: var(--card-2); border-radius: 12px; padding: 14px; }
    .metric .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
    .metric .value { font-size: 26px; font-weight: 800; margin-top: 4px; letter-spacing: -0.02em; }
    .metric.full { grid-column: 1 / -1; }
    .rate { font-size: 34px; }
    .rev-line { font-size: 15px; font-weight: 600; }
    .rev-line + .rev-line { margin-top: 2px; }
    .empty { color: var(--muted); font-size: 13px; }
    .foot { margin-top: 22px; color: var(--muted); font-size: 12px; text-align: center; }
    .split-note {
      background: var(--accent-soft); border: 1px solid var(--border);
      border-radius: 12px; padding: 12px 16px; font-size: 13px; color: var(--muted);
      margin-bottom: 20px;
    }
    .split-note b { color: var(--text); }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>Teste A/B de Gateway</h1>
        <div class="sub" id="updated">A carregar…</div>
      </div>
      <div class="actions">
        <button id="refresh">Atualizar</button>
        <button id="reset" class="danger">Zerar dados</button>
      </div>
    </header>

    <div class="split-note">
      Divisão de tráfego <b>50% / 50%</b> na rota <b>/checkout</b> — sticky por visitante (cookie 30 dias).
      Stripe = checkout nativo &nbsp;·&nbsp; Cooud = checkout externo.
    </div>

    <div class="grid" id="cards"></div>

    <div class="foot">Atualização automática a cada 15s.</div>
  </div>

  <script>
    var LABELS = { stripe: 'Stripe (nativo)', cooud: 'Cooud (externo)' };

    function fmtRevenue(rev) {
      var keys = Object.keys(rev || {});
      if (!keys.length) return '<span class="empty">Sem receita ainda</span>';
      return keys.map(function (cur) {
        var val = (rev[cur] / 100).toLocaleString('pt-PT', { style: 'currency', currency: cur });
        return '<div class="rev-line">' + val + '</div>';
      }).join('');
    }

    function card(key, d, isWinner) {
      return '' +
        '<div class="card">' +
          '<div class="card-head">' +
            '<div class="gw"><span class="dot ' + key + '"></span>' + LABELS[key] + '</div>' +
            (isWinner ? '<span class="badge win">Melhor taxa</span>' : '') +
          '</div>' +
          '<div class="metrics">' +
            '<div class="metric"><div class="label">Visitantes</div><div class="value">' + d.assignments + '</div></div>' +
            '<div class="metric"><div class="label">Acessos checkout</div><div class="value">' + d.clicks + '</div></div>' +
            '<div class="metric"><div class="label">Conversões</div><div class="value">' + d.conversions + '</div></div>' +
            '<div class="metric"><div class="label">Taxa conversão</div><div class="value rate">' + d.conversionRate + '%</div></div>' +
            '<div class="metric full"><div class="label">Receita</div><div class="value" style="font-size:18px;margin-top:6px;">' + fmtRevenue(d.revenue) + '</div></div>' +
          '</div>' +
        '</div>';
    }

    function render(data) {
      var v = data.variants || {};
      var s = v.stripe || {}, c = v.cooud || {};
      var winner = null;
      if ((s.conversions || 0) + (c.conversions || 0) > 0) {
        winner = (s.conversionRate || 0) >= (c.conversionRate || 0) ? 'stripe' : 'cooud';
      }
      document.getElementById('cards').innerHTML =
        card('stripe', s, winner === 'stripe') + card('cooud', c, winner === 'cooud');
      var upd = data.updatedAt ? new Date(data.updatedAt).toLocaleString('pt-PT') : '—';
      document.getElementById('updated').textContent = 'Última atualização: ' + upd;
    }

    function load() {
      fetch('/api/stats', { credentials: 'include' })
        .then(function (r) { return r.json(); })
        .then(render)
        .catch(function () { document.getElementById('updated').textContent = 'Erro ao carregar dados.'; });
    }

    document.getElementById('refresh').addEventListener('click', load);
    document.getElementById('reset').addEventListener('click', function () {
      if (!confirm('Zerar todos os dados do teste A/B?')) return;
      fetch('/api/reset-stats', { method: 'POST', credentials: 'include' }).then(load);
    });

    load();
    setInterval(load, 15000);
  </script>
</body>
</html>`;
