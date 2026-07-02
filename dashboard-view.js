// Dashboard "Pulse" — servida como HTML estático em /dashboard.
// Todos os dados são carregados via /api/stats, /api/config e /api/health (client-side).
// IMPORTANTE: este arquivo é uma template string — não usar crase nem ${ } no conteúdo.
module.exports = `<!DOCTYPE html>
<html lang="pt" class="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0a0a0f" />
<title>Pulse — Radar de Vendas & Funil</title>
<link rel="icon" href="/assets/logo.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
<script src="https://unpkg.com/globe.gl"></script>
<style>
:root{
  --bg:#0a0a0f; --panel:#101018; --card:#14141e; --card2:#1a1a26; --hover:#20202e;
  --border:rgba(255,255,255,.08); --border2:rgba(255,255,255,.14);
  --text:#f3f3f7; --muted:#a2a2b4; --muted2:#6c6c80;
  --cyan:#25f4ee; --pink:#fe2c55; --green:#2fe6a8; --amber:#ffcb47; --red:#ff4d67;
  --radius:16px; --radius-sm:11px;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{font-family:'Space Grotesk','Inter',sans-serif;margin:0;letter-spacing:-.01em}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:#26263a;border-radius:8px}
::-webkit-scrollbar-track{background:transparent}

/* ── Layout ── */
.app{display:flex;min-height:100vh}
.sidebar{width:248px;flex-shrink:0;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.brand{display:flex;align-items:center;gap:12px;padding:20px 18px;border-bottom:1px solid var(--border)}
.brand img{width:40px;height:40px;border-radius:11px;box-shadow:0 0 0 1px var(--border),0 8px 24px rgba(37,244,238,.14)}
.brand .bt{font-family:'Space Grotesk';font-weight:700;font-size:19px;line-height:1}
.brand .bs{font-size:11px;color:var(--muted2);margin-top:3px}
.nav{padding:12px 10px;display:flex;flex-direction:column;gap:2px;flex:1;overflow-y:auto}
.nav .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted2);padding:14px 12px 6px}
.nav button{display:flex;align-items:center;gap:11px;width:100%;text-align:left;cursor:pointer;background:transparent;border:0;color:var(--muted);padding:10px 12px;border-radius:11px;font-size:14px;font-weight:500;font-family:inherit;transition:.15s}
.nav button svg{width:18px;height:18px;flex-shrink:0}
.nav button:hover{background:var(--hover);color:var(--text)}
.nav button.active{background:linear-gradient(90deg,rgba(37,244,238,.16),rgba(254,44,85,.12));color:var(--text);box-shadow:inset 0 0 0 1px var(--border2)}
.nav button.active svg{color:var(--cyan)}
.nav .badge{margin-left:auto;background:var(--pink);color:#fff;font-size:10px;font-weight:700;padding:1px 7px;border-radius:20px}
.side-foot{padding:14px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--muted2)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin-right:6px;box-shadow:0 0 8px var(--green)}
.dot.off{background:var(--red);box-shadow:0 0 8px var(--red)}

.main{flex:1;min-width:0;display:flex;flex-direction:column}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:16px 26px;background:rgba(10,10,15,.88);backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
.topbar h2{font-size:20px}
.topbar .sub{font-size:12.5px;color:var(--muted2)}
.spacer{flex:1}
.segment{display:flex;background:var(--card);border:1px solid var(--border);border-radius:11px;padding:3px;gap:2px}
.segment button{background:transparent;border:0;color:var(--muted);font-size:12.5px;font-weight:600;font-family:inherit;padding:7px 12px;border-radius:8px;cursor:pointer;transition:.15s}
.segment button.active{background:var(--pink);color:#fff}
.refresh{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)}
.switch{position:relative;width:38px;height:22px;flex-shrink:0}
.switch input{opacity:0;width:0;height:0}
.slider{position:absolute;inset:0;background:#2a2a3a;border-radius:20px;cursor:pointer;transition:.2s}
.slider:before{content:'';position:absolute;height:16px;width:16px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}
input:checked+.slider{background:var(--cyan)}
input:checked+.slider:before{transform:translateX(16px)}
.select,.inp{background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:9px;padding:8px 10px;font-family:inherit;font-size:13px;outline:none}
.select:focus,.inp:focus{border-color:var(--border2)}
.btn{background:var(--card);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:9px 15px;font-family:inherit;font-weight:600;font-size:13px;cursor:pointer;transition:.15s}
.btn:hover{background:var(--hover)}
.btn svg{width:16px;height:16px;display:block}
.btn.primary{background:var(--cyan);color:#04121a;border-color:transparent}
.btn.primary:hover{filter:brightness(1.08)}
.btn.danger{border-color:rgba(255,77,103,.5);color:var(--red)}
.btn.danger:hover{background:rgba(255,77,103,.12)}
.btn-sm{padding:5px 10px;font-size:12px;border-radius:8px}
.btn-icon{background:var(--card2);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:5px 8px;cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;transition:.15s;white-space:nowrap}
.btn-icon:hover{background:var(--hover);color:var(--text)}

.content{padding:24px 26px 60px}
section.view{display:none;animation:fade .28s ease}
section.view.active{display:block}
@keyframes fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* ── Loading skeleton ── */
#loading-screen{position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:100;flex-direction:column;gap:14px;transition:opacity .3s}
#loading-screen.hide{opacity:0;pointer-events:none}
.spin{width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--cyan);border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.load-text{font-size:13.5px;color:var(--muted);font-weight:500}

/* ── Cards & KPIs ── */
.grid{display:grid;gap:16px}
.kpis{grid-template-columns:repeat(auto-fit,minmax(186px,1fr))}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:18px}
.card.tint-cyan{background:linear-gradient(160deg,rgba(37,244,238,.10),var(--card))}
.card.tint-pink{background:linear-gradient(160deg,rgba(254,44,85,.10),var(--card))}
.card.tint-green{background:linear-gradient(160deg,rgba(47,230,168,.10),var(--card))}
.card.tint-amber{background:linear-gradient(160deg,rgba(255,203,71,.10),var(--card))}
.kpi .k-top{display:flex;align-items:center;gap:9px;color:var(--muted);font-size:12.5px;font-weight:500}
.kpi .k-ico{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:var(--card2);flex-shrink:0}
.kpi .k-ico svg{width:17px;height:17px}
.kpi .k-val{font-family:'Space Grotesk';font-weight:700;font-size:28px;margin-top:12px;letter-spacing:-.02em;line-height:1}
.kpi .k-sub{font-size:12px;color:var(--muted2);margin-top:6px}
.k-val.small{font-size:22px}
.k-val.xsmall{font-size:17px}
.pos{color:var(--green)} .neg{color:var(--red)} .cyn{color:var(--cyan)} .pnk{color:var(--pink)} .amb{color:var(--amber)}

.section-title{display:flex;align-items:center;gap:10px;margin:28px 0 14px;font-size:14px;font-weight:600;color:var(--muted)}
.section-title .line{flex:1;height:1px;background:var(--border)}

/* ── Gráfico ── */
.chart-wrap{position:relative;min-height:220px;width:100%}
.chart-legend{display:flex;gap:18px;font-size:12px;color:var(--muted);margin-top:12px;flex-wrap:wrap}
.leg-dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:middle}

/* ── Funil ── */
.funnel{display:flex;flex-direction:column;gap:12px}
.fstep{display:flex;align-items:center;gap:14px}
.fbar-track{flex:1;height:48px;background:var(--card2);border-radius:12px;overflow:hidden;position:relative}
.fbar{height:100%;border-radius:12px;display:flex;align-items:center;padding:0 16px;font-weight:700;font-family:'Space Grotesk';color:#04121a;min-width:54px;transition:width .7s cubic-bezier(.2,.8,.2,1)}
.fstep .flabel{width:158px;flex-shrink:0}
.fstep .flabel b{display:block;font-size:14px}
.fstep .flabel span{font-size:11.5px;color:var(--muted2)}
.frate{width:60px;text-align:right;font-weight:700;font-family:'Space Grotesk';color:var(--cyan);font-size:15px}

/* ── Tabela ── */
.tbl-tools{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
.tbl-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius)}
table{width:100%;border-collapse:collapse;font-size:13px;min-width:640px}
th{text-align:left;font-weight:600;color:var(--muted2);font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:11px 14px;border-bottom:1px solid var(--border);white-space:nowrap;position:sticky;top:0;background:var(--card)}
td{padding:11px 14px;border-bottom:1px solid var(--border);white-space:nowrap}
tr:last-child td{border-bottom:0}
tbody tr{cursor:pointer;transition:.12s}
tbody tr:hover{background:var(--hover)}
.tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;border:1px solid var(--border2)}
.tag.visit{color:var(--muted);background:var(--card2)}
.tag.checkout{color:var(--amber);background:rgba(255,203,71,.12);border-color:rgba(255,203,71,.3)}
.tag.purchased{color:var(--green);background:rgba(47,230,168,.12);border-color:rgba(47,230,168,.3)}
.tag.stripe{color:#8ab4ff;background:rgba(120,150,255,.12);border-color:rgba(120,150,255,.3)}
.tag.cooud{color:var(--pink);background:rgba(254,44,85,.12);border-color:rgba(254,44,85,.3)}
.tag.cap{color:var(--amber);background:rgba(255,203,71,.12);border-color:rgba(255,203,71,.3)}
.tag.rec{color:var(--cyan);background:rgba(37,244,238,.12);border-color:rgba(37,244,238,.3)}
.tag.orphan{color:var(--red);background:rgba(255,77,103,.12);border-color:rgba(255,77,103,.3)}
.muted{color:var(--muted2)}
.empty{padding:48px;text-align:center;color:var(--muted2);font-size:13px}
.tbl-count{font-size:12px;color:var(--muted2);margin-left:auto}

/* ── Geo ── */
.geo-grid{display:grid;grid-template-columns:1.3fr .9fr;gap:16px}
#globe{width:100%;height:440px;border-radius:var(--radius);overflow:hidden;background:radial-gradient(circle at 50% 40%,#101226,#05050a)}
.clist{display:flex;flex-direction:column;gap:2px;max-height:440px;overflow-y:auto}
.crow{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:11px;transition:.12s}
.crow:hover{background:var(--hover)}
.crow .flag{font-size:22px;width:30px;text-align:center;flex-shrink:0}
.crow .cn{flex:1;min-width:0}
.crow .cn b{font-size:13.5px;display:block}
.crow .cn span{font-size:11.5px;color:var(--muted2)}
.crow .cbar{width:80px;height:5px;background:var(--card2);border-radius:4px;overflow:hidden;flex-shrink:0}
.crow .cbar i{display:block;height:100%;background:linear-gradient(90deg,var(--cyan),var(--pink))}
.crow .cval{font-family:'Space Grotesk';font-weight:700;width:30px;text-align:right;font-size:14px;flex-shrink:0}

/* ── A/B ── */
.ab-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.verdict{border:1px solid var(--border2);border-radius:var(--radius);padding:20px;background:linear-gradient(160deg,rgba(37,244,238,.08),var(--card))}
.verdict .win{font-family:'Space Grotesk';font-size:26px;font-weight:700;margin-top:6px}
.vgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}
.vcell{background:var(--card2);border-radius:12px;padding:14px}
.vcell .vt{font-size:11.5px;color:var(--muted2)}
.vcell .vv{font-family:'Space Grotesk';font-weight:700;font-size:20px;margin-top:5px}
.conf-bar{height:8px;background:var(--card2);border-radius:6px;overflow:hidden;margin-top:8px}
.conf-bar i{display:block;height:100%;transition:width .8s ease,background .4s}

/* ── Config form ── */
.form-row{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}
.form-row label{font-size:12.5px;color:var(--muted);font-weight:600}
.form-row .hint{font-size:11.5px;color:var(--muted2);font-weight:400}
.range-wrap{display:flex;align-items:center;gap:14px}
input[type=range]{flex:1;accent-color:var(--cyan)}
.split-preview{display:flex;height:34px;border-radius:10px;overflow:hidden;font-size:12px;font-weight:700;color:#04121a}
.split-preview .sp-stripe{background:var(--cyan);display:grid;place-items:center;transition:width .3s}
.split-preview .sp-cooud{background:var(--pink);color:#fff;display:grid;place-items:center;flex:1}

/* ── Atividade ── */
.feed{display:flex;flex-direction:column}
.ev{display:flex;gap:13px;padding:13px 4px;border-bottom:1px solid var(--border)}
.ev:last-child{border-bottom:0}
.ev .ei{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex-shrink:0;background:var(--card2)}
.ev .ei svg{width:16px;height:16px}
.ev .et{font-size:13.5px;font-weight:600}
.ev .em{font-size:12px;color:var(--muted2);margin-top:2px}
.ev .ea{margin-left:auto;text-align:right;font-size:12px;color:var(--muted2);white-space:nowrap;flex-shrink:0}
.ev .amt{font-family:'Space Grotesk';font-weight:700;font-size:14px}

/* ── Alertas ── */
.alert{display:flex;gap:12px;align-items:flex-start;border-radius:var(--radius);padding:15px 17px;margin-bottom:16px;border:1px solid rgba(255,203,71,.3);background:rgba(255,203,71,.08)}
.alert.info{border-color:rgba(37,244,238,.3);background:rgba(37,244,238,.07)}
.alert.ok{border-color:rgba(47,230,168,.3);background:rgba(47,230,168,.07)}
.alert.err{border-color:rgba(255,77,103,.3);background:rgba(255,77,103,.07)}
.alert svg{width:20px;height:20px;flex-shrink:0;color:var(--amber);margin-top:1px}
.alert.info svg{color:var(--cyan)} .alert.ok svg{color:var(--green)} .alert.err svg{color:var(--red)}
.alert b{display:block;font-size:13.5px}
.alert p{margin:3px 0 0;font-size:12.5px;color:var(--muted)}

/* ── Drawer ── */
.drawer-bg{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:.2s;z-index:40}
.drawer-bg.open{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;height:100vh;width:min(460px,94vw);background:var(--panel);border-left:1px solid var(--border);transform:translateX(100%);transition:.28s cubic-bezier(.2,.8,.2,1);z-index:50;display:flex;flex-direction:column}
.drawer.open{transform:none}
.drawer-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--border);gap:10px}
.drawer-head h3{font-size:16px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drawer-head .head-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.x{background:var(--card);border:1px solid var(--border);color:var(--muted);width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:18px;display:grid;place-items:center}
.drawer-body{padding:20px;overflow-y:auto;flex:1}
.dl{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px}
.dl:last-child{border-bottom:0}
.dl .dk{color:var(--muted2);flex-shrink:0}
.dl .dv{font-weight:600;text-align:right;word-break:break-all;max-width:240px}
.dgroup{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted2);margin:18px 0 4px;font-weight:600}

/* ── Btn-icon (copiar ID, etc.) ── */
.btn-icon{background:var(--card2);border:1px solid var(--border);color:var(--muted);height:30px;padding:0 10px;border-radius:8px;cursor:pointer;font-size:11.5px;font-weight:600;letter-spacing:.02em;display:inline-flex;align-items:center;gap:5px;transition:color .15s,border-color .15s}
.btn-icon:hover{color:var(--cyan);border-color:var(--cyan)}

/* ── Gráfico A/B ── */
#ab-chart-card{overflow:hidden}
#ab-chart svg{display:block;overflow:visible}

/* ── Toast ── */
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(80px);background:var(--card);border:1px solid var(--border2);color:var(--text);padding:12px 20px;border-radius:12px;font-size:13.5px;font-weight:600;z-index:60;transition:.3s;box-shadow:0 12px 40px rgba(0,0,0,.5);pointer-events:none}
.toast.show{transform:translateX(-50%) translateY(0)}
.toast.ok{border-color:rgba(47,230,168,.5)} .toast.err{border-color:rgba(255,77,103,.5)}

/* ── Health dots ── */
.health-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:14px}
.hitem{display:flex;align-items:center;gap:10px;padding:11px 14px;background:var(--card2);border-radius:10px;border:1px solid var(--border);font-size:13px}
.hitem .hdot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.hitem .hdot.ok{background:var(--green);box-shadow:0 0 8px rgba(47,230,168,.5)}
.hitem .hdot.warn{background:var(--red);box-shadow:0 0 8px rgba(255,77,103,.5)}
.hitem .hlbl{flex:1;font-weight:500}
.hitem .hstatus{font-size:11.5px;font-weight:600}
.hitem .hstatus.ok{color:var(--green)} .hitem .hstatus.warn{color:var(--red)}

/* ── Responsivo ── */
@media(max-width:960px){
  .sidebar{position:fixed;left:0;top:0;transform:translateX(-100%);transition:.25s;z-index:70}
  .sidebar.open{transform:none}
  .geo-grid,.ab-grid{grid-template-columns:1fr}
  .menu-toggle{display:grid!important}
  .kpis{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
}
.menu-toggle{display:none;place-items:center;width:38px;height:38px;border-radius:10px;background:var(--card);border:1px solid var(--border);cursor:pointer}
.menu-toggle svg{width:20px;height:20px}
</style>
</head>
<body>

<!-- Tela de carregamento -->
<div id="loading-screen">
  <div class="spin"></div>
  <div class="load-text">Carregando Pulse...</div>
</div>

<div class="app">
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      <img src="/assets/logo.png" alt="Logo Pulse" />
      <div>
        <div class="bt">Pulse</div>
        <div class="bs">Radar de Vendas & Funil</div>
      </div>
    </div>
    <nav class="nav" id="nav">
      <div class="lbl">Painel</div>
      <button data-view="overview" class="active"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/></svg><span>Visão Geral</span></button>
      <button data-view="funnel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h18l-7 8v7l-4 2v-9z"/></svg><span>Funil & Leads</span></button>
      <button data-view="geo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20 15 15 0 010-20z"/></svg><span>Países</span></button>
      <div class="lbl">Otimização</div>
      <button data-view="ab"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3"/></svg><span>Teste A/B</span></button>
      <button data-view="cooud"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/></svg><span>Anti-desvio</span><span class="badge" id="nav-cooud-badge" style="display:none">!</span></button>
      <button data-view="activity"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg><span>Atividade</span></button>
      <div class="lbl">Sistema</div>
      <button data-view="config"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06.06a1.65 1.65 0 00.33-1.82V8a1.65 1.65 0 001.51-1H22a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg><span>Configurações</span></button>
    </nav>
    <div class="side-foot">
      <div><span class="dot" id="live-dot"></span>Ao vivo &middot; <span id="foot-updated">—</span></div>
      <div style="margin-top:5px;opacity:.7">Pulse v3</div>
    </div>
  </aside>

  <div class="main">
    <div class="topbar">
      <div class="menu-toggle" id="menuToggle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg></div>
      <div>
        <h2 id="page-title">Visão Geral</h2>
        <div class="sub" id="page-sub">Resumo dos números que mais importam</div>
      </div>
      <div class="spacer"></div>
      <div class="segment" id="period">
        <button data-p="today">Hoje</button>
        <button data-p="7d" class="active">7 dias</button>
        <button data-p="30d">30 dias</button>
        <button data-p="all">Tudo</button>
      </div>
      <div class="refresh">
        <label class="switch"><input type="checkbox" id="ar-toggle" checked /><span class="slider"></span></label>
        <span>Auto</span>
        <select class="select" id="ar-interval" style="padding:6px 8px">
          <option value="5000">5s</option>
          <option value="12000" selected>12s</option>
          <option value="30000">30s</option>
        </select>
        <button class="btn" id="refresh-btn" title="Atualizar agora"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg></button>
      </div>
    </div>

    <div class="content">

      <!-- ── Visão Geral ── -->
      <section class="view active" id="view-overview">
        <div class="grid kpis" id="ov-kpis"></div>
        <div class="section-title"><span>Tendência</span><span class="line"></span>
          <div class="segment" id="chart-mode" style="padding:2px">
            <button data-m="revenue" class="active">Receita</button>
            <button data-m="sales">Vendas</button>
          </div>
        </div>
        <div class="card">
          <div class="chart-wrap" id="chart"></div>
          <div class="chart-legend">
            <span><span class="leg-dot" style="background:var(--cyan)"></span>Stripe</span>
            <span><span class="leg-dot" style="background:var(--pink)"></span>Externo</span>
          </div>
        </div>
        <div class="section-title"><span>Destaques</span><span class="line"></span></div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))" id="ov-highlights"></div>
      </section>

      <!-- ── Funil & Leads ── -->
      <section class="view" id="view-funnel">
        <div class="grid kpis" id="fn-kpis"></div>
        <div class="section-title"><span>Funil de conversão</span><span class="line"></span></div>
        <div class="card"><div class="funnel" id="funnel-bars"></div></div>
        <div class="section-title"><span>Por gateway</span><span class="line"></span></div>
        <div class="grid" style="grid-template-columns:1fr 1fr" id="fn-gateways"></div>
        <div class="section-title"><span>Leads rastreados</span><span class="line"></span></div>
        <div class="tbl-tools">
          <input class="inp" id="lead-search" placeholder="Buscar por país, id, cliente, campanha..." style="flex:1;min-width:180px" />
          <select class="select" id="lead-stage">
            <option value="">Todas as etapas</option>
            <option value="visit">Visita</option>
            <option value="checkout">Checkout</option>
            <option value="purchased">Comprou</option>
          </select>
          <select class="select" id="lead-gw">
            <option value="">Todos gateways</option>
            <option value="stripe">Stripe</option>
            <option value="cooud">Cooud</option>
          </select>
          <span class="tbl-count" id="leads-count"></span>
        </div>
        <div class="tbl-wrap"><table id="leads-table">
          <thead><tr><th>Lead</th><th>Etapa</th><th>Checkout</th><th>País</th><th>Origem</th><th>Valor</th><th>Quando</th></tr></thead>
          <tbody id="leads-body"></tbody>
        </table></div>
      </section>

      <!-- ── Países ── -->
      <section class="view" id="view-geo">
        <div class="grid kpis" id="geo-kpis"></div>
        <div class="section-title"><span>De onde vêm seus leads</span><span class="line"></span></div>
        <div class="geo-grid">
          <div class="card" style="padding:0"><div id="globe"></div></div>
          <div class="card"><div class="clist" id="country-list"></div></div>
        </div>
      </section>

      <!-- ── Teste A/B ── -->
      <section class="view" id="view-ab">
        <div id="ab-alert"></div>
        <div class="ab-grid">
          <div class="verdict" id="ab-verdict"></div>
          <div class="card" id="ab-metrics"></div>
        </div>
        <div class="section-title"><span>Comparativo visual</span><span class="line"></span></div>
        <div class="card" id="ab-chart-card">
          <div id="ab-chart" style="width:100%;overflow:hidden"></div>
        </div>
        <div class="section-title"><span>Variantes em detalhe</span><span class="line"></span></div>
        <div class="grid" style="grid-template-columns:1fr 1fr" id="ab-variants"></div>
      </section>

      <!-- ── Anti-desvio (Cooud) ── -->
      <section class="view" id="view-cooud">
        <div id="cooud-alert"></div>
        <div class="grid kpis" id="cooud-kpis"></div>
        <div class="section-title"><span>Funções detectadas</span><span class="line"></span></div>
        <div class="grid" style="grid-template-columns:1fr 1fr" id="cooud-practices"></div>
        <div class="section-title"><span>Conciliação (leads enviados x vendas reportadas)</span><span class="line"></span></div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Lead</th><th>Status</th><th>Enviado</th><th>Reportado</th><th>Prática</th><th>Cliente</th></tr></thead>
          <tbody id="cooud-body"></tbody>
        </table></div>
      </section>

      <!-- ── Atividade ── -->
      <section class="view" id="view-activity">
        <div class="grid kpis" id="act-kpis"></div>
        <div class="tbl-tools" style="margin-top:6px">
          <select class="select" id="ev-filter">
            <option value="">Todos os eventos</option>
            <option value="sale">Vendas</option>
            <option value="failed">Recusas</option>
            <option value="lead">Leads Cooud</option>
            <option value="visit">Novos leads</option>
            <option value="refund">Reembolsos</option>
            <option value="dispute">Disputas</option>
          </select>
          <span class="tbl-count" id="ev-count"></span>
        </div>
        <div class="card"><div class="feed" id="feed"></div></div>
      </section>

      <!-- ── Configurações ── -->
      <section class="view" id="view-config">
        <div class="alert info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><div><b>Controle do roteamento de checkout</b><p>Defina quanto do tráfego vai para o Stripe (nativo) e quanto vai para o link externo (Cooud). Use "Apenas Stripe" para desligar o gateway externo.</p></div></div>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div class="card">
            <h3 style="font-size:16px;margin-bottom:16px">Roteamento & Teste A/B</h3>
            <div class="form-row">
              <label>Modo de operação</label>
              <select class="select" id="cfg-mode">
                <option value="ab">Teste A/B (dividir tráfego)</option>
                <option value="stripe_only">Apenas Stripe (100% nativo)</option>
              </select>
            </div>
            <div class="form-row" id="cfg-split-wrap">
              <label>Divisão do tráfego <span class="hint">— % que vai para o Stripe</span></label>
              <div class="range-wrap">
                <input type="range" id="cfg-pct" min="0" max="100" step="5" value="50" />
                <span id="cfg-pct-val" style="font-family:'Space Grotesk';font-weight:700;width:46px;text-align:right">50%</span>
              </div>
              <div class="split-preview" style="margin-top:10px">
                <div class="sp-stripe" id="sp-stripe" style="width:50%">Stripe 50%</div>
                <div class="sp-cooud" id="sp-cooud">Cooud 50%</div>
              </div>
            </div>
            <button class="btn primary" id="cfg-save" style="margin-top:6px;width:100%">Salvar configuração</button>
          </div>
          <div class="card">
            <h3 style="font-size:16px;margin-bottom:16px">Link externo (Cooud)</h3>
            <div class="form-row">
              <label>Nome do gateway externo</label>
              <input class="inp" id="cfg-name" placeholder="Cooud" />
            </div>
            <div class="form-row">
              <label>URL do checkout externo <span class="hint">— para onde o lead é redirecionado</span></label>
              <input class="inp" id="cfg-url" placeholder="https://checkout.cooud.com/..." />
            </div>
            <div class="alert info" style="margin:4px 0 0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><div><p style="color:var(--muted)">O identificador do visitante é anexado automaticamente (client_reference_id) para conciliar as vendas e detectar desvios.</p></div></div>
          </div>
          <div class="card">
            <h3 style="font-size:16px;margin-bottom:6px">Rotação da tt_url (Stripe)</h3>
            <p style="color:var(--muted2);margin:0 0 16px;font-size:12.5px">Oculta a URL real do TikTok no painel da Stripe. A cada venda, a Stripe mostra uma URL isca diferente desta lista; a URL real fica só no servidor e é enviada ao TikTok (CAPI).</p>
            <div class="form-row" style="flex-direction:row;align-items:center;justify-content:space-between">
              <label style="margin:0">Ativar rotação <span class="hint">— mascara a tt_url na Stripe</span></label>
              <label class="switch"><input type="checkbox" id="cfg-rot" /><span class="slider"></span></label>
            </div>
            <div class="form-row" id="cfg-rot-wrap">
              <label>URLs de rotação <span class="hint">— uma por linha</span></label>
              <textarea class="inp" id="cfg-rot-urls" rows="5" placeholder="https://tiktok.com/" style="resize:vertical;font-family:monospace;font-size:12.5px;line-height:1.6"></textarea>
            </div>
          </div>
          <div class="card">
            <h3 style="font-size:16px;margin-bottom:6px">Saúde do sistema</h3>
            <p style="color:var(--muted2);font-size:12.5px;margin:0 0 10px">Variáveis de ambiente configuradas neste servidor.</p>
            <div class="health-grid" id="health-grid"><div class="muted" style="font-size:13px;padding:8px 0">Carregando...</div></div>
          </div>
        </div>
        <div class="section-title"><span>Zona de risco</span><span class="line"></span></div>
        <div class="card">
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <div style="flex:1;min-width:200px"><b style="font-size:14px">Zerar todas as estatísticas</b><p style="color:var(--muted2);margin:4px 0 0;font-size:12.5px">Apaga leads, eventos e contadores. Não afeta configurações ou chaves.</p></div>
            <button class="btn danger" id="reset-btn">Zerar estatísticas</button>
          </div>
        </div>
      </section>

    </div>
  </div>
</div>

<div class="drawer-bg" id="drawer-bg"></div>
<aside class="drawer" id="drawer">
  <div class="drawer-head">
    <h3 id="drawer-title">Detalhe do lead</h3>
    <div class="head-actions">
      <button class="btn-icon" id="drawer-copy" title="Copiar ID">Copiar ID</button>
      <button class="x" id="drawer-x">&times;</button>
    </div>
  </div>
  <div class="drawer-body" id="drawer-body"></div>
</aside>
<div class="toast" id="toast"></div>

<script>
var I={
 sale:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
 fail:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
 lead:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>',
 visit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/></svg>',
 refund:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-15-6.7L3 13"/></svg>',
 dispute:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
 money:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
 cart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>',
 check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>',
 users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/></svg>',
 pct:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
 globe:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20 15 15 0 010-20z"/></svg>',
 zap:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
 shield:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/></svg>'
};

var GEO={PT:[39.4,-8.2],ES:[40.2,-3.7],FR:[46.6,2.2],DE:[51.2,10.4],GB:[55.4,-3.4],IE:[53.4,-8.2],IT:[41.9,12.6],NL:[52.1,5.3],BE:[50.5,4.5],CH:[46.8,8.2],AT:[47.5,14.5],LU:[49.8,6.1],DK:[56.3,9.5],SE:[60.1,18.6],NO:[60.5,8.5],FI:[61.9,25.7],PL:[51.9,19.1],CZ:[49.8,15.5],HU:[47.2,19.5],RO:[45.9,24.9],GR:[39.1,21.8],BG:[42.7,25.5],HR:[45.1,15.2],SK:[48.7,19.7],SI:[46.1,14.8],LT:[55.2,23.9],LV:[56.9,24.6],EE:[58.6,25.0],US:[39.8,-98.6],CA:[56.1,-106.3],MX:[23.6,-102.5],BR:[-14.2,-51.9],AR:[-38.4,-63.6],CL:[-35.7,-71.5],CO:[4.6,-74.3],PE:[-9.2,-75.0],UY:[-32.5,-55.8],AU:[-25.3,133.8],NZ:[-40.9,174.9],AE:[23.4,53.8],SA:[23.9,45.1],TR:[38.9,35.2],IL:[31.0,34.9],ZA:[-30.6,22.9],NG:[9.1,8.7],AO:[-11.2,17.9],MZ:[-18.7,35.5],CV:[16.0,-24.0],MA:[31.8,-7.1],EG:[26.8,30.8],IN:[20.6,79.0],CN:[35.9,104.2],JP:[36.2,138.3],KR:[35.9,127.8],SG:[1.35,103.8],ID:[-0.8,113.9],PH:[12.9,121.8],TH:[15.9,100.9],MY:[4.2,101.9],VN:[14.1,108.3],RU:[61.5,105.3],UA:[48.4,31.2]};

function flag(cc){ if(!cc||cc.length!==2) return String.fromCodePoint(127760); return cc.toUpperCase().replace(/./g,function(c){return String.fromCodePoint(127397+c.charCodeAt(0));}); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function money(cents,cur){
  cur=(cur||'EUR').toUpperCase();
  try{ return new Intl.NumberFormat('pt-PT',{style:'currency',currency:cur}).format((cents||0)/100); }
  catch(e){ return ((cents||0)/100).toFixed(2)+' '+cur; }
}
// Formata objeto de receita { EUR: cents, GBP: cents } em texto legível
function revObj(o){
  o=o||{};
  var k=Object.keys(o).filter(function(c){return (o[c]||0)>0;});
  if(!k.length) return money(0,'EUR');
  return k.map(function(c){return money(o[c],c);}).join(' + ');
}
function sumRev(o){ o=o||{}; var t=0; Object.keys(o).forEach(function(c){t+=o[c]||0;}); return t; }
function timeAgo(iso){
  if(!iso) return '—';
  var d=(Date.now()-new Date(iso).getTime())/1000;
  if(d<0) return 'agora';
  if(d<60) return 'agora';
  if(d<3600) return Math.floor(d/60)+'min';
  if(d<86400) return Math.floor(d/3600)+'h';
  return Math.floor(d/86400)+'d';
}
function fmtDateLocal(iso){
  if(!iso) return '—';
  try{ return new Intl.DateTimeFormat('pt-PT',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Lisbon'}).format(new Date(iso)); }
  catch(e){ return iso.slice(0,16).replace('T',' '); }
}
function pctColor(v){ return v>=60?'pos':v>=30?'amb':'neg'; }

var DATA=null, CFG=null, HEALTH=null, period='7d', chartMode='revenue', evFilter='', autoTimer=null, globe=null, currentView='overview', currentLeadId=null;
var leadsById={};

function cutoff(){
  var n=Date.now();
  if(period==='today'){var d=new Date();d.setHours(0,0,0,0);return d.getTime();}
  if(period==='7d') return n-7*864e5;
  if(period==='30d') return n-30*864e5;
  return 0;
}
function inPeriod(iso){ if(!iso) return period==='all'; return new Date(iso).getTime()>=cutoff(); }

// Calcula métricas filtradas pelo período atual — chamado uma vez por renderAll()
function metrics(){
  var leads=(DATA.leads||[]), events=(DATA.events||[]);
  var real=leads.filter(function(l){return !l.orphan;});
  var lp=real.filter(function(l){return inPeriod(l.at);});
  var visits=lp.length;
  var reached=lp.filter(function(l){return l.stage==='checkout'||l.stage==='purchased';}).length;
  var bought=lp.filter(function(l){return l.stage==='purchased';}).length;
  var gw={stripe:{checkout:0,purchased:0},cooud:{checkout:0,purchased:0}};
  lp.forEach(function(l){
    if(l.gateway&&gw[l.gateway]){
      if(l.stage==='checkout'||l.stage==='purchased') gw[l.gateway].checkout++;
      if(l.stage==='purchased') gw[l.gateway].purchased++;
    }
  });
  var rev={}, revByGw={stripe:{},cooud:{}}, sales=0, failed=0, refunds=0, disputes=0;
  events.forEach(function(e){
    if(!inPeriod(e.at)) return;
    if(e.type==='sale'){
      sales++;
      var c=(e.currency||'EUR').toUpperCase();
      rev[c]=(rev[c]||0)+(e.amount||0);
      var gwe=e.gateway==='cooud'?'cooud':'stripe';
      revByGw[gwe][c]=(revByGw[gwe][c]||0)+(e.amount||0);
    } else if(e.type==='failed') failed++;
    else if(e.type==='refund') refunds++;
    else if(e.type==='dispute') disputes++;
  });
  var attempts=sales+failed;
  // Mapa de países
  var cm={};
  lp.forEach(function(l){
    if(!l.country) return;
    if(!cm[l.country]) cm[l.country]={code:l.country,name:l.countryName||l.country,count:0,purchased:0};
    cm[l.country].count++;
    if(l.stage==='purchased') cm[l.country].purchased++;
  });
  var countries=Object.keys(cm).map(function(k){return cm[k];}).sort(function(a,b){return b.count-a.count;});
  // Ticket médio por moeda dominante
  var mainCur=Object.keys(rev).sort(function(a,b){return (rev[b]||0)-(rev[a]||0);})[0]||'EUR';
  var avgTicket=bought?(rev[mainCur]||0)/bought:0;
  return {
    visits:visits, reached:reached, bought:bought, gw:gw,
    rev:rev, revByGw:revByGw, sales:sales, failed:failed, refunds:refunds, disputes:disputes,
    approval:attempts?+((sales/attempts)*100).toFixed(1):0,
    v2c:visits?+((reached/visits)*100).toFixed(1):0,
    c2p:reached?+((bought/reached)*100).toFixed(1):0,
    overall:visits?+((bought/visits)*100).toFixed(1):0,
    countries:countries, mainCur:mainCur, avgTicket:avgTicket
  };
}

function kpi(ico,cls,label,val,sub){
  return '<div class="card kpi '+(cls||'')+'"><div class="k-top"><span class="k-ico">'+ico+'</span>'+esc(label)+'</div><div class="k-val">'+val+'</div><div class="k-sub">'+(sub||'')+'</div></div>';
}

/* ── Visão Geral ── */
function renderOverview(m){
  document.getElementById('ov-kpis').innerHTML=
    kpi(I.money,'tint-cyan','Receita total','<span class="cyn">'+revObj(m.rev)+'</span>','no período selecionado')+
    kpi(I.cart,'tint-pink','Vendas aprovadas','<span class="pnk">'+m.sales+'</span>','<span class="neg">'+m.failed+'</span> recusadas')+
    kpi(I.check,'','Taxa de aprovação','<span class="'+pctColor(m.approval)+'">'+m.approval+'%</span>','aprovadas / tentativas')+
    kpi(I.users,'','Novos leads','<span>'+m.visits+'</span>','entraram no funil')+
    kpi(I.pct,'','Conversão do funil','<span class="'+pctColor(m.overall)+'">'+m.overall+'%</span>','visita &#8594; compra');
  renderChart(m);
  var topC=m.countries[0];
  document.getElementById('ov-highlights').innerHTML=
    '<div class="card"><div class="k-top">'+I.globe+' Pa&iacute;s n&ordm;1</div><div class="k-val small">'+(topC?flag(topC.code)+' '+esc(topC.name):'—')+'</div><div class="k-sub">'+(topC?topC.count+' leads':'sem dados')+'</div></div>'+
    '<div class="card"><div class="k-top">'+I.cart+' Chegaram ao checkout</div><div class="k-val small">'+m.reached+'</div><div class="k-sub">'+m.v2c+'% dos leads</div></div>'+
    '<div class="card"><div class="k-top">'+I.money+' Ticket m&eacute;dio</div><div class="k-val small">'+money(m.avgTicket,m.mainCur)+'</div><div class="k-sub">por venda aprovada</div></div>'+
    '<div class="card"><div class="k-top">'+I.dispute+' Reembolsos / disputas</div><div class="k-val small">'+m.refunds+' / '+m.disputes+'</div><div class="k-sub">no per&iacute;odo</div></div>';
}

/* ── Gráfico de tendência ── */
function renderChart(m){
  var el=document.getElementById('chart');
  if(!el) return;
  var events=(DATA.events||[]).filter(function(e){return e.type==='sale'&&inPeriod(e.at);});
  // buckets
  var n, isHour=false;
  if(period==='today'){n=12;isHour=true;}
  else if(period==='7d'){n=7;}
  else if(period==='30d'){n=30;}
  else{n=Math.min(30,Math.max(7,Math.ceil((Date.now()-new Date(DATA.updatedAt||Date.now()).getTime())/864e5)+2));}
  var now=new Date(); var buckets=[];
  for(var i=n-1;i>=0;i--){
    var d=new Date(now);
    if(isHour){ d.setMinutes(0,0,0); d.setHours(now.getHours()-i*2); }
    else { d.setHours(0,0,0,0); d.setDate(now.getDate()-i); }
    buckets.push({t:d.getTime(),sc:0,cc:0});
  }
  function idx(ts){ for(var j=buckets.length-1;j>=0;j--){ if(ts>=buckets[j].t) return j; } return -1; }
  events.forEach(function(e){
    var j=idx(new Date(e.at).getTime());
    if(j<0) return;
    var val=chartMode==='revenue'?(e.amount||0):100; // 100 cents = 1 unidade para escala
    if(e.gateway==='cooud'){buckets[j].cc+=val;} else {buckets[j].sc+=val;}
  });
  var maxV=0;
  buckets.forEach(function(b){ maxV=Math.max(maxV,b.sc+b.cc); });
  if(!maxV) maxV=1;
  var hasData=buckets.some(function(b){return b.sc+b.cc>0;});
  if(!hasData){ el.innerHTML='<div class="empty" style="min-height:180px;display:flex;align-items:center;justify-content:center">Sem vendas no per&iacute;odo.</div>'; return; }
  var W=Math.max(520,el.clientWidth||520), H=200, padL=8, padR=8, padT=12, padB=24;
  var chartH=H-padT-padB;
  var bw=(W-padL-padR)/buckets.length;
  var svg='<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="100%" preserveAspectRatio="none">';
  // gridlines
  for(var g=0;g<=4;g++){
    var gy=padT+chartH*(1-g/4);
    svg+='<line x1="'+padL+'" y1="'+gy+'" x2="'+(W-padR)+'" y2="'+gy+'" stroke="rgba(255,255,255,.05)" stroke-dasharray="3,3"/>';
  }
  // barras
  buckets.forEach(function(b,k){
    var x=padL+k*bw+bw*0.18; var w=bw*0.64;
    var baseY=padT+chartH;
    var scH=(chartH)*b.sc/maxV, ccH=(chartH)*b.cc/maxV;
    if(scH>0){ svg+='<rect x="'+x.toFixed(1)+'" y="'+(baseY-scH).toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+scH.toFixed(1)+'" rx="3" fill="#25f4ee" opacity=".9"/>'; }
    if(ccH>0){ svg+='<rect x="'+x.toFixed(1)+'" y="'+(baseY-scH-ccH).toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+ccH.toFixed(1)+'" rx="3" fill="#fe2c55" opacity=".9"/>'; }
    var dt=new Date(b.t);
    var lbl=isHour?(dt.getHours()+'h'):(dt.getDate()+'/'+(dt.getMonth()+1));
    svg+='<text x="'+(x+w/2).toFixed(1)+'" y="'+(padT+chartH+16)+'" fill="#6c6c80" font-size="9.5" text-anchor="middle" font-family="Inter,sans-serif">'+lbl+'</text>';
  });
  svg+='</svg>';
  el.innerHTML=svg;
}

/* ── Funil ── */
function renderFunnel(m){
  document.getElementById('fn-kpis').innerHTML=
    kpi(I.users,'tint-cyan','Leads (topo)','<span class="cyn">'+m.visits+'</span>','entraram no site')+
    kpi(I.cart,'','Chegaram ao checkout','<span>'+m.reached+'</span>',m.v2c+'% dos leads')+
    kpi(I.check,'tint-pink','Compraram','<span class="pnk">'+m.bought+'</span>',m.c2p+'% dos checkouts')+
    kpi(I.pct,'','Convers&atilde;o total','<span class="'+pctColor(m.overall)+'">'+m.overall+'%</span>','visita &#8594; compra');
  var max=Math.max(m.visits,1);
  var steps=[
    {l:'Visitaram',s:'topo do funil',v:m.visits,c:'#25f4ee',r:'100%'},
    {l:'Chegaram ao checkout',s:'iniciaram pagamento',v:m.reached,c:'#7fb0ff',r:m.v2c+'%'},
    {l:'Compraram',s:'pagamento aprovado',v:m.bought,c:'#fe2c55',r:m.overall+'%'}
  ];
  document.getElementById('funnel-bars').innerHTML=steps.map(function(st){
    var w=Math.max(5,(st.v/max)*100);
    return '<div class="fstep">'+
      '<div class="flabel"><b>'+esc(st.l)+'</b><span>'+esc(st.s)+'</span></div>'+
      '<div class="fbar-track"><div class="fbar" style="width:'+w+'%;background:'+st.c+'">'+st.v+'</div></div>'+
      '<div class="frate">'+st.r+'</div></div>';
  }).join('');
  var gw=m.gw;
  var extName=CFG&&CFG.externalName||'Cooud';
  document.getElementById('fn-gateways').innerHTML=
    gwCard('Stripe','stripe',gw.stripe,'#25f4ee')+
    gwCard(esc(extName),'cooud',gw.cooud,'#fe2c55');
  renderLeadsTable();
}
function gwCard(title,cls,d,color){
  var conv=d.checkout?((d.purchased/d.checkout)*100).toFixed(1):0;
  return '<div class="card">'+
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><span class="tag '+cls+'">'+title+'</span></div>'+
    '<div style="display:flex;gap:20px">'+
      '<div><div class="muted" style="font-size:12px">Checkouts</div><div class="k-val small">'+d.checkout+'</div></div>'+
      '<div><div class="muted" style="font-size:12px">Compras</div><div class="k-val small" style="color:'+color+'">'+d.purchased+'</div></div>'+
      '<div><div class="muted" style="font-size:12px">Convers&atilde;o</div><div class="k-val small">'+conv+'%</div></div>'+
    '</div></div>';
}

function renderLeadsTable(){
  var q=(document.getElementById('lead-search').value||'').toLowerCase();
  var stage=document.getElementById('lead-stage').value;
  var gwf=document.getElementById('lead-gw').value;
  var leads=(DATA.leads||[]).filter(function(l){
    if(l.orphan) return false;
    if(!inPeriod(l.at)) return false;
    if(stage&&l.stage!==stage) return false;
    if(gwf&&l.gateway!==gwf) return false;
    if(q){
      var hay=[l.id,l.country,l.countryName,l.customer,l.email,(l.utm&&l.utm.source),(l.utm&&l.utm.campaign)].filter(Boolean).join(' ').toLowerCase();
      if(hay.indexOf(q)<0) return false;
    }
    return true;
  });
  var body=document.getElementById('leads-body');
  var cnt=document.getElementById('leads-count');
  if(cnt) cnt.textContent=leads.length+' leads';
  if(!leads.length){
    body.innerHTML='<tr><td colspan="7"><div class="empty">Nenhum lead encontrado neste per&iacute;odo/filtro.</div></td></tr>';
    return;
  }
  var extName=CFG&&CFG.externalName||'Cooud';
  body.innerHTML=leads.slice(0,200).map(function(l){
    var names={visit:'Visita',checkout:'Checkout',purchased:'Comprou'};
    var stageTag='<span class="tag '+l.stage+'">'+(names[l.stage]||l.stage)+'</span>';
    var gwTag=l.gateway?'<span class="tag '+l.gateway+'">'+(l.gateway==='cooud'?esc(extName):'Stripe')+'</span>':'<span class="muted">—</span>';
    var path=(l.checkoutHits&&l.checkoutHits.length)?l.checkoutHits.map(function(h){return h.gateway==='cooud'?'C':'S';}).join('&#8594;'):'—';
    var origin=(l.utm&&l.utm.source)?esc(l.utm.source):(l.referer?'ref':'direto');
    var val=l.reportedAmount?money(l.reportedAmount,l.reportedCurrency):(l.expectedAmount?('<span class="muted">'+money(l.expectedAmount,l.expectedCurrency)+'</span>'):'—');
    var shortId=l.id.slice(0,12);
    return '<tr onclick="openLead(\\''+esc(l.id)+'\\')">'+
      '<td><span style="font-family:monospace;font-size:12px">'+esc(shortId)+'</span></td>'+
      '<td>'+stageTag+'</td>'+
      '<td>'+gwTag+' <span class="muted" style="font-size:11px">'+path+'</span></td>'+
      '<td>'+(l.country?flag(l.country)+' '+esc(l.countryName||l.country):'<span class="muted">—</span>')+'</td>'+
      '<td><span class="muted" style="font-size:12px">'+esc(origin)+'</span></td>'+
      '<td>'+val+'</td>'+
      '<td class="muted" style="font-size:12px">'+timeAgo(l.at)+'</td></tr>';
  }).join('');
}

/* ── Países ── */
function renderGeo(m){
  var totalLeads=m.countries.reduce(function(a,c){return a+c.count;},0);
  document.getElementById('geo-kpis').innerHTML=
    kpi(I.globe,'tint-cyan','Pa&iacute;ses ativos','<span class="cyn">'+m.countries.length+'</span>','com pelo menos 1 lead')+
    kpi(I.users,'','Leads geolocalizados','<span>'+totalLeads+'</span>','com pa&iacute;s identificado')+
    kpi(I.zap,'tint-pink','Principal mercado','<span class="pnk">'+(m.countries[0]?flag(m.countries[0].code)+' '+esc(m.countries[0].code):'—')+'</span>',(m.countries[0]?m.countries[0].count+' leads':'sem dados'));
  var max=m.countries[0]?m.countries[0].count:1;
  var cl=document.getElementById('country-list');
  cl.innerHTML=m.countries.length?m.countries.map(function(c){
    return '<div class="crow">'+
      '<div class="flag">'+flag(c.code)+'</div>'+
      '<div class="cn"><b>'+esc(c.name)+'</b><span>'+c.purchased+' compraram &middot; '+c.count+' leads</span></div>'+
      '<div class="cbar"><i style="width:'+((c.count/max)*100)+'%"></i></div>'+
      '<div class="cval">'+c.count+'</div></div>';
  }).join(''):'<div class="empty">Sem dados de pa&iacute;s ainda.</div>';
  renderGlobe(m.countries);
}
function renderGlobe(countries){
  var el=document.getElementById('globe'); if(!el) return;
  if(typeof Globe==='undefined'){
    el.innerHTML='<div class="empty" style="height:100%;display:flex;align-items:center;justify-content:center">Globo indispon&iacute;vel (sem CDN). Veja a lista ao lado.</div>';
    return;
  }
  var top=countries[0]?countries[0].count:1;
  var pts=countries.filter(function(c){return GEO[c.code];}).map(function(c){
    var g=GEO[c.code];
    return {lat:g[0],lng:g[1],size:Math.max(.14,Math.min(.88,c.count/top)),count:c.count,name:c.name,code:c.code};
  });
  try{
    if(!globe){
      globe=Globe()(el)
        .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-dark.jpg')
        .backgroundColor('rgba(0,0,0,0)')
        .showAtmosphere(true).atmosphereColor('#25f4ee').atmosphereAltitude(0.16)
        .pointLat('lat').pointLng('lng')
        .pointAltitude(function(d){return d.size*0.45;})
        .pointRadius(0.55)
        .pointColor(function(){return '#fe2c55';})
        .pointLabel(function(d){
          return '<div style="background:#14141e;border:1px solid #26263a;padding:6px 10px;border-radius:8px;font-family:Inter,sans-serif;font-size:12px;color:#fff">'+
            flag(d.code)+' '+d.name+': <b>'+d.count+'</b> leads</div>';
        });
      globe.pointOfView({lat:30,lng:-10,altitude:2.1},0);
      var ctrl=globe.controls();
      if(ctrl){ctrl.autoRotate=true;ctrl.autoRotateSpeed=0.5;ctrl.enableZoom=false;}
      setTimeout(function(){ try{globe.width(el.clientWidth).height(440);}catch(e){} },80);
    }
    globe.pointsData(pts);
  }catch(e){ el.innerHTML='<div class="empty">N&atilde;o foi poss&iacute;vel carregar o globo.</div>'; }
}

/* ── Teste A/B ── */
function zScore(nA,cA,nB,cB){ if(!nA||!nB) return 0; var pA=cA/nA,pB=cB/nB,p=(cA+cB)/(nA+nB); var se=Math.sqrt(p*(1-p)*(1/nA+1/nB)); if(!se||isNaN(se)) return 0; return (pA-pB)/se; }
function confFromZ(z){ z=Math.abs(z); var t=1/(1+0.2316419*z); var d=0.3989423*Math.exp(-z*z/2); var p=1-d*(0.3193815*t-0.3565638*t*t+1.781478*t*t*t-1.821256*Math.pow(t,4)+1.330274*Math.pow(t,5)); return +(((2*p-1))*100).toFixed(1); }
function renderAB(){
  var v=DATA.variants||{};
  var s=v.stripe||{assignments:0,conversions:0,revenue:{}};
  var c=v.cooud||{assignments:0,conversions:0,revenue:{}};
  var extName=CFG&&CFG.externalName||'Cooud';
  var rpvS=s.assignments?sumRev(s.revenue)/s.assignments:0;
  var rpvC=c.assignments?sumRev(c.revenue)/c.assignments:0;
  var winner=rpvS===rpvC?null:(rpvS>rpvC?'stripe':'cooud');
  var winName=winner==='stripe'?'Stripe':(winner==='cooud'?esc(extName):'Empate');
  var winRpv=Math.max(rpvS,rpvC), loseRpv=Math.min(rpvS,rpvC);
  var uplift=loseRpv>0?(((winRpv-loseRpv)/loseRpv)*100).toFixed(1):(winRpv>0?'100':'0');
  var z=zScore(s.assignments,s.conversions,c.assignments,c.conversions);
  var conf=confFromZ(z);
  var enough=s.assignments>=30&&c.assignments>=30;
  document.getElementById('ab-alert').innerHTML=!enough?
    '<div class="alert info">'+I.check+'<div><b>Amostra ainda pequena</b><p>Recomendado pelo menos 30 visitantes por variante para um veredito confi&aacute;vel.</p></div></div>':
    (conf>=95?'<div class="alert ok">'+I.check+'<div><b>Resultado estat&iacute;sticamente significativo ('+conf+'%)</b><p>Voc&ecirc; pode confiar neste vencedor e ajustar a divis&atilde;o do tr&aacute;fego em Configura&ccedil;&otilde;es.</p></div></div>':'');
  document.getElementById('ab-verdict').innerHTML=
    '<div class="muted" style="font-size:12.5px">Vencedor por receita/visitante (RPV)</div>'+
    '<div class="win '+(winner==='cooud'?'pnk':'cyn')+'">'+winName+'</div>'+
    '<div class="vgrid">'+
      '<div class="vcell"><div class="vt">RPV Stripe</div><div class="vv cyn">'+money(rpvS,Object.keys(s.revenue||{})[0]||'EUR')+'</div></div>'+
      '<div class="vcell"><div class="vt">RPV '+esc(extName)+'</div><div class="vv pnk">'+money(rpvC,Object.keys(c.revenue||{})[0]||'EUR')+'</div></div>'+
    '</div>'+
    '<div style="margin-top:14px">'+
      '<div class="muted" style="font-size:12px">Uplift do vencedor: <b style="color:var(--text)">+'+uplift+'%</b></div>'+
      '<div class="muted" style="font-size:12px;margin-top:6px">Confian&ccedil;a estat&iacute;stica: <b style="color:var(--text)">'+conf+'%</b></div>'+
      '<div class="conf-bar" style="margin-top:8px"><i style="width:'+Math.min(100,conf)+'%;background:'+(conf>=95?'var(--green)':'var(--amber)')+'"></i></div>'+
    '</div>';
  document.getElementById('ab-metrics').innerHTML=
    '<h3 style="font-size:15px;margin-bottom:14px">Comparativo</h3>'+
    metricRow('Visitantes',s.assignments,c.assignments)+
    metricRow('Cliques no checkout',s.clicks||0,c.clicks||0)+
    metricRow('Convers&otilde;es',s.conversions,c.conversions)+
    metricRow('Taxa de convers&atilde;o',(s.conversionRate||0)+'%',(c.conversionRate||0)+'%')+
    metricRow('Receita',revObj(s.revenue),revObj(c.revenue));
  document.getElementById('ab-variants').innerHTML=
    abCard('Stripe',s,'#25f4ee')+abCard(esc(extName),c,'#fe2c55');
  renderABChart(s,c,rpvS,rpvC,extName);
}
function renderABChart(s,c,rpvS,rpvC,extName){
  var el=document.getElementById('ab-chart'); if(!el) return;
  var metrics=[
    {label:'RPV',stripe:rpvS,cooud:rpvC},
    {label:'Taxa conv.%',stripe:s.assignments?+(s.conversions/s.assignments*100).toFixed(1):0,cooud:c.assignments?+(c.conversions/c.assignments*100).toFixed(1):0},
    {label:'Visitantes',stripe:s.assignments||0,cooud:c.assignments||0},
    {label:'Conversoes',stripe:s.conversions||0,cooud:c.conversions||0}
  ];
  var W=el.clientWidth||560, barH=36, gap=14, padL=110, padR=20, padT=14, padB=8;
  var rows=metrics.length, H=padT+rows*(barH+gap)+padB;
  var maxV=Math.max.apply(null,metrics.map(function(m){return Math.max(m.stripe,m.cooud,1);}));
  var avail=W-padL-padR;
  var bars=metrics.map(function(m,i){
    var y=padT+i*(barH+gap);
    var ws=Math.max(3,(m.stripe/maxV)*avail);
    var wc=Math.max(3,(m.cooud/maxV)*avail);
    var labelS=m.label==='RPV'?money(m.stripe,'EUR'):(m.label==='Taxa conv.%'?m.stripe+'%':m.stripe);
    var labelC=m.label==='RPV'?money(m.cooud,'EUR'):(m.label==='Taxa conv.%'?m.cooud+'%':m.cooud);
    return '<g>'+
      '<text x="'+(padL-8)+'" y="'+(y+12)+'" text-anchor="end" fill="#8888a4" font-size="11" font-family="Space Grotesk,sans-serif">'+esc(m.label)+'</text>'+
      '<rect x="'+padL+'" y="'+(y)+'" width="'+ws+'" height="16" rx="4" fill="#25f4ee" fill-opacity="0.85"/>'+
      '<text x="'+(padL+ws+5)+'" y="'+(y+12)+'" fill="#25f4ee" font-size="11" font-family="Space Grotesk,sans-serif">'+labelS+'</text>'+
      '<rect x="'+padL+'" y="'+(y+18)+'" width="'+wc+'" height="16" rx="4" fill="#fe2c55" fill-opacity="0.85"/>'+
      '<text x="'+(padL+wc+5)+'" y="'+(y+30)+'" fill="#fe2c55" font-size="11" font-family="Space Grotesk,sans-serif">'+labelC+'</text>'+
      '</g>';
  }).join('');
  var legend='<g>'+
    '<rect x="'+padL+'" y="'+(H-padB)+'" width="12" height="6" rx="2" fill="#25f4ee"/>'+
    '<text x="'+(padL+16)+'" y="'+(H-padB+6)+'" fill="#8888a4" font-size="11" font-family="Space Grotesk,sans-serif">Stripe</text>'+
    '<rect x="'+(padL+70)+'" y="'+(H-padB)+'" width="12" height="6" rx="2" fill="#fe2c55"/>'+
    '<text x="'+(padL+86)+'" y="'+(H-padB+6)+'" fill="#8888a4" font-size="11" font-family="Space Grotesk,sans-serif">'+esc(extName)+'</text>'+
    '</g>';
  el.innerHTML='<svg width="100%" viewBox="0 0 '+W+' '+(H+20)+'" xmlns="http://www.w3.org/2000/svg">'+bars+legend+'</svg>';
}
function metricRow(l,a,b){
  return '<div style="display:grid;grid-template-columns:1fr auto auto;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px;align-items:center">'+
    '<span class="muted">'+l+'</span>'+
    '<span style="text-align:right;min-width:90px" class="cyn">'+a+'</span>'+
    '<span style="text-align:right;min-width:90px" class="pnk">'+b+'</span></div>';
}
function abCard(name,d,color){
  return '<div class="card">'+
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'+
      '<span class="tag" style="border-color:'+color+';color:'+color+'">'+name+'</span>'+
    '</div>'+
    '<div class="k-val small" style="color:'+color+'">'+revObj(d.revenue)+'</div>'+
    '<div class="muted" style="font-size:12px;margin-top:4px">'+d.assignments+' visitantes &middot; '+d.conversions+' vendas &middot; '+(d.conversionRate||0)+'% conv.</div>'+
    '</div>';
}

/* ── Anti-desvio ── */
function renderCooud(){
  var co=DATA.cooud||{};
  var badge=document.getElementById('nav-cooud-badge');
  var flagged=(co.smartCapture||0)+(co.recovery||0)+(co.orphans||0);
  badge.style.display=flagged>0?'inline-block':'none';
  document.getElementById('cooud-alert').innerHTML=flagged>0?
    '<div class="alert">'+I.dispute+'<div><b>Fun&ccedil;&otilde;es do gateway ativas nas suas contas</b><p>Detectamos '+(co.smartCapture||0)+' Smart Capture, '+(co.recovery||0)+' Recuperar Preju&iacute;zo e '+(co.orphans||0)+' venda(s) &oacute;rf&atilde;(s).</p></div></div>':
    '<div class="alert ok">'+I.check+'<div><b>Tudo limpo</b><p>Nenhum desvio ou fun&ccedil;&atilde;o agressiva detectada at&eacute; agora.</p></div></div>';
  var extName=CFG&&CFG.externalName||'Cooud';
  document.getElementById('cooud-kpis').innerHTML=
    kpi(I.lead,'tint-cyan','Leads enviados','<span class="cyn">'+(co.sent||0)+'</span>','para o gateway '+(esc(extName)))+
    kpi(I.check,'','Vendas conciliadas','<span class="cyn">'+(co.matched||0)+'</span>',(co.convRate||0)+'% dos enviados')+
    kpi(I.dispute,'tint-pink','Vendas &oacute;rf&atilde;s','<span class="pnk">'+(co.orphans||0)+'</span>','sem lead nosso')+
    kpi(I.zap,'tint-amber','Reportes duplicados','<span class="amb">'+(co.duplicates||0)+'</span>','mesmo lead 2x');
  document.getElementById('cooud-practices').innerHTML=
    '<div class="card"><div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span class="tag cap">Smart Capture</span></div>'+
      '<div class="k-val small amb">'+(co.smartCapture||0)+' vendas</div>'+
      '<div class="muted" style="font-size:12.5px;margin-top:6px">Cobran&ccedil;a acima do esperado. Valor extra: <b style="color:var(--text)">'+revObj(co.captureExtraRev)+'</b></div></div>'+
    '<div class="card"><div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span class="tag rec">Recuperar Preju&iacute;zo</span></div>'+
      '<div class="k-val small cyn">'+(co.recovery||0)+' vendas</div>'+
      '<div class="muted" style="font-size:12.5px;margin-top:6px">Cobran&ccedil;as recuperadas tardiamente. Receita: <b style="color:var(--text)">'+revObj(co.recoveryRev)+'</b></div></div>';
  var leads=(DATA.leads||[]).filter(function(l){return l.gateway==='cooud';});
  var body=document.getElementById('cooud-body');
  body.innerHTML=leads.length?leads.slice(0,100).map(function(l){
    var st=l.orphan?'<span class="tag orphan">&Oacute;rf&atilde;</span>':(l.status==='converted'?'<span class="tag purchased">Conciliada</span>':'<span class="tag checkout">Pendente</span>');
    var pr=[];
    if(l.smartCapture) pr.push('<span class="tag cap">Capture</span>');
    if(l.recovery) pr.push('<span class="tag rec">Recup.</span>');
    if(l.duplicateReports) pr.push('<span class="tag amber" style="border-color:var(--amber);color:var(--amber)">x'+(l.duplicateReports+1)+'</span>');
    return '<tr onclick="openLead(\\''+esc(l.id)+'\\')">'+
      '<td><span style="font-family:monospace;font-size:12px">'+esc(l.id.slice(0,14))+'</span></td>'+
      '<td>'+st+'</td>'+
      '<td>'+(l.expectedAmount?money(l.expectedAmount,l.expectedCurrency):'—')+'</td>'+
      '<td>'+(l.reportedAmount?money(l.reportedAmount,l.reportedCurrency):'—')+'</td>'+
      '<td>'+(pr.join(' ')||'<span class="muted">—</span>')+'</td>'+
      '<td>'+esc(l.customer||'—')+'</td></tr>';
  }).join(''):'<tr><td colspan="6"><div class="empty">Nenhum lead Cooud ainda.</div></td></tr>';
}

/* ── Atividade ── */
function renderActivity(){
  var all=(DATA.events||[]);
  var events=all.filter(function(e){return !evFilter||e.type===evFilter;});
  var feed=document.getElementById('feed');
  var cnt=document.getElementById('ev-count');
  if(cnt) cnt.textContent=events.length+' evento'+(events.length!==1?'s':'');
  var extName=CFG&&CFG.externalName||'Cooud';
  // KPIs de sumário
  var sales=all.filter(function(e){return e.type==='sale';}).length;
  var fails=all.filter(function(e){return e.type==='failed';}).length;
  var refs=all.filter(function(e){return e.type==='refund';}).length;
  var disps=all.filter(function(e){return e.type==='dispute';}).length;
  var actKpis=document.getElementById('act-kpis');
  if(actKpis) actKpis.innerHTML=
    kpi(I.sale,'tint-cyan','Vendas aprovadas','<span class="cyn">'+sales+'</span>','no hist&oacute;rico total')+
    kpi(I.fail,'tint-pink','Recusadas','<span class="pnk">'+fails+'</span>',(sales+fails)?((fails/(sales+fails)*100).toFixed(0)+'% de tentativas'):'')+
    kpi(I.refund,'','Reembolsos','<span class="amb">'+refs+'</span>','emitidos')+
    kpi(I.dispute,'','Disputas','<span class="neg">'+disps+'</span>','abertas');
  var map={
    sale:{i:I.sale,c:'var(--green)'},
    failed:{i:I.fail,c:'var(--red)'},
    lead:{i:I.lead,c:'var(--pink)'},
    visit:{i:I.visit,c:'var(--cyan)'},
    refund:{i:I.refund,c:'var(--amber)'},
    dispute:{i:I.dispute,c:'var(--red)'},
    info:{i:I.zap,c:'var(--muted)'}
  };
  feed.innerHTML=events.length?events.slice(0,150).map(function(e){
    var mp=map[e.type]||map.info;
    var meta=[];
    if(e.customer) meta.push('<b>'+esc(e.customer)+'</b>');
    if(e.email) meta.push(esc(e.email));
    if(e.gateway) meta.push('<span style="opacity:.75">'+(e.gateway==='cooud'?esc(extName):'Stripe')+'</span>');
    if(e.country) meta.push(esc(e.country));
    if(e.card) meta.push(esc(e.card));
    if(e.landing) meta.push('<span style="opacity:.65">'+esc(e.landing)+'</span>');
    if(e.practice) meta.push('<span class="amb">'+esc(e.practice)+'</span>');
    if(e.reason) meta.push('<span class="neg">'+esc(e.reason)+'</span>');
    var amt=e.amount?'<div class="amt">'+money(e.amount,e.currency)+'</div>':'';
    var ts=e.at?fmtDateLocal(e.at).replace(/.*,\s*/,''):'';
    return '<div class="ev" style="border-left:2px solid '+mp.c+'20">'+
      '<div class="ei" style="color:'+mp.c+';background:'+mp.c+'18;border-radius:8px;padding:6px">'+mp.i+'</div>'+
      '<div style="min-width:0;flex:1">'+
        '<div class="et">'+esc(e.title||e.type)+'</div>'+
        '<div class="em">'+meta.join(' &middot; ')+'</div>'+
      '</div>'+
      '<div class="ea">'+amt+'<div class="muted" style="font-size:11px;white-space:nowrap">'+esc(ts)+'</div></div>'+
      '</div>';
  }).join(''):'<div class="empty">Nenhum evento ainda.</div>';
}

/* ── Config ── */
function fillConfig(){
  if(!CFG) return;
  document.getElementById('cfg-mode').value=CFG.mode||'ab';
  document.getElementById('cfg-pct').value=CFG.stripePct!=null?CFG.stripePct:50;
  document.getElementById('cfg-name').value=CFG.externalName||'Cooud';
  document.getElementById('cfg-url').value=CFG.externalUrl||'';
  document.getElementById('cfg-rot').checked=CFG.rotateTtUrl!==false;
  document.getElementById('cfg-rot-urls').value=(CFG.rotateUrls||[]).join(String.fromCharCode(10));
  updateSplitPreview();
  updateRotPreview();
}
function updateRotPreview(){
  var on=document.getElementById('cfg-rot').checked;
  var w=document.getElementById('cfg-rot-wrap');
  w.style.opacity=on?'1':'.45';
  w.style.pointerEvents=on?'auto':'none';
}
function updateSplitPreview(){
  var mode=document.getElementById('cfg-mode').value;
  var pct=+document.getElementById('cfg-pct').value;
  var wrap=document.getElementById('cfg-split-wrap');
  wrap.style.opacity=mode==='stripe_only'?'.4':'1';
  wrap.style.pointerEvents=mode==='stripe_only'?'none':'auto';
  if(mode==='stripe_only') pct=100;
  document.getElementById('cfg-pct-val').textContent=pct+'%';
  var extName=CFG&&CFG.externalName||'Cooud';
  document.getElementById('sp-stripe').style.width=pct+'%';
  document.getElementById('sp-stripe').textContent='Stripe '+pct+'%';
  document.getElementById('sp-cooud').textContent=esc(extName)+' '+(100-pct)+'%';
}

function renderHealth(){
  if(!HEALTH){ document.getElementById('health-grid').innerHTML='<div class="muted" style="padding:8px 0;font-size:13px">Indispon&iacute;vel</div>'; return; }
  var items=[
    {key:'stripe',label:'Stripe API'},
    {key:'webhook',label:'Webhook Secret'},
    {key:'resend',label:'Resend (e-mail)'},
    {key:'tiktok',label:'TikTok CAPI'},
    {key:'pushcut',label:'Pushcut'},
    {key:'dashboard',label:'Dashboard senha'}
  ];
  document.getElementById('health-grid').innerHTML=items.map(function(it){
    var ok=!!HEALTH[it.key];
    return '<div class="hitem">'+
      '<div class="hdot '+(ok?'ok':'warn')+'"></div>'+
      '<div class="hlbl">'+esc(it.label)+'</div>'+
      '<div class="hstatus '+(ok?'ok':'warn')+'">'+(ok?'Ativa':'Faltando')+'</div>'+
      '</div>';
  }).join('');
}

/* ── Drawer ── */
function openLead(id){
  var l=leadsById[id];
  if(!l) return;
  currentLeadId=id;
  document.getElementById('drawer-title').textContent='Lead '+id.slice(0,18);
  var extName=CFG&&CFG.externalName||'Cooud';
  var names={visit:'Visita',checkout:'Checkout',purchased:'Comprou'};
  function grp(t){ return '<div class="dgroup">'+t+'</div>'; }
  function r(k,v){ return '<div class="dl"><span class="dk">'+k+'</span><span class="dv">'+(v==null||v===''?'—':v)+'</span></div>'; }
  var rows='';
  rows+=grp('Funil');
  rows+=r('ID completo','<span style="font-family:monospace;font-size:12px;word-break:break-all">'+esc(l.id)+'</span>');
  rows+=r('Etapa','<span class="tag '+l.stage+'">'+(names[l.stage]||l.stage)+'</span>');
  rows+=r('Gateway',l.gateway?'<span class="tag '+l.gateway+'">'+(l.gateway==='cooud'?esc(extName):'Stripe')+'</span>':'—');
  if(l.checkoutHits&&l.checkoutHits.length) rows+=r('Checkouts',l.checkoutHits.map(function(h){return (h.gateway==='cooud'?esc(extName):'Stripe');}).join(' &#8594; '));
  if(l.conversionAgeMs!=null){ var secs=Math.round(l.conversionAgeMs/1000); rows+=r('Tempo at&eacute; convers&atilde;o',secs>60?Math.round(secs/60)+'min':secs+'s'); }
  rows+=grp('Valores');
  rows+=r('Esperado',l.expectedAmount?money(l.expectedAmount,l.expectedCurrency):'—');
  rows+=r('Reportado',l.reportedAmount?money(l.reportedAmount,l.reportedCurrency):'—');
  if(l.captureExtra) rows+=r('Cobrado a mais','<span class="amb">'+money(l.captureExtra,l.reportedCurrency)+'</span>');
  if(l.smartCapture||l.recovery||l.orphan){
    rows+=grp('Sinais detectados');
    if(l.smartCapture) rows+=r('Smart Capture','<span class="tag cap">Ativo</span>');
    if(l.recovery) rows+=r('Recuperar Preju&iacute;zo','<span class="tag rec">Ativo</span>');
    if(l.orphan) rows+=r('Venda &oacute;rf&atilde;','<span class="tag orphan">Sem lead</span>');
    if(l.duplicateReports) rows+=r('Reportes duplicados','<span class="amb">'+(l.duplicateReports+1)+'x</span>');
  }
  rows+=grp('Cliente');
  rows+=r('Nome',esc(l.customer)); rows+=r('E-mail',esc(l.email)); rows+=r('Cart&atilde;o',esc(l.card));
  rows+=grp('Origem / Geo');
  rows+=r('Pa&iacute;s',l.country?flag(l.country)+' '+esc(l.countryName||l.country):'—');
  rows+=r('Cidade',esc(l.city)); rows+=r('IP',esc(l.ip));
  rows+=r('Landing',esc(l.landing)); rows+=r('Referer',esc(l.referer));
  if(l.utm){ rows+=r('UTM source',esc(l.utm.source)); rows+=r('UTM campanha',esc(l.utm.campaign)); rows+=r('UTM m&eacute;dia',esc(l.utm.medium)); }
  rows+=r('ttclid',l.ttclid?'<span style="font-family:monospace;font-size:11px;word-break:break-all">'+esc(l.ttclid)+'</span>':'—');
  rows+=grp('Tempo');
  rows+=r('Entrou',fmtDateLocal(l.at));
  rows+=r('Viu o checkout',fmtDateLocal(l.checkoutAt));
  rows+=r('Convertido',fmtDateLocal(l.convertedAt));
  document.getElementById('drawer-body').innerHTML=rows;
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-bg').classList.add('open');
}
function closeDrawer(){
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-bg').classList.remove('open');
  currentLeadId=null;
}

/* ── Toast ── */
function toast(msg,ok){
  var t=document.getElementById('toast');
  t.textContent=msg;
  t.className='toast show '+(ok===false?'err':'ok');
  setTimeout(function(){t.className='toast';},2800);
}

/* ── Render geral ── */
function renderAll(){
  if(!DATA) return;
  buildLeadIndex();
  var m=metrics(); // calculado UMA vez e passado para cada render
  renderOverview(m);
  renderFunnel(m);
  renderGeo(m);
  renderAB();
  renderCooud();
  renderActivity();
  document.getElementById('foot-updated').textContent=DATA.updatedAt?timeAgo(DATA.updatedAt)+' atr&aacute;s':'agora';
  // dot ao vivo: verde se dados atualizados < 60s
  var dot=document.getElementById('live-dot');
  if(dot){ var age=DATA.updatedAt?(Date.now()-new Date(DATA.updatedAt).getTime())/1000:9999; dot.className='dot'+(age>60?' off':''); }
}
function buildLeadIndex(){ leadsById={}; (DATA.leads||[]).forEach(function(l){leadsById[l.id]=l;}); }

/* ── API ── */
function loadStats(){ return fetch('/api/stats',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){DATA=d;}); }
function loadConfig(){ return fetch('/api/config',{cache:'no-store'}).then(function(r){return r.json();}).then(function(c){CFG=c;}); }
function loadHealth(){ return fetch('/api/health',{cache:'no-store'}).then(function(r){return r.json();}).then(function(h){HEALTH=h;}).catch(function(){}); }
function refresh(){
  return Promise.all([loadStats(),loadConfig()])
    .then(function(){ fillConfig(); renderAll(); })
    .catch(function(e){ console.warn('[pulse] refresh error',e); });
}

/* ── Navegação ── */
var titles={
  overview:['Visão Geral','Resumo dos números que mais importam'],
  funnel:['Funil & Leads','Cada visitante rastreado até o checkout'],
  geo:['Países','De onde vêm seus leads'],
  ab:['Teste A/B','Qual gateway converte melhor'],
  cooud:['Anti-desvio','Vigilância do gateway externo'],
  activity:['Atividade','Tudo o que acontece em tempo real'],
  config:['Configurações','Roteamento, chaves e saúde do sistema']
};
function setView(v){
  currentView=v;
  document.querySelectorAll('.nav button[data-view]').forEach(function(b){ b.classList.toggle('active',b.getAttribute('data-view')===v); });
  document.querySelectorAll('section.view').forEach(function(s){ s.classList.toggle('active',s.id==='view-'+v); });
  document.getElementById('page-title').textContent=titles[v][0];
  document.getElementById('page-sub').textContent=titles[v][1];
  document.getElementById('sidebar').classList.remove('open');
  if(v==='geo'&&DATA){
    setTimeout(function(){
      if(globe){ try{globe.width(document.getElementById('globe').clientWidth).height(440);}catch(e){} }
      else if(DATA){ var m=metrics(); renderGlobe(m.countries); }
    },80);
  }
  if(v==='config') loadHealth().then(renderHealth);
}

/* ── Listeners ── */
document.getElementById('nav').addEventListener('click',function(e){
  var b=e.target.closest('button[data-view]'); if(b) setView(b.getAttribute('data-view'));
});
document.getElementById('menuToggle').addEventListener('click',function(){
  document.getElementById('sidebar').classList.toggle('open');
});
document.getElementById('period').addEventListener('click',function(e){
  var b=e.target.closest('button'); if(!b) return;
  period=b.getAttribute('data-p');
  document.querySelectorAll('#period button').forEach(function(x){x.classList.toggle('active',x===b);});
  globe=null; // reset globo para recalcular com novo filtro
  renderAll();
});
document.getElementById('chart-mode').addEventListener('click',function(e){
  var b=e.target.closest('button'); if(!b) return;
  chartMode=b.getAttribute('data-m');
  document.querySelectorAll('#chart-mode button').forEach(function(x){x.classList.toggle('active',x===b);});
  if(DATA){ var m=metrics(); renderChart(m); }
});
document.getElementById('refresh-btn').addEventListener('click',function(){ refresh().then(function(){toast('Atualizado');}); });
document.getElementById('lead-search').addEventListener('input',renderLeadsTable);
document.getElementById('lead-stage').addEventListener('change',renderLeadsTable);
document.getElementById('lead-gw').addEventListener('change',renderLeadsTable);
document.getElementById('ev-filter').addEventListener('change',function(e){ evFilter=e.target.value; renderActivity(); });
document.getElementById('drawer-x').addEventListener('click',closeDrawer);
document.getElementById('drawer-bg').addEventListener('click',closeDrawer);
document.getElementById('drawer-copy').addEventListener('click',function(){
  if(!currentLeadId) return;
  if(navigator.clipboard){ navigator.clipboard.writeText(currentLeadId).then(function(){toast('ID copiado');}).catch(function(){toast('Erro ao copiar',false);}); }
  else{ toast('Clipboard indispon&iacute;vel',false); }
});
document.getElementById('cfg-mode').addEventListener('change',updateSplitPreview);
document.getElementById('cfg-pct').addEventListener('input',updateSplitPreview);
document.getElementById('cfg-rot').addEventListener('change',updateRotPreview);
document.getElementById('cfg-save').addEventListener('click',function(){
  var body={
    mode:document.getElementById('cfg-mode').value,
    stripePct:+document.getElementById('cfg-pct').value,
    externalName:document.getElementById('cfg-name').value,
    externalUrl:document.getElementById('cfg-url').value,
    rotateTtUrl:document.getElementById('cfg-rot').checked,
    rotateUrls:document.getElementById('cfg-rot-urls').value
  };
  fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.ok){ CFG=d.config; fillConfig(); toast('Configuração salva'); renderAll(); }
      else toast('Erro ao salvar',false);
    })
    .catch(function(){toast('Erro ao salvar',false);});
});
document.getElementById('reset-btn').addEventListener('click',function(){
  if(!confirm('Tem certeza? Isto apaga todos os leads e eventos.')) return;
  fetch('/api/reset-stats',{method:'POST'})
    .then(function(){ toast('Estatísticas zeradas'); globe=null; refresh(); })
    .catch(function(){toast('Erro',false);});
});

/* ── Auto-refresh ── */
function setupAuto(){
  if(autoTimer) clearInterval(autoTimer);
  if(!document.getElementById('ar-toggle').checked) return;
  var iv=+document.getElementById('ar-interval').value;
  autoTimer=setInterval(refresh,iv);
}
document.getElementById('ar-toggle').addEventListener('change',setupAuto);
document.getElementById('ar-interval').addEventListener('change',setupAuto);

/* ── Boot ── */
var LS=document.getElementById('loading-screen');
function hideLS(){ if(LS){ LS.classList.add('hide'); setTimeout(function(){LS.style.display='none';},320); } }
// rede de segurança: nunca deixa a tela de carregamento presa
var lsGuard=setTimeout(hideLS,8000);
refresh().then(function(){
  setupAuto();
  clearTimeout(lsGuard); hideLS();
}).catch(function(){
  clearTimeout(lsGuard); hideLS();
});
</script>
</body>
</html>`;
