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
      flex-wrap: wrap; gap: 16px; margin-bottom: 18px;
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
    .live-dot.off { background: var(--muted-2); animation: none; }
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

    /* Toolbar */
    .toolbar {
      display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
      background: var(--panel); border: 1px solid var(--border-soft);
      border-radius: var(--radius); padding: 12px 14px; margin-bottom: 26px;
    }
    .toolbar .group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .toolbar .lbl { font-size: 11px; color: var(--muted-2); text-transform: uppercase; letter-spacing: .05em; font-weight: 700; }
    .pills { display: flex; gap: 4px; background: var(--card); border: 1px solid var(--border-soft); border-radius: 999px; padding: 3px; }
    .pills button { padding: 6px 13px; font-size: 12px; border-radius: 999px; border: none; background: transparent; }
    .pills button:hover { color: var(--accent); }
    .pills button.on { background: var(--accent-soft); color: var(--accent); }
    select {
      font-family: inherit; font-size: 12.5px; font-weight: 600; color: var(--text);
      background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-sm);
      padding: 7px 10px; cursor: pointer;
    }
    .switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12.5px; color: var(--muted); user-select: none; }
    .switch .track { width: 38px; height: 22px; border-radius: 999px; background: var(--card-2); border: 1px solid var(--border); position: relative; transition: all .15s ease; }
    .switch .knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--muted); transition: all .15s ease; }
    .switch.on .track { background: var(--accent-soft); border-color: var(--accent); }
    .switch.on .knob { left: 18px; background: var(--accent); }
    .switch.on { color: var(--text); }

    /* Section title */
    .section-title {
      font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
      color: var(--muted-2); margin: 30px 2px 14px;
      display: flex; align-items: center; gap: 10px;
    }
    .section-title .tag { font-size: 9.5px; font-weight: 700; letter-spacing: .04em; padding: 2px 8px; border-radius: 999px; background: var(--card-2); color: var(--muted); }

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

    /* Chart */
    .chart-card { background: var(--card); border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 20px; margin-top: 14px; }
    .chart-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
    .chart-head .t { font-size: 14px; font-weight: 700; }
    .chart-toggle { display: flex; gap: 4px; background: var(--panel); border: 1px solid var(--border-soft); border-radius: 999px; padding: 3px; }
    .chart-toggle button { padding: 5px 12px; font-size: 11.5px; border-radius: 999px; border: none; background: transparent; }
    .chart-toggle button.on { background: var(--violet-soft); color: var(--violet); }
    .chart-wrap { width: 100%; overflow: hidden; }
    svg.chart { width: 100%; height: auto; display: block; }
    svg.chart .bar { fill: var(--accent); transition: opacity .15s ease; }
    svg.chart .bar.cnt { fill: var(--violet); }
    svg.chart .bar:hover { opacity: .75; }
    svg.chart .axis { fill: var(--muted-2); font-size: 10px; font-family: 'Inter', sans-serif; }
    svg.chart .grid { stroke: var(--border-soft); stroke-width: 1; }

    /* A/B cards */
    .grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
    @media (min-width: 720px) { .grid { grid-template-columns: 1fr 1fr; } }
    .card {
      background: var(--card); border: 1px solid var(--border-soft);
      border-radius: var(--radius); padding: 20px;
    }
    .card.win { border-color: rgba(52,211,153,.4); box-shadow: 0 0 0 1px rgba(52,211,153,.15); }
    .card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .gw { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 9px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; }
    .dot.stripe { background: var(--accent); }
    .dot.cooud { background: var(--violet); }
    .badge {
      font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
      padding: 4px 9px; border-radius: 999px; background: var(--green-soft); color: var(--green);
    }
    .metrics { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
    .metric { background: var(--card-2); border-radius: var(--radius-sm); padding: 13px; }
    .metric .label { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .metric .value { font-size: 20px; font-weight: 800; margin-top: 3px; letter-spacing: -0.02em; }
    .metric.full { grid-column: 1 / -1; }
    .metric.rpv .value { color: var(--accent); }
    .rate { color: var(--violet); }
    .empty { color: var(--muted-2); font-size: 13px; }

    /* Verdict banner */
    .verdict {
      display: flex; align-items: flex-start; gap: 12px;
      border-radius: var(--radius); padding: 15px 18px; margin-bottom: 14px; font-size: 13px; line-height: 1.5;
      background: var(--panel); border: 1px solid var(--border-soft);
    }
    .verdict svg { width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; color: var(--accent); }
    .verdict.win svg { color: var(--green); }
    .verdict .msg { color: var(--text); }
    .verdict .msg b { font-weight: 700; }
    .verdict .msg .vt { display: block; font-weight: 700; margin-bottom: 2px; }
    .conf-bar { height: 6px; border-radius: 999px; background: var(--card-2); margin-top: 8px; overflow: hidden; max-width: 320px; }
    .conf-bar > span { display: block; height: 100%; background: var(--green); border-radius: 999px; }

    /* Split note */
    .split-note {
      display: flex; align-items: center; gap: 10px;
      background: var(--panel); border: 1px solid var(--border-soft);
      border-radius: var(--radius-sm); padding: 11px 15px; font-size: 12.5px; color: var(--muted);
      margin-bottom: 14px;
    }
    .split-note b { color: var(--text); font-weight: 600; }

    /* Alert (reconciliação + práticas) */
    .alert {
      display: flex; align-items: flex-start; gap: 12px;
      border-radius: var(--radius); padding: 15px 18px; margin-bottom: 14px;
      font-size: 13px; line-height: 1.5;
    }
    .alert svg { width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }
    .alert.ok { background: var(--green-soft); border: 1px solid rgba(52,211,153,.25); color: var(--green); }
    .alert.warn { background: var(--amber-soft); border: 1px solid rgba(245,181,68,.25); color: var(--amber); }
    .alert.bad { background: var(--red-soft); border: 1px solid rgba(255,93,115,.3); color: var(--red); }
    .alert.info { background: var(--card); border: 1px solid var(--border-soft); color: var(--muted); }
    .alert b { font-weight: 700; }
    .alert .msg { color: var(--text); }
    .alert .msg .lead-title { display:block; font-weight: 700; margin-bottom: 2px; }

    .recon { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 14px; }
    @media (min-width: 640px) { .recon { grid-template-columns: repeat(3, 1fr); } }
    @media (min-width: 900px) { .recon { grid-template-columns: repeat(6, 1fr); } }
    .rc {
      background: var(--card); border: 1px solid var(--border-soft);
      border-radius: var(--radius-sm); padding: 14px;
    }
    .rc .label { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
    .rc .value { font-size: 22px; font-weight: 800; margin-top: 5px; letter-spacing: -0.02em; }
    .rc .value.warn { color: var(--amber); }
    .rc .value.bad { color: var(--red); }
    .rc .value.ok { color: var(--green); }
    .rc .value.accent { color: var(--accent); }
    .rc .value.violet { color: var(--violet); }

    /* Práticas do gateway */
    .practices { display: grid; grid-template-columns: 1fr; gap: 12px; margin-bottom: 14px; }
    @media (min-width: 640px) { .practices { grid-template-columns: 1fr 1fr; } }
    .practice { background: var(--card); border: 1px solid var(--border-soft); border-radius: var(--radius); padding: 18px; display: flex; gap: 14px; align-items: flex-start; }
    .practice.hit { border-color: rgba(245,181,68,.35); }
    .practice .pico { width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--amber-soft); color: var(--amber); }
    .practice.violet .pico { background: var(--violet-soft); color: var(--violet); }
    .practice .pico svg { width: 19px; height: 19px; }
    .practice .pt { font-size: 14px; font-weight: 700; }
    .practice .pd { font-size: 12px; color: var(--muted); margin-top: 3px; line-height: 1.45; }
    .practice .pv { font-size: 22px; font-weight: 800; margin-top: 8px; letter-spacing: -0.02em; }
    .practice .pv small { font-size: 12px; font-weight: 600; color: var(--muted); }

    /* Tabela de leads */
    .lead-table { background: var(--card); border: 1px solid var(--border-soft); border-radius: var(--radius); overflow: hidden; }
    .lead-table .lt-head, .lead-table .lt-row {
      display: grid; grid-template-columns: 1.4fr 1fr 1fr 0.9fr 1fr; gap: 10px;
      padding: 12px 16px; align-items: center;
    }
    .lead-table .lt-head { background: var(--panel); font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted-2); font-weight: 700; }
    .lead-table .lt-row { border-top: 1px solid var(--border-soft); font-size: 12.5px; cursor: pointer; transition: background .12s ease; }
    .lead-table .lt-row:hover { background: var(--card-2); }
    .lead-table .lt-row .mono { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 11.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .st { font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px; display: inline-block; text-transform: uppercase; letter-spacing: .03em; }
    .st.converted { background: var(--green-soft); color: var(--green); }
    .st.pending { background: var(--amber-soft); color: var(--amber); }
    .st.orphan { background: var(--red-soft); color: var(--red); }
    .chip { font-size: 9.5px; font-weight: 700; padding: 2px 6px; border-radius: 5px; margin-left: 5px; }
    .chip.cap { background: var(--amber-soft); color: var(--amber); }
    .chip.rec { background: var(--violet-soft); color: var(--violet); }
    .lt-empty { padding: 40px 20px; text-align: center; color: var(--muted-2); font-size: 13px; }
    @media (max-width: 640px) {
      .lead-table .lt-head { display: none; }
      .lead-table .lt-row { grid-template-columns: 1fr 1fr; gap: 6px; }
      .lead-table .lt-row .col-ref { grid-column: 1 / -1; }
    }

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
    .t-lead { background: var(--violet-soft); color: var(--violet); }
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

    /* Drawer detalhe do lead */
    .overlay { position: fixed; inset: 0; background: rgba(4,7,10,.6); opacity: 0; pointer-events: none; transition: opacity .2s ease; z-index: 40; }
    .overlay.open { opacity: 1; pointer-events: auto; }
    .drawer {
      position: fixed; top: 0; right: 0; height: 100%; width: 400px; max-width: 92vw; z-index: 50;
      background: var(--panel); border-left: 1px solid var(--border);
      transform: translateX(100%); transition: transform .22s ease; overflow-y: auto;
      padding: 22px;
    }
    .drawer.open { transform: translateX(0); }
    .drawer .dh { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .drawer .dh h3 { font-size: 16px; font-weight: 800; }
    .drawer .close { padding: 6px 10px; }
    .drawer .dsub { font-size: 11.5px; color: var(--muted-2); font-family: ui-monospace, monospace; margin-bottom: 18px; word-break: break-all; }
    .dfield { padding: 11px 0; border-top: 1px solid var(--border-soft); display: flex; justify-content: space-between; gap: 14px; font-size: 13px; }
    .dfield .k { color: var(--muted); flex-shrink: 0; }
    .dfield .v { text-align: right; font-weight: 600; word-break: break-word; }
    .dfield .v.mono { font-family: ui-monospace, monospace; font-size: 11.5px; font-weight: 500; color: var(--muted); }

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
          <div class="sub"><span class="live-dot" id="live"></span><span id="updated">A carregar…</span></div>
        </div>
      </div>
      <div class="actions">
        <button id="refresh">Atualizar</button>
        <button id="reset" class="danger">Zerar dados</button>
      </div>
    </header>

    <!-- Toolbar -->
    <div class="toolbar">
      <div class="group">
        <span class="lbl">Período</span>
        <div class="pills" id="periods">
          <button data-p="hoje">Hoje</button>
          <button data-p="7d">7 dias</button>
          <button data-p="30d">30 dias</button>
          <button data-p="tudo" class="on">Tudo</button>
        </div>
      </div>
      <div class="group">
        <div class="switch on" id="auto-toggle"><span class="track"><span class="knob"></span></span><span>Auto</span></div>
        <select id="interval">
          <option value="5000">5s</option>
          <option value="12000" selected>12s</option>
          <option value="30000">30s</option>
          <option value="60000">60s</option>
        </select>
        <div class="switch" id="sound-toggle"><span class="track"><span class="knob"></span></span><span>Som</span></div>
      </div>
    </div>

    <!-- Visão geral -->
    <div class="section-title">Visão geral <span class="tag" id="period-tag">Tudo</span></div>
    <div class="kpis" id="kpis"></div>

    <!-- Gráfico -->
    <div class="chart-card">
      <div class="chart-head">
        <div class="t">Tendência de vendas</div>
        <div class="chart-toggle" id="chart-toggle">
          <button data-m="rev" class="on">Receita</button>
          <button data-m="cnt">Nº de vendas</button>
        </div>
      </div>
      <div class="chart-wrap" id="chart"></div>
    </div>

    <!-- Teste A/B -->
    <div class="section-title">Teste A/B de gateway <span class="tag">acumulado</span></div>
    <div class="split-note">
      Divisão <b>50% / 50%</b> na rota <b>/checkout</b> — sticky por visitante (cookie 30 dias).
      Stripe = nativo &nbsp;·&nbsp; Cooud = externo. Vencedor por <b>receita por visitante (RPV)</b>.
    </div>
    <div id="ab-verdict"></div>
    <div class="grid" id="cards"></div>

    <!-- Práticas do gateway Cooud -->
    <div class="section-title">Práticas do gateway Cooud <span class="tag">Smart Capture · Recuperar Prejuízo</span></div>
    <div id="practice-alert"></div>
    <div class="practices" id="practices"></div>

    <!-- Conciliação Cooud (anti-desvio) -->
    <div class="section-title">Conciliação Cooud — Anti-desvio <span class="tag">acumulado</span></div>
    <div id="cooud-alert"></div>
    <div class="recon" id="recon"></div>
    <div class="section-title" style="margin-top:22px;">Rastreamento de leads (Cooud) <span class="tag">clique para detalhes</span></div>
    <div class="lead-table" id="leads">
      <div class="lt-head">
        <div>Lead / Cliente</div><div>Status</div><div>Valor reportado</div><div>Esperado</div><div>Quando</div>
      </div>
      <div id="leads-body"></div>
    </div>

    <!-- Feed -->
    <div class="feed-head">
      <div class="section-title">Atividade em tempo real</div>
      <div class="filters" id="filters">
        <button data-f="all" class="on">Tudo</button>
        <button data-f="sale">Vendas</button>
        <button data-f="lead">Leads</button>
        <button data-f="failed">Recusas</button>
        <button data-f="refund">Reembolsos</button>
        <button data-f="dispute">Disputas</button>
      </div>
    </div>
    <div class="feed" id="feed"></div>

    <div class="foot" id="foot">Atualização automática · fuso Europe/Lisbon</div>
  </div>

  <!-- Drawer -->
  <div class="overlay" id="overlay"></div>
  <div class="drawer" id="drawer">
    <div class="dh"><h3>Detalhe do lead</h3><button class="close" id="drawer-close">Fechar</button></div>
    <div class="dsub" id="drawer-id"></div>
    <div id="drawer-body"></div>
  </div>

  <script>
    var LABELS = { stripe: 'Stripe (nativo)', cooud: 'Cooud (externo)' };
    var GW_LABEL = { stripe: 'Stripe', cooud: 'Cooud' };
    var currentFilter = 'all';
    var currentPeriod = 'tudo';
    var chartMode = 'rev';
    var autoOn = true;
    var soundOn = false;
    var intervalMs = 12000;
    var timer = null;
    var lastData = null;
    var seenSaleIds = null; // null = primeira carga (não toca som)
    var leadsById = {};

    var ICONS = {
      rev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
      sale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
      rate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
      refund: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
      dispute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      failed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      lead: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
      shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
      zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
      rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
      trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    /* ---- Utils ---- */
    function money(cents, currency) {
      return ((cents || 0) / 100).toLocaleString('pt-PT', { style: 'currency', currency: (currency || 'EUR').toUpperCase() });
    }
    function fmtRevenueObj(rev, sep) {
      var keys = Object.keys(rev || {});
      if (!keys.length) return null;
      return keys.map(function (cur) { return money(rev[cur], cur); }).join(sep || ' · ');
    }
    function timeAgo(iso) {
      if (!iso) return '—';
      var d = new Date(iso), diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 60) return 'agora mesmo';
      if (diff < 3600) return Math.floor(diff / 60) + ' min atrás';
      if (diff < 86400) return Math.floor(diff / 3600) + ' h atrás';
      return d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    function fmtDur(ms) {
      if (ms == null) return '—';
      var s = Math.round(ms / 1000);
      if (s < 60) return s + 's';
      if (s < 3600) return Math.round(s / 60) + ' min';
      if (s < 86400) return (s / 3600).toFixed(1) + ' h';
      return (s / 86400).toFixed(1) + ' dias';
    }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }

    function primaryCurrency(events) {
      var totals = {};
      (events || []).forEach(function (e) {
        if (e.type === 'sale' && e.amount != null) {
          var c = (e.currency || 'EUR').toUpperCase();
          totals[c] = (totals[c] || 0) + e.amount;
        }
      });
      var best = 'EUR', bestV = -1;
      Object.keys(totals).forEach(function (c) { if (totals[c] > bestV) { bestV = totals[c]; best = c; } });
      return best;
    }
    function periodStart(p) {
      var now = new Date();
      if (p === 'hoje') { var d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
      if (p === '7d') return now.getTime() - 7 * 864e5;
      if (p === '30d') return now.getTime() - 30 * 864e5;
      return 0;
    }
    function eventsInPeriod(events, p) {
      var start = periodStart(p);
      return (events || []).filter(function (e) { return new Date(e.at).getTime() >= start; });
    }

    /* ---- KPIs (por período) ---- */
    function kpi(cls, ico, label, value) {
      return '<div class="kpi">' +
        '<div class="ico ' + cls + '">' + ico + '</div>' +
        '<div><div class="value">' + value + '</div><div class="label">' + label + '</div></div>' +
      '</div>';
    }
    function computeTotals(events) {
      var revenue = {}, sales = 0, failed = 0, refunds = 0, disputes = 0;
      events.forEach(function (e) {
        if (e.type === 'sale') {
          sales++;
          if (e.amount != null) { var c = (e.currency || 'EUR').toUpperCase(); revenue[c] = (revenue[c] || 0) + e.amount; }
        } else if (e.type === 'failed') failed++;
        else if (e.type === 'refund') refunds++;
        else if (e.type === 'dispute') disputes++;
      });
      var attempts = sales + failed;
      return { revenue: revenue, sales: sales, failed: failed, refunds: refunds, disputes: disputes,
        approvalRate: attempts ? +((sales / attempts) * 100).toFixed(1) : 0 };
    }
    function renderKpis(t) {
      var rev = fmtRevenueObj(t.revenue, ' · ') || '<small>Sem receita</small>';
      document.getElementById('kpis').innerHTML =
        kpi('ic-rev', ICONS.rev, 'Receita', rev) +
        kpi('ic-sale', ICONS.sale, 'Vendas aprovadas', t.sales) +
        kpi('ic-rate', ICONS.rate, 'Taxa de aprovação', t.approvalRate + '%') +
        kpi('ic-refund', ICONS.refund, 'Reembolsos', t.refunds) +
        kpi('ic-dispute', ICONS.dispute, 'Disputas', t.disputes);
    }

    /* ---- Gráfico ---- */
    function chartBuckets(events, p) {
      var arr = [];
      if (p === 'hoje') {
        var s0 = new Date(); s0.setHours(0, 0, 0, 0);
        for (var h = 0; h < 24; h++) {
          arr.push({ label: (h < 10 ? '0' + h : h) + 'h', start: s0.getTime() + h * 36e5, end: s0.getTime() + (h + 1) * 36e5, rev: 0, cnt: 0 });
        }
      } else {
        var n = p === '7d' ? 7 : 30;
        var d0 = new Date(); d0.setHours(0, 0, 0, 0);
        for (var i = n - 1; i >= 0; i--) {
          var st = d0.getTime() - i * 864e5; var dd = new Date(st);
          arr.push({ label: dd.getDate() + '/' + (dd.getMonth() + 1), start: st, end: st + 864e5, rev: 0, cnt: 0 });
        }
      }
      var cur = primaryCurrency(events);
      events.forEach(function (e) {
        if (e.type !== 'sale') return;
        var t = new Date(e.at).getTime();
        for (var k = 0; k < arr.length; k++) {
          if (t >= arr[k].start && t < arr[k].end) {
            arr[k].cnt++;
            if (e.amount != null && (e.currency || 'EUR').toUpperCase() === cur) arr[k].rev += e.amount;
            break;
          }
        }
      });
      return { buckets: arr, cur: cur };
    }
    function renderChart(events) {
      var evs = eventsInPeriod(events, currentPeriod);
      var data = chartBuckets(evs, currentPeriod);
      var arr = data.buckets;
      var vals = arr.map(function (a) { return chartMode === 'rev' ? a.rev : a.cnt; });
      var max = Math.max.apply(null, vals.concat([1]));
      var W = 720, H = 220, padB = 26, padT = 10, padL = 4, padR = 4;
      var innerH = H - padB - padT;
      var n = arr.length;
      var gap = n > 20 ? 2 : 5;
      var bw = (W - padL - padR - gap * (n - 1)) / n;
      var labelStep = Math.ceil(n / 8);
      var bars = '', labels = '';
      var baseY = H - padB;
      arr.forEach(function (a, idx) {
        var v = chartMode === 'rev' ? a.rev : a.cnt;
        var bh = max > 0 ? (v / max) * innerH : 0;
        var x = padL + idx * (bw + gap);
        var y = baseY - bh;
        var tip = a.label + ': ' + (chartMode === 'rev' ? money(a.rev, data.cur) : (a.cnt + ' venda(s)'));
        bars += '<rect class="bar ' + (chartMode === 'cnt' ? 'cnt' : '') + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
          '" width="' + bw.toFixed(1) + '" height="' + Math.max(bh, v > 0 ? 2 : 0).toFixed(1) + '" rx="3"><title>' + esc(tip) + '</title></rect>';
        if (idx % labelStep === 0) {
          labels += '<text class="axis" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(a.label) + '</text>';
        }
      });
      var maxLabel = chartMode === 'rev' ? money(max, data.cur) : max + '';
      var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
        '<line class="grid" x1="0" y1="' + baseY + '" x2="' + W + '" y2="' + baseY + '"/>' +
        '<text class="axis" x="2" y="' + (padT + 8) + '">' + esc(maxLabel) + '</text>' +
        bars + labels + '</svg>';
      var hasData = vals.some(function (v) { return v > 0; });
      document.getElementById('chart').innerHTML = hasData ? svg :
        '<div class="feed-empty">Sem vendas neste período.</div>';
    }

    /* ---- Inteligência A/B (RPV + significância) ---- */
    function erf(x) {
      var t = 1 / (1 + 0.3275911 * Math.abs(x));
      var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
      return x >= 0 ? y : -y;
    }
    function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
    function abVerdict(v) {
      var s = v.stripe || {}, c = v.cooud || {};
      var cur = primaryCurrency((lastData && lastData.events) || []);
      var sRev = (s.revenue && s.revenue[cur]) || 0, cRev = (c.revenue && c.revenue[cur]) || 0;
      var sRPV = s.assignments ? sRev / s.assignments : 0;
      var cRPV = c.assignments ? cRev / c.assignments : 0;
      var el = document.getElementById('ab-verdict');

      var totalConv = (s.conversions || 0) + (c.conversions || 0);
      if (!totalConv || (!s.assignments && !c.assignments)) {
        el.innerHTML = '<div class="verdict">' + ICONS.info +
          '<div class="msg"><span class="vt">A recolher dados</span>Ainda não há conversões suficientes para declarar um vencedor. Continue a dividir o tráfego.</div></div>';
        return { cur: cur, sRPV: sRPV, cRPV: cRPV };
      }

      var winner = cRPV >= sRPV ? 'cooud' : 'stripe';
      var wRPV = Math.max(sRPV, cRPV), lRPV = Math.min(sRPV, cRPV);
      var uplift = lRPV > 0 ? ((wRPV - lRPV) / lRPV) * 100 : 0;

      // z-test em taxa de conversão
      var nA = s.assignments || 0, nB = c.assignments || 0;
      var xA = s.conversions || 0, xB = c.conversions || 0;
      var conf = 0;
      if (nA && nB) {
        var pA = xA / nA, pB = xB / nB, pP = (xA + xB) / (nA + nB);
        var se = Math.sqrt(pP * (1 - pP) * (1 / nA + 1 / nB));
        if (se > 0) { var z = Math.abs(pA - pB) / se; conf = (2 * normCdf(z) - 1) * 100; }
      }
      var sig = conf >= 95;
      var cls = sig ? 'verdict win' : 'verdict';
      var ico = sig ? ICONS.trophy : ICONS.info;
      var head = sig ? ('Vencedor: ' + LABELS[winner]) : ('Tendência: ' + LABELS[winner] + ' (ainda sem significância)');
      var body = '<b>' + money(wRPV, cur) + '</b> por visitante vs <b>' + money(lRPV, cur) + '</b> — ' +
        (uplift > 0 ? '+' + uplift.toFixed(1) + '% de RPV' : 'empate') + '. ' +
        (sig ? 'Diferença estatisticamente significativa.' : 'Confiança ainda baixa — recolha mais dados antes de decidir.');
      el.innerHTML = '<div class="' + cls + '">' + ico +
        '<div class="msg"><span class="vt">' + head + '</span>' + body +
        '<div class="conf-bar"><span style="width:' + Math.min(conf, 100).toFixed(0) + '%"></span></div>' +
        '<div style="font-size:11.5px;color:var(--muted);margin-top:5px">Confiança estatística: ' + conf.toFixed(1) + '%</div>' +
        '</div></div>';
      return { cur: cur, sRPV: sRPV, cRPV: cRPV, winner: sig ? winner : null };
    }

    /* ---- A/B cards ---- */
    function card(key, d, isWinner, rpv, cur) {
      return '<div class="card' + (isWinner ? ' win' : '') + '">' +
          '<div class="card-head">' +
            '<div class="gw"><span class="dot ' + key + '"></span>' + LABELS[key] + '</div>' +
            (isWinner ? '<span class="badge">Vencedor</span>' : '') +
          '</div>' +
          '<div class="metrics">' +
            '<div class="metric"><div class="label">Visitantes</div><div class="value">' + d.assignments + '</div></div>' +
            '<div class="metric"><div class="label">Conversões</div><div class="value">' + d.conversions + '</div></div>' +
            '<div class="metric"><div class="label">Taxa</div><div class="value rate">' + d.conversionRate + '%</div></div>' +
            '<div class="metric rpv"><div class="label">RPV</div><div class="value">' + money(rpv, cur) + '</div></div>' +
            '<div class="metric full"><div class="label">Receita</div><div class="value" style="font-size:16px;margin-top:5px;">' + (fmtRevenueObj(d.revenue, ' · ') || '<span class="empty">Sem receita ainda</span>') + '</div></div>' +
          '</div>' +
        '</div>';
    }
    function renderCards(v, intel) {
      var s = v.stripe || {}, c = v.cooud || {};
      document.getElementById('cards').innerHTML =
        card('stripe', s, intel.winner === 'stripe', intel.sRPV, intel.cur) +
        card('cooud', c, intel.winner === 'cooud', intel.cRPV, intel.cur);
    }

    /* ---- Práticas do gateway Cooud ---- */
    function renderPractices(c) {
      c = c || {};
      var capN = c.smartCapture || 0, recN = c.recovery || 0;
      var capExtra = fmtRevenueObj(c.captureExtraRev, ' · ');
      var recRev = fmtRevenueObj(c.recoveryRev, ' · ');
      document.getElementById('practices').innerHTML =
        '<div class="practice' + (capN ? ' hit' : '') + '">' +
          '<div class="pico">' + ICONS.zap + '</div>' +
          '<div><div class="pt">Smart Capture</div>' +
          '<div class="pd">Captura inteligente do Cooud: cobra valor acima do esperado ou re-captura o cartão. Detetado por valor extra ou reportes duplicados.</div>' +
          '<div class="pv">' + capN + ' <small>venda(s)' + (capExtra ? ' · +' + capExtra + ' extra' : '') + '</small></div></div>' +
        '</div>' +
        '<div class="practice violet' + (recN ? ' hit' : '') + '">' +
          '<div class="pico">' + ICONS.rotate + '</div>' +
          '<div><div class="pt">Recuperar Prejuízo</div>' +
          '<div class="pd">Recuperação de vendas recusadas/abandonadas via nova tentativa. Detetado por conversão que chega mais de 1h após o envio do lead.</div>' +
          '<div class="pv">' + recN + ' <small>venda(s)' + (recRev ? ' · ' + recRev : '') + '</small></div></div>' +
        '</div>';

      var el = document.getElementById('practice-alert');
      if (capN || recN) {
        var parts = [];
        if (capN) parts.push('<b>' + capN + '</b> com Smart Capture' + (capExtra ? ' (+' + capExtra + ' cobrados além do preço)' : ''));
        if (recN) parts.push('<b>' + recN + '</b> via Recuperar Prejuízo');
        el.innerHTML = '<div class="alert warn">' + ICONS.zap +
          '<div class="msg"><span class="lead-title">Funções do Cooud ativas nas suas contas</span>' +
          'Detetámos ' + parts.join(' e ') + '. Estas funções do Cooud cobram os seus clientes de forma adicional/re-tentada — confirme que estão de acordo com a sua operação, pois afetam o valor real e a experiência do cliente.</div></div>';
      } else {
        el.innerHTML = '<div class="alert info">' + ICONS.info +
          '<div class="msg">Nenhum sinal de Smart Capture ou Recuperar Prejuízo nas vendas do Cooud até agora.</div></div>';
      }
    }

    /* ---- Conciliação Cooud (anti-desvio) ---- */
    function rc(label, value, cls) {
      return '<div class="rc"><div class="label">' + label + '</div>' +
        '<div class="value ' + (cls || '') + '">' + value + '</div></div>';
    }
    function renderRecon(c) {
      c = c || {};
      var reported = fmtRevenueObj(c.reportedRev, ' · ') || '—';
      document.getElementById('recon').innerHTML =
        rc('Leads enviados', c.sent || 0, 'violet') +
        rc('Vendas conciliadas', c.matched || 0, 'ok') +
        rc('Órfãs (sem lead)', c.orphans || 0, (c.orphans ? 'bad' : '')) +
        rc('Pendentes', c.pending || 0, (c.pending ? 'warn' : '')) +
        rc('Taxa Cooud', (c.convRate || 0) + '%', 'accent') +
        rc('Receita reportada', '<span style="font-size:15px">' + reported + '</span>');

      var alertEl = document.getElementById('cooud-alert');
      var msgs = [];
      var level = 'ok';
      var stripeRate = c.stripeConvRate || 0;

      if (c.orphans > 0) {
        level = 'bad';
        msgs.push('<b>' + c.orphans + ' venda(s) órfã(s):</b> o Cooud reportou vendas sem o nosso identificador de lead. Verifique se são legítimas — pode indicar atribuição indevida.');
      }
      if (c.duplicates > 0) {
        if (level !== 'bad') level = 'warn';
        msgs.push('<b>' + c.duplicates + ' reporte(s) duplicado(s):</b> o mesmo lead foi reportado como venda mais de uma vez.');
      }
      if (c.valueMismatch > 0) {
        level = 'bad';
        msgs.push('<b>' + c.valueMismatch + ' venda(s) com valor menor que o esperado:</b> o valor reportado pelo Cooud está abaixo do preço de tabela.');
      }
      if ((c.sent || 0) >= 20 && stripeRate > 0 && c.convRate > 0 && c.convRate < stripeRate * 0.6) {
        if (level !== 'bad') level = 'warn';
        msgs.push('<b>Taxa de conversão suspeita:</b> Cooud em ' + c.convRate + '% vs Stripe em ' + stripeRate + '%. Uma diferença grande pode indicar vendas não reportadas.');
      }
      if ((c.sent || 0) >= 20 && c.matched === 0 && c.convRate === 0) {
        level = 'bad';
        msgs.push('<b>Nenhuma venda conciliada:</b> enviámos ' + c.sent + ' leads e o Cooud não reportou nenhuma venda correspondente.');
      }
      if (!msgs.length) {
        msgs.push('Tudo certo. Todas as vendas reportadas pelo Cooud têm lead correspondente e valores conferem.');
      }
      var ico = level === 'ok' ? ICONS.shield : ICONS.dispute;
      alertEl.innerHTML = '<div class="alert ' + level + '">' + ico +
        '<div class="msg"><span class="lead-title">' +
        (level === 'ok' ? 'Sem sinais de desvio' : 'Atenção — possíveis inconsistências') +
        '</span>' + msgs.join('<br>') + '</div></div>';
    }

    function leadStatus(l) {
      if (l.orphan) return '<span class="st orphan">Órfã</span>';
      if (l.status === 'converted') return '<span class="st converted">Convertida</span>';
      return '<span class="st pending">Pendente</span>';
    }
    function leadChips(l) {
      var out = '';
      if (l.smartCapture) out += '<span class="chip cap">Capture</span>';
      if (l.recovery) out += '<span class="chip rec">Recuperada</span>';
      return out;
    }
    function leadRow(l) {
      var who = l.customer || l.email || (l.orphan ? 'Origem desconhecida' : 'Lead anónimo');
      var reported = (l.reportedAmount != null && l.status === 'converted')
        ? money(l.reportedAmount, l.reportedCurrency) : '—';
      var expected = l.expectedAmount ? money(l.expectedAmount, l.expectedCurrency) : '—';
      return '<div class="lt-row" data-lead="' + esc(l.id) + '">' +
        '<div><div>' + esc(who) + leadChips(l) + '</div><div class="mono col-ref">' + esc(l.id) + '</div></div>' +
        '<div>' + leadStatus(l) + '</div>' +
        '<div>' + reported + '</div>' +
        '<div style="color:var(--muted)">' + expected + '</div>' +
        '<div style="color:var(--muted-2);font-size:11.5px">' + timeAgo(l.convertedAt || l.at) + '</div>' +
      '</div>';
    }
    function renderLeads(leads) {
      var el = document.getElementById('leads-body');
      var list = (leads || []).filter(function (l) { return l.gateway === 'cooud'; });
      leadsById = {};
      list.forEach(function (l) { leadsById[l.id] = l; });
      if (!list.length) {
        el.innerHTML = '<div class="lt-empty">Nenhum lead enviado ao Cooud ainda.</div>';
        return;
      }
      el.innerHTML = list.slice(0, 80).map(leadRow).join('');
    }

    /* ---- Drawer detalhe do lead ---- */
    function df(k, v, mono) { return '<div class="dfield"><span class="k">' + k + '</span><span class="v' + (mono ? ' mono' : '') + '">' + v + '</span></div>'; }
    function openLead(id) {
      var l = leadsById[id]; if (!l) return;
      document.getElementById('drawer-id').textContent = l.id;
      var utm = l.utm || {};
      var utmStr = ['source', 'medium', 'campaign', 'content', 'term']
        .map(function (k) { return utm[k] ? k + '=' + utm[k] : null; }).filter(Boolean).join(' · ') || '—';
      var body =
        df('Estado', l.orphan ? '<span class="st orphan">Órfã</span>' : (l.status === 'converted' ? '<span class="st converted">Convertida</span>' : '<span class="st pending">Pendente</span>')) +
        df('Cliente', esc(l.customer || '—')) +
        df('Email', esc(l.email || '—')) +
        df('Valor esperado', l.expectedAmount ? money(l.expectedAmount, l.expectedCurrency) : '—') +
        df('Valor reportado', l.reportedAmount != null ? money(l.reportedAmount, l.reportedCurrency) : '—') +
        (l.captureExtra ? df('Cobrado a mais', '<span style="color:var(--amber)">+' + money(l.captureExtra, l.reportedCurrency) + '</span>') : '') +
        df('Smart Capture', l.smartCapture ? '<span style="color:var(--amber)">Sim</span>' : 'Não') +
        df('Recuperar Prejuízo', l.recovery ? '<span style="color:var(--violet)">Sim</span>' : 'Não') +
        df('Tempo até conversão', fmtDur(l.conversionAgeMs)) +
        (l.duplicateReports ? df('Reportes duplicados', l.duplicateReports) : '') +
        df('Enviado em', l.at ? new Date(l.at).toLocaleString('pt-PT') : '—') +
        df('Convertido em', l.convertedAt ? new Date(l.convertedAt).toLocaleString('pt-PT') : '—') +
        df('UTM', esc(utmStr), true) +
        df('ttclid', esc(l.ttclid || '—'), true) +
        df('IP', esc(l.ip || '—'), true) +
        df('Referer', esc(l.referer || '—'), true) +
        df('User-agent', esc(l.ua || '—'), true);
      document.getElementById('drawer-body').innerHTML = body;
      document.getElementById('drawer').classList.add('open');
      document.getElementById('overlay').classList.add('open');
    }
    function closeDrawer() {
      document.getElementById('drawer').classList.remove('open');
      document.getElementById('overlay').classList.remove('open');
    }

    /* ---- Feed (por período + filtro) ---- */
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
      if (e.practice) details.push('<span style="color:var(--amber)">' + esc(e.practice) + '</span>');
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
      var list = eventsInPeriod(events, currentPeriod).filter(function (e) { return currentFilter === 'all' || e.type === currentFilter; });
      var el = document.getElementById('feed');
      if (!list.length) {
        el.innerHTML = '<div class="feed-empty">Nenhuma atividade ' + (currentFilter === 'all' ? 'neste período' : 'deste tipo') + '.</div>';
        return;
      }
      el.innerHTML = list.slice(0, 100).map(eventRow).join('');
    }

    /* ---- Som ---- */
    function beep() {
      try {
        var Ac = window.AudioContext || window.webkitAudioContext;
        var ac = new Ac();
        var o = ac.createOscillator(), g = ac.createGain();
        o.connect(g); g.connect(ac.destination);
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.001, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.4);
        o.start(); o.stop(ac.currentTime + 0.42);
      } catch (e) {}
    }
    function detectNewSales(events) {
      var ids = {};
      (events || []).forEach(function (e) { if (e.type === 'sale') ids[e.id] = true; });
      if (seenSaleIds === null) { seenSaleIds = ids; return; } // primeira carga
      var isNew = false;
      Object.keys(ids).forEach(function (id) { if (!seenSaleIds[id]) isNew = true; });
      seenSaleIds = ids;
      if (isNew && soundOn) beep();
    }

    /* ---- Render principal ---- */
    function render(data) {
      lastData = data;
      var evPeriod = eventsInPeriod(data.events || [], currentPeriod);
      renderKpis(computeTotals(evPeriod));
      renderChart(data.events || []);
      var intel = abVerdict(data.variants || {});
      renderCards(data.variants || {}, intel);
      renderPractices(data.cooud || {});
      renderRecon(data.cooud || {});
      renderLeads(data.leads || []);
      renderFeed(data.events || []);
      detectNewSales(data.events || []);
      var upd = data.updatedAt ? new Date(data.updatedAt).toLocaleString('pt-PT') : '—';
      document.getElementById('updated').textContent = 'Atualizado: ' + upd;
    }
    function load() {
      fetch('/api/stats', { credentials: 'include' })
        .then(function (r) { return r.json(); })
        .then(render)
        .catch(function () { document.getElementById('updated').textContent = 'Erro ao carregar dados.'; });
    }

    /* ---- Auto-refresh ---- */
    function restartTimer() {
      if (timer) clearInterval(timer);
      if (autoOn) timer = setInterval(load, intervalMs);
      document.getElementById('live').classList.toggle('off', !autoOn);
      document.getElementById('foot').textContent = autoOn
        ? ('Atualização automática a cada ' + (intervalMs / 1000) + 's · fuso Europe/Lisbon')
        : 'Atualização automática desligada · fuso Europe/Lisbon';
    }

    /* ---- Eventos de UI ---- */
    document.getElementById('refresh').addEventListener('click', load);
    document.getElementById('reset').addEventListener('click', function () {
      if (!confirm('Zerar todos os dados (A/B + leads + atividade)?')) return;
      fetch('/api/reset-stats', { method: 'POST', credentials: 'include' }).then(function () { seenSaleIds = null; load(); });
    });
    document.getElementById('filters').addEventListener('click', function (ev) {
      var btn = ev.target.closest('button'); if (!btn) return;
      currentFilter = btn.getAttribute('data-f');
      Array.prototype.forEach.call(this.children, function (b) { b.classList.toggle('on', b === btn); });
      if (lastData) renderFeed(lastData.events || []);
    });
    document.getElementById('periods').addEventListener('click', function (ev) {
      var btn = ev.target.closest('button'); if (!btn) return;
      currentPeriod = btn.getAttribute('data-p');
      Array.prototype.forEach.call(this.children, function (b) { b.classList.toggle('on', b === btn); });
      document.getElementById('period-tag').textContent = btn.textContent;
      if (lastData) render(lastData);
    });
    document.getElementById('chart-toggle').addEventListener('click', function (ev) {
      var btn = ev.target.closest('button'); if (!btn) return;
      chartMode = btn.getAttribute('data-m');
      Array.prototype.forEach.call(this.children, function (b) { b.classList.toggle('on', b === btn); });
      if (lastData) renderChart(lastData.events || []);
    });
    document.getElementById('auto-toggle').addEventListener('click', function () {
      autoOn = !autoOn; this.classList.toggle('on', autoOn); restartTimer();
    });
    document.getElementById('sound-toggle').addEventListener('click', function () {
      soundOn = !soundOn; this.classList.toggle('on', soundOn);
      if (soundOn) beep();
    });
    document.getElementById('interval').addEventListener('change', function () {
      intervalMs = parseInt(this.value, 10) || 12000; restartTimer();
    });
    document.getElementById('leads-body').addEventListener('click', function (ev) {
      var row = ev.target.closest('.lt-row'); if (!row) return;
      openLead(row.getAttribute('data-lead'));
    });
    document.getElementById('overlay').addEventListener('click', closeDrawer);
    document.getElementById('drawer-close').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

    load();
    restartTimer();
  </script>
</body>
</html>`;
