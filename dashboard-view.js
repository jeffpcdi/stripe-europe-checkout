// HTML da dashboard (servido inline pela rota protegida /dashboard)
module.exports = `<!DOCTYPE html>
<html lang="pt" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dashboard — EventPay</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0a0d12;
      --panel: #10151c;
      --card: #141b24;
      --card-2: #1a222c;
      --border: #222c38;
      --border-soft: #1b232d;
      --text: #eef3f8;
      --muted: #7d8b9b;
      --muted-2: #5c6875;
      --accent: #16e0c8;
      --accent-soft: rgba(22, 224, 200, 0.1);
      --green: #34d399;
      --green-soft: rgba(52, 211, 153, 0.12);
      --red: #ff5d73;
      --red-soft: rgba(255, 93, 115, 0.12);
      --amber: #f5b544;
      --amber-soft: rgba(245, 181, 68, 0.12);
      --violet: #a78bfa;
      --violet-soft: rgba(167, 139, 250, 0.12);
      --radius: 16px;
      --radius-sm: 10px;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { background: var(--bg); }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      color: var(--text);
      line-height: 1.5;
      padding: 24px 20px 48px;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 1080px; margin: 0 auto; }

    /* Header */
    header {
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 16px; margin-bottom: 28px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand .mark {
      width: 38px; height: 38px; border-radius: 11px; flex-shrink: 0;
      background: var(--accent-soft); color: var(--accent);
      display: flex; align-items: center; justify-content: center;
      font-weight: 800; font-size: 18px;
    }
    h1 { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
    .sub { color: var(--muted); font-size: 12.5px; margin-top: 2px; display: flex; align-items: center; gap: 7px; }
    .live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 0 var(--green-soft); animation: pulse 2s infinite; }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(52,211,153,.4);} 70% { box-shadow: 0 0 0 6px rgba(52,211,153,0);} 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0);} }
    .actions { display: flex; gap: 8px; }
    button {
      font-family: inherit; font-size: 13px; font-weight: 600;
      color: var(--text); background: var(--card-2);
      border: 1px solid var(--border); border-radius: var(--radius-sm);
      padding: 9px 15px; cursor: pointer; transition: all .15s ease;
    }
    button:hover { border-color: var(--accent); color: var(--accent); }
    button.danger:hover { border-color: var(--red); color: var(--red); }

    /* Section title */
    .section-title {
      font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
      color: var(--muted-2); margin: 30px 2px 14px;
    }

    /* KPI overview */
    .kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    @media (min-width: 640px) { .kpis { grid-template-columns: repeat(3, 1fr); } }
    @media (min-width: 900px) { .kpis { grid-template-columns: repeat(5, 1fr); } }
    .kpi {
      background: var(--card); border: 1px solid var(--border-soft);
      border-radius: var(--radius); padding: 18px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .kpi .ico {
      width: 32px; height: 32px; border-radius: 9px;
      display: flex; align-items: center; justify-content: center;
    }
    .kpi .ico svg { width: 17px; height: 17px; }
    .kpi .label { font-size: 11.5px; color: var(--muted); font-weight: 500; }
    .kpi .value { font-size: 24px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
    .kpi .value small { font-size: 14px; font-weight: 600; color: var(--muted); }
    .ic-rev { background: var(--accent-soft); color: var(--accent); }
    .ic-sale { background: var(--green-soft); color: var(--green); }
    .ic-rate { background: var(--violet-soft); color: var(--violet); }
    .ic-refund { background: var(--amber-soft); color: var(--amber); }
    .ic-dispute { background: var(--red-soft); color: var(--red); }

    /* A/B cards */
    .grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
    @media (min-width: 720px) { .grid { grid-template-columns: 1fr 1fr; } }
    .card {
      background: var(--card); border: 1px solid var(--border-soft);
      border-radius: var(--radius); padding: 20px;
    }
    .card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .gw { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 9px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; }
    .dot.stripe { background: var(--accent); }
    .dot.cooud { background: var(--violet); }
    .badge {
      font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
      padding: 4px 9px; border-radius: 999px; background: var(--green-soft); color: var(--green);
    }
    .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .metric { background: var(--card-2); border-radius: var(--radius-sm); padding: 13px; }
    .metric .label { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .metric .value { font-size: 22px; font-weight: 800; margin-top: 3px; letter-spacing: -0.02em; }
    .metric.full { grid-column: 1 / -1; }
    .rate { color: var(--accent); }
    .rev-line { font-size: 15px; font-weight: 700; }
    .rev-line + .rev-line { margin-top: 2px; }
    .empty { color: var(--muted-2); font-size: 13px; }

    /* Split note */
    .split-note {
      display: flex; align-items: center; gap: 10px;
      background: var(--panel); border: 1px solid var(--border-soft);
      border-radius: var(--radius-sm); padding: 11px 15px; font-size: 12.5px; color: var(--muted);
      margin-bottom: 14px;
    }
    .split-note b { color: var(--text); font-weight: 600; }

    /* Feed */
    .feed-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin: 30px 2px 14px; }
    .feed-head .section-title { margin: 0; }
    .filters { display: flex; gap: 6px; flex-wrap: wrap; }
    .filters button { padding: 6px 12px; font-size: 12px; border-radius: 999px; }
    .filters button.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
    .feed { background: var(--card); border: 1px solid var(--border-soft); border-radius: var(--radius); overflow: hidden; }
    .row {
      display: flex; align-items: center; gap: 14px;
      padding: 14px 18px; border-bottom: 1px solid var(--border-soft);
    }
    .row:last-child { border-bottom: none; }
    .row .tico {
      width: 34px; height: 34px; border-radius: 9px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
    }
    .row .tico svg { width: 16px; height: 16px; }
    .t-sale { background: var(--green-soft); color: var(--green); }
    .t-failed { background: var(--red-soft); color: var(--red); }
    .t-refund { background: var(--amber-soft); color: var(--amber); }
    .t-dispute { background: var(--red-soft); color: var(--red); }
    .t-info { background: var(--card-2); color: var(--muted); }
    .row .main { flex: 1; min-width: 0; }
    .row .line1 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .row .title { font-size: 14px; font-weight: 600; }
    .row .gw-tag {
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
      padding: 2px 7px; border-radius: 6px; background: var(--card-2); color: var(--muted);
    }
    .row .gw-tag.stripe { color: var(--accent); }
    .row .gw-tag.cooud { color: var(--violet); }
    .row .line2 { font-size: 12.5px; color: var(--muted); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row .amount { font-size: 15px; font-weight: 800; letter-spacing: -0.02em; text-align: right; white-space: nowrap; }
    .row .amount.neg { color: var(--red); }
    .row .amount.pos { color: var(--green); }
    .row .time { font-size: 11.5px; color: var(--muted-2); margin-top: 2px; text-align: right; white-space: nowrap; }
    .feed-empty { padding: 48px 20px; text-align: center; color: var(--muted-2); font-size: 13.5px; }

    .foot { margin-top: 26px; color: var(--muted-2); font-size: 11.5px; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand">
        <div class="mark">E</div>
        <div>
          <h1>EventPay Dashboard</h1>
          <div class="sub"><span class="live-dot"></span><span id="updated">A carregar…</span></div>
        </div>
      </div>
      <div class="actions">
        <button id="refresh">Atualizar</button>
        <button id="reset" class="danger">Zerar dados</button>
      </div>
    </header>

    <!-- Visão geral -->
    <div class="section-title">Visão geral</div>
    <div class="kpis" id="kpis"></div>

    <!-- Teste A/B -->
    <div class="section-title">Teste A/B de gateway</div>
    <div class="split-note">
      Divisão <b>50% / 50%</b> na rota <b>/checkout</b> — sticky por visitante (cookie 30 dias).
      Stripe = nativo &nbsp;·&nbsp; Cooud = externo.
    </div>
    <div class="grid" id="cards"></div>

    <!-- Feed -->
    <div class="feed-head">
      <div class="section-title">Atividade em tempo real</div>
      <div class="filters" id="filters">
        <button data-f="all" class="on">Tudo</button>
        <button data-f="sale">Vendas</button>
        <button data-f="failed">Recusas</button>
        <button data-f="refund">Reembolsos</button>
        <button data-f="dispute">Disputas</button>
      </div>
    </div>
    <div class="feed" id="feed"></div>

    <div class="foot">Atualização automática a cada 12s · fuso Europe/Lisbon</div>
  </div>

  <script>
    var LABELS = { stripe: 'Stripe (nativo)', cooud: 'Cooud (externo)' };
    var GW_LABEL = { stripe: 'Stripe', cooud: 'Cooud' };
    var currentFilter = 'all';
    var lastData = null;

    var ICONS = {
      rev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
      sale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
      rate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
      refund: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
      dispute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      failed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    function money(cents, currency) {
      return ((cents || 0) / 100).toLocaleString('pt-PT', { style: 'currency', currency: (currency || 'EUR').toUpperCase() });
    }
    function fmtRevenueObj(rev, sep) {
      var keys = Object.keys(rev || {});
      if (!keys.length) return null;
      return keys.map(function (cur) { return money(rev[cur], cur); }).join(sep || ' · ');
    }
    function timeAgo(iso) {
      var d = new Date(iso), diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 60) return 'agora mesmo';
      if (diff < 3600) return Math.floor(diff / 60) + ' min atrás';
      if (diff < 86400) return Math.floor(diff / 3600) + ' h atrás';
      return d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }

    /* ---- KPIs ---- */
    function kpi(cls, ico, label, value) {
      return '<div class="kpi">' +
        '<div class="ico ' + cls + '">' + ico + '</div>' +
        '<div><div class="value">' + value + '</div><div class="label">' + label + '</div></div>' +
      '</div>';
    }
    function renderKpis(t) {
      var rev = fmtRevenueObj(t.revenue, ' · ') || '<small>Sem receita</small>';
      document.getElementById('kpis').innerHTML =
        kpi('ic-rev', ICONS.rev, 'Receita total', rev) +
        kpi('ic-sale', ICONS.sale, 'Vendas aprovadas', t.sales) +
        kpi('ic-rate', ICONS.rate, 'Taxa de aprovação', t.approvalRate + '%') +
        kpi('ic-refund', ICONS.refund, 'Reembolsos', t.refunds) +
        kpi('ic-dispute', ICONS.dispute, 'Disputas', t.disputes);
    }

    /* ---- A/B cards ---- */
    function card(key, d, isWinner) {
      return '<div class="card">' +
          '<div class="card-head">' +
            '<div class="gw"><span class="dot ' + key + '"></span>' + LABELS[key] + '</div>' +
            (isWinner ? '<span class="badge">Melhor taxa</span>' : '') +
          '</div>' +
          '<div class="metrics">' +
            '<div class="metric"><div class="label">Visitantes</div><div class="value">' + d.assignments + '</div></div>' +
            '<div class="metric"><div class="label">Acessos</div><div class="value">' + d.clicks + '</div></div>' +
            '<div class="metric"><div class="label">Conversões</div><div class="value">' + d.conversions + '</div></div>' +
            '<div class="metric"><div class="label">Taxa</div><div class="value rate">' + d.conversionRate + '%</div></div>' +
            '<div class="metric full"><div class="label">Receita</div><div class="value" style="font-size:16px;margin-top:5px;">' + (fmtRevenueObj(d.revenue, ' · ') || '<span class="empty">Sem receita ainda</span>') + '</div></div>' +
          '</div>' +
        '</div>';
    }
    function renderCards(v) {
      var s = v.stripe || {}, c = v.cooud || {};
      var winner = null;
      if ((s.conversions || 0) + (c.conversions || 0) > 0) {
        winner = (s.conversionRate || 0) >= (c.conversionRate || 0) ? 'stripe' : 'cooud';
      }
      document.getElementById('cards').innerHTML =
        card('stripe', s, winner === 'stripe') + card('cooud', c, winner === 'cooud');
    }

    /* ---- Feed ---- */
    function eventRow(e) {
      var ico = ICONS[e.type] || ICONS.info;
      var neg = (e.type === 'refund' || e.type === 'dispute');
      var amountCls = e.type === 'sale' ? 'pos' : (neg ? 'neg' : '');
      var amountHtml = (e.amount != null)
        ? '<div class="amount ' + amountCls + '">' + (neg ? '-' : '') + money(e.amount, e.currency) + '</div>'
        : '<div class="amount"></div>';

      var details = [];
      if (e.customer) details.push(esc(e.customer));
      if (e.email) details.push(esc(e.email));
      if (e.card) details.push(esc(e.card));
      if (e.reason) details.push('Motivo: ' + esc(e.reason));
      if (e.country) details.push(esc(e.country));
      if (e.ref) details.push(esc(e.ref));

      var gwTag = e.gateway ? '<span class="gw-tag ' + e.gateway + '">' + (GW_LABEL[e.gateway] || e.gateway) + '</span>' : '';

      return '<div class="row">' +
        '<div class="tico t-' + e.type + '">' + ico + '</div>' +
        '<div class="main">' +
          '<div class="line1"><span class="title">' + esc(e.title || e.type) + '</span>' + gwTag + '</div>' +
          '<div class="line2">' + (details.join(' &nbsp;·&nbsp; ') || '&nbsp;') + '</div>' +
        '</div>' +
        '<div>' + amountHtml + '<div class="time">' + timeAgo(e.at) + '</div></div>' +
      '</div>';
    }
    function renderFeed(events) {
      var list = (events || []).filter(function (e) { return currentFilter === 'all' || e.type === currentFilter; });
      var el = document.getElementById('feed');
      if (!list.length) {
        el.innerHTML = '<div class="feed-empty">Nenhuma atividade ' + (currentFilter === 'all' ? 'registada ainda' : 'deste tipo') + '.</div>';
        return;
      }
      el.innerHTML = list.slice(0, 100).map(eventRow).join('');
    }

    /* ---- Load ---- */
    function render(data) {
      lastData = data;
      renderKpis(data.totals || {});
      renderCards(data.variants || {});
      renderFeed(data.events || []);
      var upd = data.updatedAt ? new Date(data.updatedAt).toLocaleString('pt-PT') : '—';
      document.getElementById('updated').textContent = 'Atualizado: ' + upd;
    }
    function load() {
      fetch('/api/stats', { credentials: 'include' })
        .then(function (r) { return r.json(); })
        .then(render)
        .catch(function () { document.getElementById('updated').textContent = 'Erro ao carregar dados.'; });
    }

    document.getElementById('refresh').addEventListener('click', load);
    document.getElementById('reset').addEventListener('click', function () {
      if (!confirm('Zerar todos os dados (A/B + atividade)?')) return;
      fetch('/api/reset-stats', { method: 'POST', credentials: 'include' }).then(load);
    });
    document.getElementById('filters').addEventListener('click', function (ev) {
      var btn = ev.target.closest('button'); if (!btn) return;
      currentFilter = btn.getAttribute('data-f');
      Array.prototype.forEach.call(this.children, function (b) { b.classList.toggle('on', b === btn); });
      if (lastData) renderFeed(lastData.events || []);
    });

    load();
    setInterval(load, 12000);
  </script>
</body>
</html>`;
