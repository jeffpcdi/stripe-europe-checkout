// Dashboard "Pulse" — servida como HTML estático em /dashboard.
// Todos os dados são carregados via /api/stats, /api/config e /api/health (client-side).
// IMPORTANTE: este arquivo é uma template string — não usar crase nem ${ } no conteúdo.
module.exports = `<!DOCTYPE html>
<html lang="pt" class="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0a0a0f" />
<title>ROI-NADOS — Radar de Vendas & Funil</title>
<link rel="icon" href="/assets/roi-nados-logo.jpg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
<script src="https://unpkg.com/globe.gl"></script>
<style>
:root{
  --bg:#0a0a0b; --panel:#0e0e10; --card:#101013; --card2:#161619; --hover:#1b1b1f;
  --border:rgba(255,255,255,.07); --border2:rgba(255,255,255,.13);
  --text:#ededf0; --muted:#9d9da8; --muted2:#68686f;
  --cyan:#52a8ff; --pink:#ff5674; --green:#3ecf8e; --amber:#f5b544; --red:#ff5674;
  --radius:10px; --radius-sm:8px;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;font-size:14.5px;line-height:1.55;-webkit-font-smoothing:antialiased;
}
h1,h2,h3,h4{font-family:'Inter',system-ui,sans-serif;margin:0;letter-spacing:-.02em;font-weight:600}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:#2a2a30;border-radius:8px}
::-webkit-scrollbar-track{background:transparent}

/* ── Layout ── */
.app{display:flex;flex-direction:column;min-height:100vh}

/* ── Header hero: marca ROI-NADOS + dock ── */
.hero-head{position:relative;background:linear-gradient(180deg,#101014 0%,var(--bg) 100%);border-bottom:1px solid var(--border);overflow:hidden}
.hh-glow{position:absolute;inset:-40% -10% auto;height:180%;pointer-events:none;
  background:
    radial-gradient(420px 200px at 12% 30%, rgba(255,86,116,.14), transparent 65%),
    radial-gradient(460px 220px at 40% 10%, rgba(82,168,255,.12), transparent 65%),
    radial-gradient(300px 160px at 78% 40%, rgba(62,207,142,.06), transparent 70%);
  animation:hhFloat 12s ease-in-out infinite alternate}
@keyframes hhFloat{0%{transform:translateX(-2%) translateY(0)}100%{transform:translateX(2%) translateY(4%)}}
.hh-inner{position:relative;display:flex;align-items:center;gap:20px;padding:18px 26px 10px;flex-wrap:wrap}
/* marca centralizada: status ancorado à direita, marca no centro real do header */
.brand-xl{display:flex;align-items:center;justify-content:center;gap:16px;flex:1;min-width:0}
.hh-inner::before{content:'';flex:0 0 0}
.logo-orbit{position:relative;width:68px;height:68px;flex-shrink:0}
.logo-orbit img{position:absolute;inset:5px;width:58px;height:58px;border-radius:50%;object-fit:cover;z-index:2;
  box-shadow:0 0 0 2px rgba(255,255,255,.14),0 4px 18px rgba(0,0,0,.6);
  filter:contrast(1.18) saturate(1.25) brightness(1.08)}
.logo-orbit::after{content:'';position:absolute;inset:5px;border-radius:50%;z-index:3;pointer-events:none;
  background:radial-gradient(circle at 32% 26%,rgba(255,255,255,.22),transparent 48%)}
.logo-ring{position:absolute;inset:0;border-radius:50%;padding:2.5px;z-index:1;
  background:conic-gradient(from var(--ra,0deg),#ff2d6f,#52a8ff,#25f4ee,#ff2d6f);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;
  animation:ringSpin 5s linear infinite;
  filter:drop-shadow(0 0 10px rgba(255,45,111,.65)) drop-shadow(0 0 18px rgba(37,244,238,.4))}
@property --ra{syntax:'<angle>';initial-value:0deg;inherits:false}
@keyframes ringSpin{to{--ra:360deg}}
.brand-txt{display:flex;flex-direction:column;gap:2px}
.bt-name{font-weight:800;font-size:28px;line-height:1;letter-spacing:.04em;
  background:linear-gradient(92deg,#ff3d7a 0%,#ff6b8a 28%,#6cb4ff 62%,#3ffcf6 100%);
  background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
  animation:brandShift 6s ease-in-out infinite alternate;
  filter:drop-shadow(0 1px 0 rgba(0,0,0,.55)) drop-shadow(0 0 18px rgba(255,45,111,.5)) drop-shadow(0 0 26px rgba(37,244,238,.25))}
.bt-dash{-webkit-text-fill-color:transparent}
@keyframes brandShift{0%{background-position:0% 0}100%{background-position:100% 0}}
.hh-status{margin-left:auto;display:flex;align-items:center;gap:14px;position:absolute;right:26px;top:50%;transform:translateY(-50%)}
.hh-live{font-size:12px;color:var(--muted);background:var(--card);border:1px solid var(--border);padding:7px 14px;border-radius:20px}

/* dock de navegação: grande, central, interativo */
.nav.dock{position:relative;display:flex;flex-direction:row;gap:6px;padding:10px 22px 14px;overflow-x:auto;scrollbar-width:none}
.nav.dock::-webkit-scrollbar{display:none}
.nav.dock button{position:relative;display:flex;align-items:center;gap:10px;cursor:pointer;border:1px solid transparent;background:transparent;color:var(--muted);padding:11px 18px;border-radius:12px;font-size:14px;font-weight:600;font-family:inherit;transition:.2s;white-space:nowrap}
.nav.dock button .d-ico{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;background:var(--card2);box-shadow:inset 0 0 0 1px var(--border);transition:.2s;flex-shrink:0}
.nav.dock button svg{width:17px;height:17px}
.nav.dock button:hover{color:var(--text);background:var(--hover);transform:translateY(-2px)}
.nav.dock button:hover .d-ico{box-shadow:inset 0 0 0 1px var(--border2),0 4px 14px rgba(0,0,0,.4)}
.nav.dock button.active{color:var(--text);background:var(--card);border-color:var(--border2);box-shadow:0 6px 22px rgba(0,0,0,.45)}
.nav.dock button.active .d-ico{background:linear-gradient(135deg,rgba(255,45,111,.22),rgba(82,168,255,.22));box-shadow:inset 0 0 0 1px rgba(255,86,116,.4)}
.nav.dock button.active svg{color:#ff5674}
.nav.dock button.active::after{content:'';position:absolute;left:16px;right:16px;bottom:-14px;height:2px;border-radius:2px;background:linear-gradient(90deg,#ff2d6f,#52a8ff);box-shadow:0 0 10px rgba(255,45,111,.7)}
.nav .badge{margin-left:2px;background:var(--pink);color:#fff;font-size:10px;font-weight:700;padding:1px 7px;border-radius:20px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin-right:6px;box-shadow:0 0 8px var(--green)}
.dot.off{background:var(--red);box-shadow:0 0 8px var(--red)}

.main{flex:1;min-width:0;display:flex;flex-direction:column}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 26px;background:rgba(10,10,11,.85);backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
.topbar h2{font-size:17px;font-weight:600}
.topbar .sub{font-size:12px;color:var(--muted2)}
.spacer{flex:1}
.segment{display:flex;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:2px;gap:2px}
/* grupo do topo à direita: busca, atualizar e período */
.tb-right{display:flex;align-items:center;gap:8px;margin-left:auto;position:relative}
#period-custom{display:inline-flex;align-items:center;gap:6px}
#period-custom svg{flex-shrink:0}
#period-custom-lbl:empty{display:none}
#period-custom-lbl{font-size:11px;font-family:'Geist Mono';color:var(--cyan)}
/* popover de segmentação */
.dr-pop{position:absolute;top:calc(100% + 8px);right:0;z-index:60;width:320px;background:var(--card);border:1px solid var(--border2);border-radius:14px;padding:16px;
  box-shadow:0 18px 48px rgba(0,0,0,.6),0 0 22px -14px var(--cyan);animation:drIn .22s cubic-bezier(.2,.8,.3,1)}
@keyframes drIn{from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:none}}
.dr-head{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:14px}
.dr-row{display:flex;gap:10px;margin-bottom:14px}
.dr-field{flex:1;display:flex;flex-direction:column;gap:5px}
.dr-field label{font-size:11px;color:var(--muted2);font-weight:600}
.dr-inp{font-size:12.5px;padding:8px 10px;color-scheme:dark}
.dr-hours{border-top:1px solid var(--border);padding-top:12px;margin-bottom:14px;transition:opacity .2s}
.dr-hours.off{opacity:.4;pointer-events:none}
.dr-hours-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.dr-hours-head label{font-size:11px;color:var(--muted2);font-weight:600}
.dr-hlbl{font-size:12px;font-family:'Geist Mono';font-weight:700;color:var(--cyan)}
.dr-sliders{display:flex;flex-direction:column;gap:6px}
.dr-sliders input[type=range]{width:100%;accent-color:var(--cyan)}
.dr-hint{margin:8px 0 0;font-size:10.5px;color:var(--muted2)}
.dr-hours.off .dr-hint{color:var(--amber)}
.dr-actions{display:flex;justify-content:flex-end;gap:8px}
.segment button{background:transparent;border:0;color:var(--muted);font-size:12.5px;font-weight:500;font-family:inherit;padding:6px 12px;border-radius:6px;cursor:pointer;transition:.15s}
.segment button.active{background:var(--hover);color:var(--text);box-shadow:inset 0 0 0 1px var(--border2)}
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
.btn.danger{border-color:rgba(255,86,116,.5);color:var(--red)}
.btn.danger:hover{background:rgba(255,86,116,.12)}
.btn-sm{padding:5px 10px;font-size:12px;border-radius:8px}
.btn-icon{background:var(--card2);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:5px 8px;cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;transition:.15s;white-space:nowrap}
.btn-icon:hover{background:var(--hover);color:var(--text)}

.content{padding:24px 26px 90px}
/* Uma seção por vez: só a aba ativa fica visível */
section.view{display:none}
section.view.active{display:block;animation:fade .3s ease}
/* sections empilhadas no mesmo grupo: divisor sutil entre elas */
section.view.active~section.view.active{margin-top:34px;padding-top:30px;border-top:1px solid var(--border)}
/* cabeçalho de bloco (aparece só quando a section está empilhada num grupo) */
.block-head{display:none;align-items:center;gap:11px;margin:0 0 18px}
section.view.active~section.view.active .block-head{display:flex}
.block-head .bh-ico{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--card2);flex-shrink:0;box-shadow:inset 0 0 0 1px var(--border)}
.block-head .bh-ico svg{width:18px;height:18px;color:var(--cyan)}
.block-head h2{font-size:18px;font-weight:700;line-height:1.1}
.block-head p{font-size:12.5px;color:var(--muted2);margin-top:1px}
/* quando empilhada, o primeiro section-title da section não precisa de margin-top */
section.view.active~section.view.active .section-title:first-of-type{margin-top:0}
@keyframes fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
/* Cabeçalho âncora de cada seção */
.view-head{display:flex;align-items:center;gap:14px;margin:0 0 18px}
.view-head .vh-ico{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:var(--card2);flex-shrink:0;box-shadow:inset 0 0 0 1px var(--border)}
.view-head .vh-ico svg{width:22px;height:22px;color:var(--cyan)}
.view-head h2{font-size:26px;line-height:1.05}
.view-head .vh-sub{font-size:13.5px;color:var(--muted2);margin-top:3px}
/* Revelação ao rolar */
.reveal{opacity:0;transform:translateY(22px);transition:opacity .6s cubic-bezier(.2,.8,.2,1),transform .6s cubic-bezier(.2,.8,.2,1)}
.reveal.in{opacity:1;transform:none}

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
.card.tint-cyan,.card.tint-pink,.card.tint-green,.card.tint-amber{background:var(--card)}
.kpi .k-top{display:flex;align-items:center;gap:9px;color:var(--muted);font-size:12.5px;font-weight:500}
.kpi .k-ico{width:30px;height:30px;border-radius:7px;display:grid;place-items:center;background:var(--card2);flex-shrink:0;box-shadow:inset 0 0 0 1px var(--border)}
.kpi .k-ico svg{width:15px;height:15px}
.kpi .k-val{font-family:'Geist Mono',monospace;font-weight:600;font-size:28px;margin-top:12px;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums}
.kpi .k-sub{font-size:12.5px;color:var(--muted2);margin-top:7px}
.k-val.small{font-size:25px}
.k-val.xsmall{font-size:19px}
.k-ico.ic-cyan{background:rgba(82,168,255,.14);color:var(--cyan)}
.k-ico.ic-pink{background:rgba(255,86,116,.14);color:var(--pink)}
.k-ico.ic-green{background:rgba(62,207,142,.14);color:var(--green)}
.k-ico.ic-amber{background:rgba(245,181,68,.14);color:var(--amber)}
.hl-card .k-flag{display:inline-flex;align-items:center;gap:8px}
.hl-card .k-flag .fi{font-size:20px;line-height:1}
/* ── Ao Vivo ── */
.nav .live-badge{background:var(--green);color:#04140d}
#live-globe{width:100%;height:520px;border-radius:var(--radius);overflow:hidden;position:relative;
  background:radial-gradient(circle at 50% 38%,#16233f,#080d1a 55%,#020308 78%)}
#live-globe canvas{filter:contrast(1.15) saturate(1.25) brightness(1.1)}
/* badge de presença sobre o globo */
.globe-badge{position:absolute;top:14px;left:14px;z-index:5;display:flex;align-items:center;gap:8px;
  font-size:12px;color:var(--text);background:rgba(10,12,20,.72);border:1px solid var(--border2);
  padding:7px 13px;border-radius:20px;backdrop-filter:blur(8px);box-shadow:0 4px 16px rgba(0,0,0,.4)}
.globe-badge b{font-family:'Geist Mono';color:var(--green);text-shadow:0 0 10px rgba(62,207,142,.5)}
/* card do globo: controles flutuantes + fullscreen */
.globe-card{position:relative;overflow:hidden}
.globe-card::after{content:'';position:absolute;top:0;left:0;right:0;height:2px;pointer-events:none;
  background:linear-gradient(90deg,#25f4ee,#52a8ff 45%,#ff2d6f);opacity:.5;box-shadow:0 0 10px -2px #52a8ff}
.globe-tools{position:absolute;top:14px;right:14px;z-index:5;display:flex;flex-direction:column;gap:6px;
  background:rgba(13,13,18,.72);border:1px solid var(--border2);border-radius:12px;padding:6px;backdrop-filter:blur(10px);
  box-shadow:0 8px 24px rgba(0,0,0,.5)}
.gt-btn{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;border:0;background:transparent;color:var(--muted);cursor:pointer;transition:.18s}
.gt-btn svg{width:16px;height:16px}
.gt-btn:hover{background:var(--hover);color:var(--text);transform:scale(1.08)}
.gt-btn:active{transform:scale(.94)}
.gt-div{height:1px;background:var(--border);margin:1px 4px}
.globe-hint{position:absolute;left:14px;bottom:12px;z-index:5;font-size:10.5px;color:var(--muted2);letter-spacing:.06em;
  background:rgba(13,13,18,.6);border:1px solid var(--border);padding:4px 10px;border-radius:14px;backdrop-filter:blur(8px);pointer-events:none;opacity:.85}
/* layout: globo + painel lateral de presença */
.globe-wrap{display:grid;grid-template-columns:1fr 300px;gap:16px;margin-bottom:16px}
@media(max-width:960px){.globe-wrap{grid-template-columns:1fr}}
.globe-side{display:flex;flex-direction:column;gap:12px;min-width:0}
.gs-stats{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.gs-stat{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:12px;transition:.2s}
.gs-stat:hover{border-color:var(--border2);transform:translateY(-2px)}
.gs-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.gs-dot.grn-d{background:var(--green);box-shadow:0 0 9px rgba(62,207,142,.6);animation:hDot 2.4s ease-in-out infinite}
.gs-dot.pnk-d{background:var(--pink);box-shadow:0 0 9px rgba(255,86,116,.6)}
.gs-txt{display:flex;flex-direction:column;line-height:1.2}
.gs-txt b{font-family:'Geist Mono';font-size:19px}
.gs-txt span{font-size:10.5px;color:var(--muted2);text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.gs-leads{padding:0;flex:1;display:flex;flex-direction:column;overflow:hidden}
.gs-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border);font-size:12.5px;font-weight:700}
.gs-all{margin-left:auto;background:none;border:1px solid var(--border);color:var(--muted);font-size:11px;font-weight:600;padding:4px 10px;border-radius:7px;cursor:pointer;transition:.2s}
.gs-all:hover{color:var(--text);border-color:var(--cyan);box-shadow:0 0 10px -4px var(--cyan)}
.gs-list{flex:1;overflow-y:auto}
.gs-row{display:flex;align-items:center;gap:9px;padding:9px 14px;border-bottom:1px solid var(--border);font-size:12px;animation:kpiIn .35s ease backwards}
.gs-row:last-child{border-bottom:none}
.gs-row .gr-flag{font-size:15px;flex-shrink:0}
.gs-row .gr-main{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.gs-row .gr-main b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gs-row .gr-main span{font-size:10.5px;color:var(--muted2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gs-row .gr-dur{font-family:'Geist Mono';font-size:10.5px;color:var(--muted2);flex-shrink:0}
.gs-row.hot .gr-main b{color:var(--pink)}
.gs-row .gr-ck{flex-shrink:0;color:var(--pink);display:inline-flex}
.gs-row .gr-ck svg{width:12px;height:12px}
.gs-more{padding:8px 14px;font-size:11px;color:var(--muted2);text-align:center}
/* popup do globo expandido */
.globe-modal{position:fixed;inset:0;z-index:120;display:grid;place-items:center}
.gm-scrim{position:absolute;inset:0;background:rgba(2,3,8,.72);backdrop-filter:blur(7px);opacity:0;transition:opacity .4s ease}
.gm-panel{position:relative;width:min(1240px,95vw);height:min(88vh,920px);opacity:0;transform:scale(.9) translateY(22px);
  transition:opacity .45s cubic-bezier(.2,.8,.3,1),transform .45s cubic-bezier(.2,.8,.3,1)}
.globe-modal.open .gm-scrim{opacity:1}
.globe-modal.open .gm-panel{opacity:1;transform:none}
.gm-body{width:100%;height:100%}
.gm-body .globe-card{height:100%;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.7),0 0 40px -18px var(--cyan)}
.gm-body #live-globe{height:100%!important;border-radius:18px}
.gm-close{position:absolute;top:-14px;right:-14px;z-index:6;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;cursor:pointer;
  background:var(--card);border:1px solid var(--border2);color:var(--muted);transition:.25s cubic-bezier(.34,1.56,.64,1)}
.gm-close svg{width:16px;height:16px}
.gm-close:hover{color:var(--text);transform:scale(1.15) rotate(90deg);border-color:var(--pink);box-shadow:0 0 14px -4px var(--pink)}
#live-globe::before,#globe::before{content:'';position:absolute;inset:0;z-index:0;pointer-events:none;border-radius:inherit;
  background-image:
    radial-gradient(1px 1px at 10% 15%,rgba(255,255,255,.5),transparent),
    radial-gradient(1px 1px at 25% 8%,rgba(255,255,255,.35),transparent),
    radial-gradient(1px 1px at 55% 5%,rgba(255,255,255,.3),transparent),
    radial-gradient(1px 1px at 70% 18%,rgba(255,255,255,.4),transparent),
    radial-gradient(1px 1px at 30% 42%,rgba(255,255,255,.35),transparent),
    radial-gradient(1px 1px at 80% 28%,rgba(255,255,255,.4),transparent),
    radial-gradient(1px 1px at 48% 65%,rgba(255,255,255,.35),transparent),
    radial-gradient(1px 1px at 90% 62%,rgba(255,255,255,.35),transparent),
    radial-gradient(1px 1px at 22% 82%,rgba(255,255,255,.3),transparent),
    radial-gradient(1px 1px at 52% 85%,rgba(255,255,255,.35),transparent),
    radial-gradient(1px 1px at 95% 78%,rgba(255,255,255,.3),transparent),
    radial-gradient(1px 1px at 45% 95%,rgba(255,255,255,.3),transparent);
  animation:starTwinkle 5s ease-in-out infinite alternate}
@keyframes starTwinkle{0%{opacity:.5}50%{opacity:.9}100%{opacity:.6}}
.live-grid{display:grid;grid-template-columns:1.35fr 1fr;gap:16px}
.live-grid>.card{min-width:0}
#live-globe canvas{max-width:100%}
@media(max-width:1000px){.live-grid{grid-template-columns:1fr}}
.live-list-card{padding:0;max-height:560px;overflow-y:auto}
.live-list{display:flex;flex-direction:column}
.live-pill{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--green);background:rgba(62,207,142,.12);border:1px solid rgba(62,207,142,.28);padding:4px 11px;border-radius:20px}
.live-dot-anim{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 0 rgba(62,207,142,.6);animation:livePulse 1.6s infinite}
@keyframes livePulse{0%{box-shadow:0 0 0 0 rgba(62,207,142,.55)}70%{box-shadow:0 0 0 7px rgba(62,207,142,0)}100%{box-shadow:0 0 0 0 rgba(62,207,142,0)}}
.lrow{display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border);transition:background .15s}
.lrow:last-child{border-bottom:0}
.lrow:hover{background:var(--hover)}
.lrow .lflag{font-size:22px;line-height:1;flex-shrink:0}
.lrow .lmain{min-width:0;flex:1}
.lrow .lmain b{display:block;font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lrow .lmain span{display:block;font-size:11.5px;color:var(--muted2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.lrow .lpage{font-family:var(--mono,monospace);color:var(--muted)}
.lrow .lmeta{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0}
.lrow .lgw{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 7px;border-radius:20px}
.lrow .lgw.stripe{background:rgba(82,168,255,.14);color:var(--cyan)}
.lrow .lgw.cooud{background:rgba(255,86,116,.14);color:var(--pink)}
.lrow .ldur{font-size:11px;color:var(--muted2)}
.lrow .ldot{width:7px;height:7px;border-radius:50%;background:var(--green);flex-shrink:0;box-shadow:0 0 8px var(--green)}
.lrow.idle .ldot{background:var(--amber);box-shadow:0 0 8px var(--amber)}
/* lead quente: passou pelo funil e está no checkout agora */
.lrow.hot{position:relative;background:linear-gradient(90deg,rgba(255,45,111,.09),rgba(255,45,111,.02) 60%,transparent);border-left:3px solid var(--pink);padding-left:11px}
.lrow.hot:hover{background:linear-gradient(90deg,rgba(255,45,111,.14),rgba(255,45,111,.04) 60%,transparent)}
.lrow.hot .ldot{background:var(--pink);box-shadow:0 0 9px var(--pink);animation:hotDot 1.3s ease-in-out infinite}
@keyframes hotDot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.45);opacity:.75}}
.lrow.hot .lmain b{color:var(--pink)}
.lck{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  padding:3px 9px;border-radius:20px;background:rgba(255,45,111,.16);color:var(--pink);border:1px solid rgba(255,45,111,.35);
  box-shadow:0 0 10px -4px var(--pink);animation:lckGlow 1.8s ease-in-out infinite}
.lck svg{width:11px;height:11px}
@keyframes lckGlow{0%,100%{box-shadow:0 0 6px -4px var(--pink)}50%{box-shadow:0 0 14px -3px var(--pink)}}
.lfun{font-size:10px;color:var(--muted);background:var(--card2);border:1px solid var(--border);padding:2px 7px;border-radius:12px;font-family:'Geist Mono'}
.lhot-head{display:flex;align-items:center;gap:9px;font-size:11.5px;font-weight:700;color:var(--pink);text-transform:uppercase;letter-spacing:.09em;
  padding:10px 14px;border-bottom:1px solid rgba(255,45,111,.25);background:rgba(255,45,111,.06);position:sticky;top:0;z-index:2;backdrop-filter:blur(6px)}
.lhot-dot{width:8px;height:8px;border-radius:50%;background:var(--pink);box-shadow:0 0 10px var(--pink);animation:hotDot 1.3s ease-in-out infinite}
.live-empty{padding:44px 20px;text-align:center;color:var(--muted2);font-size:13px}
/* Entrada escalonada de cima para baixo */
@keyframes liveRowIn{0%{opacity:0;transform:translateY(-14px)}60%{opacity:1}100%{opacity:1;transform:translateY(0)}}
.lrow.enter{animation:liveRowIn .5s cubic-bezier(.2,.8,.2,1) both}
.lrow.fresh{background:linear-gradient(90deg,rgba(62,207,142,.12),transparent 60%)}
.lrow .lnew{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#04140d;background:var(--green);padding:2px 6px;border-radius:20px;margin-right:2px}
/* ── Pulso de tráfego ── */
.traffic-card{display:grid;grid-template-columns:auto 1fr auto;gap:20px;align-items:center;position:relative;overflow:hidden;border-radius:14px}
.traffic-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;pointer-events:none;
  background:linear-gradient(90deg,#25f4ee,#52a8ff 55%,#ff2d6f);opacity:.5;box-shadow:0 0 10px -2px #25f4ee}
@media(max-width:760px){.traffic-card{grid-template-columns:1fr;gap:14px}}
.tf-now{display:flex;flex-direction:column;gap:3px}
.tf-now .tf-big{font-family:'Geist Mono';font-size:34px;line-height:1;font-weight:700;text-shadow:0 0 18px rgba(37,244,238,.3)}
.tf-now .tf-lbl{font-size:11.5px;color:var(--muted2)}
.tf-now .tf-avg{font-size:11px;color:var(--muted2);margin-top:4px;background:var(--card2);border:1px solid var(--border);padding:3px 9px;border-radius:12px;width:max-content}
.tf-now .tf-avg b{color:var(--cyan);font-family:'Geist Mono'}
.tf-mid{display:flex;flex-direction:column;gap:5px;min-width:0}
.tf-bars{display:flex;align-items:flex-end;gap:3px;height:64px;min-width:0}
.tf-bars .tb{flex:1;min-width:2px;border-radius:3px 3px 0 0;background:linear-gradient(180deg,var(--cyan),rgba(82,168,255,.5));opacity:.55;transition:height .5s cubic-bezier(.2,.8,.2,1),opacity .3s;transform-origin:bottom;cursor:default}
.tf-bars .tb:hover{opacity:1;box-shadow:0 0 8px rgba(37,244,238,.5)}
.tf-bars .tb.hot{background:linear-gradient(180deg,var(--amber),rgba(245,181,68,.55));opacity:1;box-shadow:0 0 8px rgba(245,181,68,.4)}
.tf-bars .tb.cur{opacity:1;background:linear-gradient(180deg,#ff2d6f,rgba(255,86,116,.55));box-shadow:0 0 10px rgba(255,45,111,.55);animation:curBar 1.6s ease-in-out infinite}
@keyframes curBar{0%,100%{filter:brightness(1)}50%{filter:brightness(1.35)}}
.tf-axis{display:flex;justify-content:space-between;font-size:10px;color:var(--muted2);font-family:'Geist Mono';letter-spacing:.03em;padding:0 1px}
.tf-axis .ax-now{color:var(--pink);font-weight:600}
.tf-trend{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:700;padding:8px 14px;border-radius:12px;white-space:nowrap}
.tf-trend svg{width:15px;height:15px}
.tf-trend.up{color:var(--green);background:rgba(62,207,142,.13)}
.tf-trend.down{color:var(--red);background:rgba(255,86,116,.13)}
.tf-trend.flat{color:var(--muted2);background:var(--card2)}
.tf-trend.hot{color:var(--amber);background:rgba(245,181,68,.14);animation:hotGlow 1.4s infinite}
@keyframes hotGlow{0%,100%{box-shadow:0 0 0 0 rgba(245,181,68,.4)}50%{box-shadow:0 0 0 6px rgba(245,181,68,0)}}
.tf-sub{grid-column:1/-1;font-size:12px;color:var(--muted2);border-top:1px solid var(--border);padding-top:12px;margin-top:2px;display:flex;gap:16px;flex-wrap:wrap;align-items:center}
.tf-sub b{color:var(--text);font-family:'Geist Mono'}
.tf-sub .tfs{display:inline-flex;align-items:center;gap:7px}
.tf-sub .tfd{width:7px;height:7px;border-radius:50%;flex-shrink:0;box-shadow:0 0 7px currentColor}
.tf-sub .tfm{color:var(--muted2);font-size:11px}
/* ── Notificações ── */
.notif-head{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;border-bottom:1px solid var(--border)}
.notif-head .nh-title{display:flex;align-items:center;gap:9px;font-size:13.5px;font-weight:700}
.notif-head .nh-title .live-dot-anim{width:7px;height:7px}
.notif-tools{display:flex;align-items:center;gap:6px}
.icon-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;border:1px solid var(--border);background:var(--card);color:var(--muted);cursor:pointer;transition:.15s}
.icon-btn:hover{color:var(--text);border-color:var(--border2)}
.icon-btn svg{width:16px;height:16px}
.icon-btn.on{color:var(--green);border-color:rgba(62,207,142,.4);background:rgba(62,207,142,.1)}
.notif-list{max-height:300px;overflow-y:auto;padding:6px}
.nrow{display:flex;align-items:flex-start;gap:11px;padding:10px 11px;border-radius:10px;animation:liveRowIn .45s cubic-bezier(.2,.8,.2,1) both}
.nrow:hover{background:var(--hover)}
.nrow .nico{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.nrow .nico svg{width:15px;height:15px}
.nrow .nico.visit{background:rgba(82,168,255,.14);color:var(--blue)}
.nrow .nico.checkout{background:rgba(245,181,68,.14);color:var(--amber)}
.nrow .nico.sale{background:rgba(62,207,142,.14);color:var(--green)}
.nrow .nico.spike{background:rgba(255,86,116,.14);color:var(--pink)}
.nrow .nbody{min-width:0;flex:1}
.nrow .nbody b{font-size:12.5px;font-weight:600;color:var(--text);display:block}
.nrow .nbody span{font-size:11px;color:var(--muted2)}
.nrow .ntime{font-size:10.5px;color:var(--muted2);flex-shrink:0;margin-top:2px}
.notif-empty{padding:34px 18px;text-align:center;color:var(--muted2);font-size:12.5px}
.live-right{display:flex;flex-direction:column;gap:16px;min-width:0}
.pos{color:var(--green)} .neg{color:var(--red)} .cyn{color:var(--cyan)} .pnk{color:var(--pink)} .amb{color:var(--amber)} .grn{color:var(--green)}
/* Valores de KPI com cor semântica sutil + glow discreto */
.k-val .pos,.k-val .grn{color:var(--green);text-shadow:0 0 20px rgba(62,207,142,.3)}
.k-val .cyn,.k-val .blu{color:var(--cyan);text-shadow:0 0 20px rgba(82,168,255,.28)}
.k-val .pnk{color:var(--pink);text-shadow:0 0 20px rgba(255,86,116,.28)}
.k-val .amb{color:var(--amber);text-shadow:0 0 20px rgba(245,181,68,.28)}
.k-val .neg{text-shadow:0 0 20px rgba(255,86,116,.3)}

.section-title{display:flex;align-items:center;gap:10px;margin:30px 0 15px;font-size:16px;font-weight:600;color:var(--text)}
.section-title .line{flex:1;height:1px;background:var(--border)}

/* ── Gráfico ── */
.chart-wrap{position:relative;min-height:220px;width:100%}
.chart-legend{display:flex;gap:18px;font-size:12px;color:var(--muted);margin-top:12px;flex-wrap:wrap}
.leg-dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:middle}

/* ── Funil ── */
.funnel{display:flex;flex-direction:column;gap:12px}
.fstep{display:flex;align-items:center;gap:14px}
.fbar-track{flex:1;height:48px;background:var(--card2);border-radius:12px;overflow:hidden;position:relative}
.fbar{height:100%;border-radius:12px;display:flex;align-items:center;padding:0 16px;font-weight:700;font-family:'Geist Mono';color:#04121a;min-width:54px;transition:width .7s cubic-bezier(.2,.8,.2,1)}
.fstep .flabel{width:158px;flex-shrink:0}
.fstep .flabel b{display:block;font-size:14px}
.fstep .flabel span{font-size:11.5px;color:var(--muted2)}
.frate{width:60px;text-align:right;font-weight:700;font-family:'Geist Mono';color:var(--cyan);font-size:15px}

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
.tag.checkout{color:var(--amber);background:rgba(245,181,68,.12);border-color:rgba(245,181,68,.3)}
.tag.purchased{color:var(--green);background:rgba(62,207,142,.12);border-color:rgba(62,207,142,.3)}
.tag.stripe{color:#8ab4ff;background:rgba(120,150,255,.12);border-color:rgba(120,150,255,.3)}
.tag.cooud{color:var(--pink);background:rgba(255,86,116,.12);border-color:rgba(255,86,116,.3)}
.tag.cap{color:var(--amber);background:rgba(245,181,68,.12);border-color:rgba(245,181,68,.3)}
.tag.rec{color:var(--cyan);background:rgba(82,168,255,.12);border-color:rgba(82,168,255,.3)}
.tag.orphan{color:var(--red);background:rgba(255,86,116,.12);border-color:rgba(255,86,116,.3)}
.muted{color:var(--muted2)}
.empty{padding:48px;text-align:center;color:var(--muted2);font-size:13px}
.tbl-count{font-size:12px;color:var(--muted2);margin-left:auto}

/* ── Geo ── */
.geo-grid{display:grid;grid-template-columns:1.3fr .9fr;gap:16px}
#globe{width:100%;height:440px;border-radius:var(--radius);overflow:hidden;position:relative;background:radial-gradient(circle at 50% 40%,#0d1522,#050608)}
.clist{display:flex;flex-direction:column;gap:2px;max-height:440px;overflow-y:auto}
.crow{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:11px;transition:.12s}
.crow:hover{background:var(--hover)}
.crow .flag{font-size:22px;width:30px;text-align:center;flex-shrink:0}
.crow .cn{flex:1;min-width:0}
.crow .cn b{font-size:13.5px;display:block}
.crow .cn span{font-size:11.5px;color:var(--muted2)}
.crow .cbar{width:80px;height:5px;background:var(--card2);border-radius:4px;overflow:hidden;flex-shrink:0}
.crow .cbar i{display:block;height:100%;background:var(--cyan)}
.crow .cval{font-family:'Geist Mono';font-weight:700;width:30px;text-align:right;font-size:14px;flex-shrink:0}

/* ── A/B ── */
/* barra de controle compacta (antes era um card grande) */
.ab-bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:10px 16px;margin-bottom:16px;position:relative;overflow:hidden}
.ab-bar::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--cyan),#52a8ff 50%,var(--pink));opacity:.45}
.ab-status{font-size:12.5px;color:var(--muted);font-weight:600;white-space:nowrap}
.ab-status.on{color:var(--green)}
.ab-split-wrap{flex:1;min-width:200px;display:flex;align-items:center;gap:10px;transition:opacity .25s}
.ab-split-wrap .abm{font-size:12px;font-family:'Geist Mono';min-width:78px;font-weight:600}
.ab-split-wrap input[type=range]{flex:1}
.ab-links{display:flex;gap:4px;margin-left:auto}
.ab-links a{font-size:11.5px;font-weight:600;color:var(--muted);text-decoration:none;padding:5px 10px;border-radius:8px;border:1px solid var(--border);transition:.15s;white-space:nowrap}
.ab-links a:hover{color:var(--cyan);border-color:var(--cyan)}
.ab-grid{display:grid;grid-template-columns:1fr 1.15fr;gap:16px;align-items:stretch}
@media(max-width:860px){.ab-grid{grid-template-columns:1fr}}
/* veredito refinado */
.verdict{position:relative;overflow:hidden;border:1px solid var(--border2);border-radius:14px;padding:22px;background:var(--card);animation:kpiIn .5s cubic-bezier(.2,.7,.3,1) backwards}
.verdict::before{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(320px 150px at 85% 0%,rgba(255,45,111,.08),transparent 65%),radial-gradient(280px 140px at 10% 100%,rgba(82,168,255,.07),transparent 65%)}
.verdict .win{font-family:'Geist Mono';font-size:30px;font-weight:700;margin-top:6px;letter-spacing:-.02em}
.verdict .win.cyn{text-shadow:0 0 22px rgba(82,168,255,.45)}
.verdict .win.pnk{text-shadow:0 0 22px rgba(255,86,116,.45)}
.vgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
.vcell{background:var(--card2);border-radius:12px;padding:13px 15px;border:1px solid var(--border);border-left:3px solid var(--vc,var(--border2))}
.vcell .vt{font-size:11px;color:var(--muted2);text-transform:uppercase;letter-spacing:.07em;font-weight:600}
.vcell .vv{font-family:'Geist Mono';font-weight:700;font-size:19px;margin-top:5px}
.vstats{display:flex;gap:18px;margin-top:16px;flex-wrap:wrap}
.vstat{font-size:12px;color:var(--muted2)}
.vstat b{color:var(--text);font-family:'Geist Mono';font-size:13px}
.conf-bar{height:7px;background:var(--card2);border-radius:6px;overflow:hidden;margin-top:8px}
.conf-bar i{display:block;height:100%;transition:width .8s ease,background .4s;border-radius:6px}
/* comparativo com barras integradas */
#ab-metrics{border-radius:14px;animation:kpiIn .5s cubic-bezier(.2,.7,.3,1) .08s backwards}
.abm-head{display:grid;grid-template-columns:1fr auto auto;gap:10px;font-size:10.5px;color:var(--muted2);text-transform:uppercase;letter-spacing:.08em;font-weight:700;padding-bottom:8px;border-bottom:1px solid var(--border2)}
.abm-head span:nth-child(2),.abm-head span:nth-child(3){min-width:92px;text-align:right}
.abrow{padding:11px 0;border-bottom:1px solid var(--border)}
.abrow:last-child{border-bottom:0;padding-bottom:2px}
.abrow .abr-top{display:grid;grid-template-columns:1fr auto auto;gap:10px;font-size:13px;align-items:center}
.abrow .abr-top .lbl{color:var(--muted)}
.abrow .abr-top .va,.abrow .abr-top .vb{text-align:right;min-width:92px;font-family:'Geist Mono';font-weight:600;font-size:13px}
.abrow .abr-top .lead-val{position:relative}
.abrow .abr-top .lead-val::after{content:'\\25B4';font-size:9px;margin-left:4px;opacity:.9}
.abrow .abr-bars{display:flex;flex-direction:column;gap:3px;margin-top:7px}
.abrow .abr-bars .b{height:5px;border-radius:3px;min-width:3px;transition:width .8s cubic-bezier(.2,.7,.3,1)}
.abrow .abr-bars .b.s{background:linear-gradient(90deg,var(--cyan),rgba(82,168,255,.55))}
.abrow .abr-bars .b.c{background:linear-gradient(90deg,var(--pink),rgba(255,86,116,.55))}

/* ── Config form ── */
.form-row{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}
.form-row label{font-size:12.5px;color:var(--muted);font-weight:600}
.form-row .hint{font-size:11.5px;color:var(--muted2);font-weight:400}
.range-wrap{display:flex;align-items:center;gap:14px}
input[type=range]{flex:1;accent-color:var(--cyan)}
.split-preview{display:flex;height:34px;border-radius:10px;overflow:hidden;font-size:12px;font-weight:700;color:#04121a;border:1px solid var(--border)}
.split-preview .sp-stripe{background:linear-gradient(180deg,var(--cyan),#3f96e8);display:grid;place-items:center;transition:width .45s cubic-bezier(.2,.7,.3,1)}
.split-preview .sp-cooud{background:linear-gradient(180deg,var(--pink),#e0295f);color:#fff;display:grid;place-items:center;flex:1}
/* cards de configuração com identidade */
.cfg-grid .cfg-card{position:relative;border-radius:14px;overflow:hidden;animation:kpiIn .5s cubic-bezier(.2,.7,.3,1) backwards;transition:border-color .25s,box-shadow .25s}
.cfg-grid .cfg-card:nth-child(1){animation-delay:.02s}.cfg-grid .cfg-card:nth-child(2){animation-delay:.09s}
.cfg-grid .cfg-card:nth-child(3){animation-delay:.16s}.cfg-grid .cfg-card:nth-child(4){animation-delay:.23s}
.cfg-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--cc),transparent 75%);opacity:.6;transition:opacity .25s}
.cfg-card:hover{border-color:var(--border2);box-shadow:0 10px 30px rgba(0,0,0,.4),0 0 20px -12px var(--cc)}
.cfg-card:hover::before{opacity:1}
.cfg-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:18px}
.cfg-head h3{font-size:14.5px;line-height:1.3}
.cfg-head p{margin:3px 0 0;font-size:11.5px;color:var(--muted2);line-height:1.45}
.cfg-ico{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex-shrink:0;
  background:color-mix(in srgb,var(--cc) 12%,transparent);color:var(--cc);border:1px solid color-mix(in srgb,var(--cc) 25%,transparent);
  transition:.28s cubic-bezier(.34,1.56,.64,1)}
.cfg-ico svg{width:16px;height:16px}
.cfg-card:hover .cfg-ico{transform:scale(1.12) rotate(-5deg);box-shadow:0 0 14px -4px var(--cc)}
.cfg-note{margin:2px 0 0;font-size:11.5px;color:var(--muted2);line-height:1.5;padding:9px 12px;background:var(--card2);border-radius:9px;border-left:2px solid var(--pink)}
/* zona de risco compacta */
.danger-card{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:16px;border-color:rgba(255,86,116,.22)!important;
  background:linear-gradient(90deg,rgba(255,86,116,.05),transparent 55%);animation:kpiIn .5s cubic-bezier(.2,.7,.3,1) .3s backwards}
.danger-card:hover{border-color:rgba(255,86,116,.4)!important}

/* ── Atividade ── */
.feed{display:flex;flex-direction:column}
.ev{display:flex;gap:13px;padding:13px 4px;border-bottom:1px solid var(--border)}
.ev:last-child{border-bottom:0}
.ev .ei{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex-shrink:0;background:var(--card2)}
.ev .ei svg{width:16px;height:16px}
.ev .et{font-size:13.5px;font-weight:600}
.ev .em{font-size:12px;color:var(--muted2);margin-top:2px}
.ev .ea{margin-left:auto;text-align:right;font-size:12px;color:var(--muted2);white-space:nowrap;flex-shrink:0}
.ev .amt{font-family:'Geist Mono';font-weight:700;font-size:14px}

/* ── Alertas ── */
.alert{display:flex;gap:12px;align-items:flex-start;border-radius:var(--radius);padding:15px 17px;margin-bottom:16px;border:1px solid rgba(245,181,68,.3);background:rgba(245,181,68,.08)}
.alert.info{border-color:rgba(82,168,255,.3);background:rgba(82,168,255,.07)}
.alert.ok{border-color:rgba(62,207,142,.3);background:rgba(62,207,142,.07)}
.alert.err{border-color:rgba(255,86,116,.3);background:rgba(255,86,116,.07)}
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

/* ── Toast ── */
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(80px);background:var(--card);border:1px solid var(--border2);color:var(--text);padding:12px 20px;border-radius:12px;font-size:13.5px;font-weight:600;z-index:60;transition:.3s;box-shadow:0 12px 40px rgba(0,0,0,.5);pointer-events:none}
.toast.show{transform:translateX(-50%) translateY(0)}
.toast.ok{border-color:rgba(62,207,142,.5)} .toast.err{border-color:rgba(255,86,116,.5)}

/* ── Health dots ── */
.health-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
.hitem{display:flex;align-items:center;gap:10px;padding:11px 14px;background:var(--card2);border-radius:10px;border:1px solid var(--border);font-size:12.5px;transition:.2s}
.hitem:hover{border-color:var(--border2);transform:translateY(-2px)}
.hitem .hdot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.hitem .hdot.ok{background:var(--green);box-shadow:0 0 8px rgba(62,207,142,.5);animation:hDot 2.4s ease-in-out infinite}
.hitem .hdot.warn{background:var(--red);box-shadow:0 0 8px rgba(255,86,116,.5)}
@keyframes hDot{0%,100%{box-shadow:0 0 5px rgba(62,207,142,.4)}50%{box-shadow:0 0 11px rgba(62,207,142,.75)}}
.hitem .hlbl{flex:1;font-weight:500}
.hitem .hstatus{font-size:11px;font-weight:600;font-family:'Geist Mono'}
.hitem .hstatus.ok{color:var(--green)} .hitem .hstatus.warn{color:var(--red)}

/* ── Responsivo ── */
@media(max-width:960px){
  .geo-grid,.ab-grid{grid-template-columns:1fr}
  .kpis{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
  .hh-inner{padding:14px 16px 8px}
  .logo-orbit{width:52px;height:52px}
  .logo-orbit img{inset:4px;width:44px;height:44px}
  .bt-name{font-size:20px}
  .hh-status{width:100%;margin-left:0}
  .nav.dock{padding:8px 12px 12px}
  .nav.dock button{padding:9px 13px;font-size:13px}
  .nav.dock button .d-lbl{display:none}
  .nav.dock button.active .d-lbl{display:inline}
}
#menuToggle{display:none!important}

/* ═══════════════ PERSONALIDADE · EFEITOS · MOVIMENTO ═══════════════ */
html{scroll-behavior:smooth}
::selection{background:rgba(82,168,255,.28);color:#fff}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--cyan);outline-offset:2px;border-radius:8px}

.app{position:relative;z-index:1}
@keyframes sheen{to{background-position:220% 0}}

/* Cards — elevação sutil no hover */
.card{transition:border-color .2s,background .2s}
.card:hover{border-color:var(--border2)}
.kpi{transition:border-color .25s,transform .25s,box-shadow .25s}
.kpi:hover{border-color:var(--border2)}

/* ── Visão Geral: hero ── */
.ov-hero{position:relative;display:flex;align-items:center;gap:20px;flex-wrap:wrap;border:1px solid transparent;border-radius:14px;padding:22px 26px;margin-bottom:18px;overflow:hidden;
  background:linear-gradient(120deg,#141419 0%,#101015 55%,#12121a 100%)}
.ov-hero::before{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(520px 210px at 85% 15%,rgba(255,45,111,.16),transparent 60%),
             radial-gradient(440px 190px at 12% 95%,rgba(82,168,255,.14),transparent 60%),
             radial-gradient(300px 150px at 55% 50%,rgba(37,244,238,.05),transparent 70%)}
/* borda em gradiente animado percorrendo o card */
.ovh-border{position:absolute;inset:0;border-radius:14px;padding:1px;pointer-events:none;z-index:3;
  background:conic-gradient(from var(--hb,0deg),rgba(255,45,111,.65),rgba(82,168,255,.15),rgba(37,244,238,.6),rgba(255,45,111,.12),rgba(255,45,111,.65));
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;
  animation:heroBorder 8s linear infinite}
@property --hb{syntax:'<angle>';initial-value:0deg;inherits:false}
@keyframes heroBorder{to{--hb:360deg}}
.ovh-shine{position:absolute;top:0;bottom:0;width:120px;pointer-events:none;transform:skewX(-18deg);
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.05),transparent);
  animation:ovShine 5.5s ease-in-out infinite}
@keyframes ovShine{0%,20%{left:-20%}60%,100%{left:115%}}
/* estrelas neon subindo no fundo da página inteira (mesma identidade do hero) */
.bg-particles{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.bg-particles i{position:absolute;bottom:-8px;width:4px;height:4px;border-radius:50%;opacity:0;
  animation:bgFloat var(--pd,16s) linear infinite var(--pw,0s)}
.bg-particles i:nth-child(1){left:4%;--pd:17s;--pw:0s;background:#ff2d6f;box-shadow:0 0 9px #ff2d6f;width:3px;height:3px}
.bg-particles i:nth-child(2){left:12%;--pd:22s;--pw:5s;background:#25f4ee;box-shadow:0 0 8px #25f4ee;width:2px;height:2px}
.bg-particles i:nth-child(3){left:21%;--pd:19s;--pw:2s;background:#52a8ff;box-shadow:0 0 9px #52a8ff}
.bg-particles i:nth-child(4){left:30%;--pd:24s;--pw:9s;background:#ff5674;box-shadow:0 0 7px #ff5674;width:2px;height:2px}
.bg-particles i:nth-child(5){left:39%;--pd:18s;--pw:4s;background:#25f4ee;box-shadow:0 0 10px #25f4ee;width:3px;height:3px}
.bg-particles i:nth-child(6){left:48%;--pd:26s;--pw:12s;background:#3ecf8e;box-shadow:0 0 8px #3ecf8e;width:2px;height:2px}
.bg-particles i:nth-child(7){left:57%;--pd:20s;--pw:6s;background:#52a8ff;box-shadow:0 0 9px #52a8ff;width:3px;height:3px}
.bg-particles i:nth-child(8){left:66%;--pd:23s;--pw:1s;background:#ff2d6f;box-shadow:0 0 8px #ff2d6f;width:2px;height:2px}
.bg-particles i:nth-child(9){left:75%;--pd:18.5s;--pw:8s;background:#25f4ee;box-shadow:0 0 9px #25f4ee}
.bg-particles i:nth-child(10){left:84%;--pd:25s;--pw:3s;background:#ff5674;box-shadow:0 0 8px #ff5674;width:3px;height:3px}
.bg-particles i:nth-child(11){left:91%;--pd:21s;--pw:10s;background:#52a8ff;box-shadow:0 0 8px #52a8ff;width:2px;height:2px}
.bg-particles i:nth-child(12){left:97%;--pd:19.5s;--pw:7s;background:#3ecf8e;box-shadow:0 0 9px #3ecf8e;width:3px;height:3px}
@keyframes bgFloat{0%{transform:translateY(0);opacity:0}4%{opacity:.75}80%{opacity:.4}100%{transform:translateY(-105vh);opacity:0}}
@media(prefers-reduced-motion:reduce){.bg-particles{display:none}}
/* partículas neon flutuando */
.ovh-particles{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.ovh-particles i{position:absolute;bottom:-6px;width:4px;height:4px;border-radius:50%;opacity:0;
  animation:pFloat var(--pd,7s) ease-in infinite var(--pw,0s)}
.ovh-particles i:nth-child(1){left:8%;--pd:8s;--pw:0s;background:#ff2d6f;box-shadow:0 0 8px #ff2d6f}
.ovh-particles i:nth-child(2){left:22%;--pd:11s;--pw:2.5s;background:#25f4ee;box-shadow:0 0 8px #25f4ee;width:3px;height:3px}
.ovh-particles i:nth-child(3){left:37%;--pd:9s;--pw:1.2s;background:#52a8ff;box-shadow:0 0 8px #52a8ff}
.ovh-particles i:nth-child(4){left:52%;--pd:12s;--pw:4s;background:#ff5674;box-shadow:0 0 7px #ff5674;width:3px;height:3px}
.ovh-particles i:nth-child(5){left:65%;--pd:8.5s;--pw:.8s;background:#25f4ee;box-shadow:0 0 9px #25f4ee}
.ovh-particles i:nth-child(6){left:76%;--pd:10s;--pw:3.2s;background:#52a8ff;box-shadow:0 0 8px #52a8ff;width:5px;height:5px}
.ovh-particles i:nth-child(7){left:88%;--pd:9.5s;--pw:1.8s;background:#ff2d6f;box-shadow:0 0 8px #ff2d6f;width:3px;height:3px}
.ovh-particles i:nth-child(8){left:95%;--pd:13s;--pw:5s;background:#3ecf8e;box-shadow:0 0 8px #3ecf8e}
@keyframes pFloat{0%{transform:translateY(0);opacity:0}8%{opacity:.9}88%{opacity:.5}100%{transform:translateY(-130px);opacity:0}}
.ovh-left{position:relative;min-width:0;z-index:2}
.ovh-greet{font-size:12px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:8px}
.ovh-greet::before{content:'';width:22px;height:2px;border-radius:2px;background:linear-gradient(90deg,#ff2d6f,#25f4ee);box-shadow:0 0 8px rgba(255,45,111,.6)}
.ovh-title{font-size:21px;font-weight:700;letter-spacing:-.02em;line-height:1.25}
.ovh-brand{background:linear-gradient(92deg,#ff2d6f,#52a8ff,#25f4ee);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:brandShift 6s ease-in-out infinite alternate;font-weight:800;filter:drop-shadow(0 0 12px rgba(255,45,111,.3))}
.ovh-sub{font-size:13px;color:var(--muted2);margin-top:5px}
/* ── KPIs turbinados ── */
.kpis-xl .kpi{border-radius:14px;padding-top:18px;--kglow:rgba(82,168,255,.12)}
.kpis-xl .kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:2.5px;border-radius:2px 2px 0 0;
  background:linear-gradient(90deg,var(--kg1,#3a3a44),var(--kg2,#26262c),var(--kg1,#3a3a44));background-size:220% 100%;
  animation:kpiTop 5s linear infinite;box-shadow:0 0 12px -2px var(--kg1,transparent)}
@keyframes kpiTop{to{background-position:-220% 0}}
/* aura radial que acende no hover */
.kpis-xl .kpi::after{content:'';position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .35s;
  background:radial-gradient(220px 120px at 50% 0%,var(--kglow),transparent 70%)}
.kpis-xl .kpi:hover::after{opacity:1}
.kpis-xl .kpi.tint-cyan{--kg1:#52a8ff;--kg2:#25f4ee;--kglow:rgba(82,168,255,.16)}
.kpis-xl .kpi.tint-pink{--kg1:#ff2d6f;--kg2:#ff5674;--kglow:rgba(255,45,111,.15)}
.kpis-xl .kpi.tint-blue{--kg1:#52a8ff;--kg2:#7d8cff;--kglow:rgba(82,168,255,.16)}
.kpis-xl .kpi.tint-green{--kg1:#3ecf8e;--kg2:#25f4ee;--kglow:rgba(62,207,142,.15)}
.kpis-xl .kpi.tint-amber{--kg1:#f5b544;--kg2:#ffd47e;--kglow:rgba(245,181,68,.15)}
/* ícone do KPI colorido pela identidade do card */
.kpis-xl .kpi .k-ico{background:color-mix(in srgb,var(--kg1) 13%,transparent);color:var(--kg1);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--kg1) 28%,transparent)}
.kpis-xl .kpi:hover{transform:translateY(-4px);border-color:var(--border2);box-shadow:0 14px 34px rgba(0,0,0,.5),0 0 22px -8px var(--kg1)}
.kpis-xl .kpi:hover .k-ico{transform:scale(1.12) rotate(-5deg);box-shadow:inset 0 0 0 1px var(--kg1),0 0 14px -3px var(--kg1)}
.kpis-xl .k-ico{transition:.28s cubic-bezier(.34,1.56,.64,1)}
.kpis-xl .k-val{transition:text-shadow .3s}
.kpis-xl .kpi:hover .k-val{text-shadow:0 0 22px var(--kglow)}
.kpis-xl .kpi{animation:kpiIn .55s cubic-bezier(.2,.7,.3,1) backwards}
.kpis-xl .kpi:nth-child(1){animation-delay:.02s}.kpis-xl .kpi:nth-child(2){animation-delay:.09s}
.kpis-xl .kpi:nth-child(3){animation-delay:.16s}.kpis-xl .kpi:nth-child(4){animation-delay:.23s}
@keyframes kpiIn{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}

/* ── Ministats (substitui os chips) ── */
.ministats{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;margin:2px 0 6px}
.mstat{position:relative;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px 14px 19px;overflow:hidden;transition:.24s;animation:kpiIn .5s cubic-bezier(.2,.7,.3,1) backwards;--mc:#52a8ff}
.mstat::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:3px 0 0 3px;background:linear-gradient(180deg,var(--mc),transparent 130%);opacity:.8;transition:.24s}
.mstat::after{content:'';position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .3s;
  background:radial-gradient(180px 100px at 18% 0%,color-mix(in srgb,var(--mc) 14%,transparent),transparent 70%)}
.mstat:hover::after{opacity:1}
.mstat:hover::before{width:4px;box-shadow:0 0 12px -2px var(--mc)}
.mstat:nth-child(1){animation-delay:.05s}.mstat:nth-child(2){animation-delay:.11s}.mstat:nth-child(3){animation-delay:.17s}
.mstat:nth-child(4){animation-delay:.23s}.mstat:nth-child(5){animation-delay:.29s}
.mstat:hover{transform:translateY(-3px);border-color:var(--border2);box-shadow:0 10px 26px rgba(0,0,0,.45),0 0 18px -10px var(--mc)}
.mstat .ms-top{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.08em}
.mstat .ms-ico{width:26px;height:26px;border-radius:7px;display:grid;place-items:center;flex-shrink:0;transition:.28s cubic-bezier(.34,1.56,.64,1)}
.mstat:hover .ms-ico{transform:scale(1.15) rotate(-6deg);box-shadow:0 0 12px -3px var(--mc)}
.mstat .ms-ico svg{width:13px;height:13px}
.mstat .ms-val{font-family:'Geist Mono',monospace;font-size:21px;font-weight:600;margin-top:9px;letter-spacing:-.02em;font-variant-numeric:tabular-nums;transition:text-shadow .3s}
.mstat:hover .ms-val{text-shadow:0 0 16px color-mix(in srgb,var(--mc) 50%,transparent)}
.mstat .ms-sub{font-size:11.5px;color:var(--muted2);margin-top:3px}
.mstat .ms-bar{height:4px;border-radius:3px;background:var(--card2);margin-top:10px;overflow:hidden;position:relative}
.mstat .ms-fill{height:100%;border-radius:3px;width:0;transition:width 1.1s cubic-bezier(.2,.7,.3,1) .35s;position:relative;overflow:hidden}
.mstat .ms-fill::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent);transform:translateX(-100%);animation:msSheen 2.6s ease-in-out 1.6s infinite}
@keyframes msSheen{0%{transform:translateX(-100%)}55%,100%{transform:translateX(100%)}}

/* ── Visão Geral: títulos de seção neon ── */
#view-overview .section-title span:first-child{position:relative;padding-left:16px}
#view-overview .section-title span:first-child::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:8px;height:8px;border-radius:2px;
  background:linear-gradient(135deg,#ff2d6f,#52a8ff);box-shadow:0 0 10px rgba(255,45,111,.65);animation:stPulse 2.4s ease-in-out infinite}
@keyframes stPulse{0%,100%{box-shadow:0 0 6px rgba(255,45,111,.45)}50%{box-shadow:0 0 14px rgba(82,168,255,.8)}}
#view-overview .section-title .line{background:linear-gradient(90deg,var(--border2),var(--border) 40%,transparent)}

/* ── Visão Geral: meta de receita com brilho ── */
#view-overview .goal-card{position:relative;overflow:hidden;border-radius:14px}
#view-overview .goal-card::before{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(340px 150px at 8% 50%,rgba(62,207,142,.09),transparent 65%),radial-gradient(280px 130px at 92% 20%,rgba(82,168,255,.07),transparent 65%)}
#view-overview .goal-ring svg{filter:drop-shadow(0 0 10px rgba(62,207,142,.35))}
#view-overview .goal-ring .gr-pct{text-shadow:0 0 16px rgba(62,207,142,.4)}

/* ── Visão Geral: card de tendência ── */
#view-overview .chart-wrap+ .chart-legend .leg-dot{box-shadow:0 0 8px currentColor}
#view-overview .card:has(.chart-wrap){position:relative;border-radius:14px;overflow:hidden}
#view-overview .card:has(.chart-wrap)::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,#52a8ff,#25f4ee 45%,#ff2d6f);opacity:.55;box-shadow:0 0 10px -2px #52a8ff}
#view-overview .chart-legend .leg-dot{box-shadow:0 0 7px currentColor}
#view-overview .card:has(.chart-wrap){animation:kpiIn .55s cubic-bezier(.2,.7,.3,1) .28s backwards}
#view-overview .goal-card{animation:kpiIn .55s cubic-bezier(.2,.7,.3,1) .2s backwards}

/* Entrada em cascata — só ao trocar de aba (classe .entering) */
@keyframes rise{from{opacity:0;transform:translateY(16px) scale(.985)}to{opacity:1;transform:none}}
.view.entering .grid>*,
.view.entering>.card,
.view.entering .funnel,
.view.entering .tbl-wrap,
.view.entering .verdict,
.view.entering .alert,
.view.entering #ab-chart-card,
.view.entering .geo-grid>*{animation:rise .52s cubic-bezier(.2,.8,.2,1) both}
.view.entering .grid>*:nth-child(2){animation-delay:.05s}
.view.entering .grid>*:nth-child(3){animation-delay:.1s}
.view.entering .grid>*:nth-child(4){animation-delay:.15s}
.view.entering .grid>*:nth-child(5){animation-delay:.2s}
.view.entering .grid>*:nth-child(6){animation-delay:.25s}
.view.entering .grid>*:nth-child(n+7){animation-delay:.3s}

/* Nav — indicador ativo discreto */
.nav button{position:relative;transition:background .15s,color .15s}
.nav button::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%) scaleY(0);width:2px;height:16px;border-radius:2px;background:var(--cyan);transition:transform .2s cubic-bezier(.2,.8,.2,1)}
.nav button.active::before{transform:translateY(-50%) scaleY(1)}
.nav button svg{transition:color .2s}
.nav button:active{transform:scale(.99)}

/* Ponto ao vivo — anel pulsante */
.dot{position:relative}
.dot::after{content:'';position:absolute;inset:-4px;border-radius:50%;border:1px solid var(--green);opacity:.6;animation:ping 1.9s cubic-bezier(0,0,.2,1) infinite}
.dot.off::after{border-color:var(--red)}
@keyframes ping{0%{transform:scale(.7);opacity:.7}80%,100%{transform:scale(2);opacity:0}}

/* Badge de alerta — pulso */
.nav .badge{animation:badgePulse 1.6s ease-in-out infinite}
@keyframes badgePulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(255,86,116,.55)}50%{transform:scale(1.14);box-shadow:0 0 0 6px rgba(255,86,116,0)}}

/* Botões — clique tátil + brilho */
.btn{transition:background .15s,transform .1s,box-shadow .18s,filter .15s}
.btn:active,.btn-icon:active,.segment button:active{transform:scale(.95)}
.btn.primary:hover{box-shadow:0 10px 26px -10px rgba(82,168,255,.6)}
.btn-icon{transition:color .15s,border-color .15s,background .15s,transform .1s}
#refresh-btn.spinning svg{animation:spin .8s linear infinite}

/* Segmento de período — hover discreto */
.segment button{transition:background .18s,color .18s}
.segment button:not(.active):hover{color:var(--text)}

/* Switch — brilho ao ligar */
input:checked+.slider{box-shadow:0 0 0 1px rgba(82,168,255,.4),0 0 12px -2px rgba(82,168,255,.5)}
.slider:before{box-shadow:0 1px 3px rgba(0,0,0,.4)}

/* Linhas de tabela — acento lateral no hover */
tbody tr{position:relative;transition:background .12s,box-shadow .12s}
tbody tr:hover{box-shadow:inset 3px 0 0 var(--cyan)}

.fbar{position:relative;overflow:hidden}

/* Listas de país / health — micro-hover */
.crow{position:relative;transition:background .12s}
.crow .cbar i{transition:width .7s cubic-bezier(.2,.8,.2,1)}
.hitem{transition:border-color .2s}
.hitem:hover{border-color:var(--border2)}

/* Feed de atividade — realce no hover */
.ev{transition:background .14s;border-radius:8px;padding-left:8px;padding-right:8px}
.ev:hover{background:var(--card2)}

/* Drawer — botão fechar gira */
.x{transition:background .15s,color .15s,transform .2s}
.x:hover{background:var(--hover);color:var(--text);transform:rotate(90deg)}

/* Barra de confiança A/B — brilho */
.conf-bar i{box-shadow:0 0 10px -2px currentColor}

/* Texto de carregamento — pulsa */
.load-text{animation:loadPulse 1.6s ease-in-out infinite}
@keyframes loadPulse{0%,100%{opacity:.5}50%{opacity:1}}

/* ═══════════════ REFINO v4 · CORES · COMPONENTES NOVOS ═══════════════ */
:root{
  --blue:#52a8ff; --violet:#7ab8ff; --teal:#52a8ff;
  --grad-cool:#52a8ff;
  --grad-warm:#f5b544;
  --grad-mint:#3ecf8e;
}
.card.tint-blue{background:var(--card)}
.k-ico.ic-blue{background:rgba(82,168,255,.14);color:var(--blue)}
.blu{color:var(--blue)}

.kpi{position:relative;overflow:hidden}

/* Delta chip (comparação de período) */
.k-delta{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;margin-top:9px;letter-spacing:.01em}
.k-delta svg{width:11px;height:11px}
.k-delta.up{color:var(--green);background:rgba(62,207,142,.13)}
.k-delta.down{color:var(--red);background:rgba(255,86,116,.13)}
.k-delta.flat{color:var(--muted2);background:var(--card2)}
.k-delta.up.inv{color:var(--red);background:rgba(255,86,116,.13)}
.k-delta.down.inv{color:var(--green);background:rgba(62,207,142,.13)}

/* Sparkline dentro do KPI */
.k-spark{margin-top:12px;height:36px;width:100%;pointer-events:none}
.k-spark svg{display:block;width:100%;height:100%;overflow:visible}
.k-spark path.area{opacity:.16}
.k-spark path.line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round;stroke-dasharray:var(--dash);stroke-dashoffset:var(--dash);animation:drawLine 1.1s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes drawLine{to{stroke-dashoffset:0}}

/* Anel de meta de receita */
.goal-card{display:flex;align-items:center;gap:18px}
.goal-ring{position:relative;width:104px;height:104px;flex-shrink:0}
.goal-ring svg{transform:rotate(-90deg)}
.goal-ring .gr-c{transition:stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)}
.goal-ring .gr-txt{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.goal-ring .gr-pct{font-family:'Geist Mono';font-weight:700;font-size:22px;line-height:1}
.goal-ring .gr-lbl{font-size:9.5px;color:var(--muted2);margin-top:2px;text-transform:uppercase;letter-spacing:.08em}
.goal-meta b{font-family:'Geist Mono';font-size:19px}
.goal-meta .gm-sub{font-size:12px;color:var(--muted2);margin-top:4px}

/* Heatmap de vendas por hora × dia */
.heat{display:grid;grid-template-columns:34px repeat(24,1fr);gap:3px;font-size:0}
.heat .hh{grid-column:1;font-size:11px;color:var(--muted2);display:flex;align-items:center;height:16px}
.heat .hc{height:16px;border-radius:3px;background:var(--card2);transition:transform .12s,box-shadow .12s;cursor:default}
.heat .hc:hover{transform:scale(1.35);box-shadow:0 0 0 1px var(--border2);z-index:2;position:relative}
.heat-x{display:grid;grid-template-columns:34px repeat(24,1fr);gap:3px;margin-top:6px;font-size:9.5px;color:var(--muted2)}
.heat-x span{text-align:center}
.heat-x .hx-pad{grid-column:1}
.heat-legend{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted2);margin-top:14px}
.heat-legend .hl-scale{display:flex;gap:3px}
.heat-legend .hl-scale i{width:14px;height:14px;border-radius:3px;display:block}

/* Barra de progresso de metas nos gateways / funil */
.mini-track{height:6px;border-radius:6px;background:var(--card2);overflow:hidden;margin-top:8px}
.mini-track i{display:block;height:100%;border-radius:6px;transition:width .8s cubic-bezier(.2,.8,.2,1)}

/* Chips de estatística rápida (novos elementos por menu) */
.chips{display:flex;gap:10px;flex-wrap:wrap;margin:2px 0 4px}
.chip{display:inline-flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--border);border-radius:20px;padding:7px 14px;font-size:12.5px;font-weight:600;color:var(--muted);transition:transform .15s,border-color .15s,color .15s}
.chip:hover{transform:translateY(-2px);border-color:var(--border2);color:var(--text)}
.chip .cdot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.chip b{color:var(--text);font-family:'Geist Mono'}

/* Paleta de comandos ⌘K */
.cmdk-bg{position:fixed;inset:0;background:rgba(5,5,10,.6);backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:.18s;z-index:80;display:flex;align-items:flex-start;justify-content:center;padding-top:12vh}
.cmdk-bg.open{opacity:1;pointer-events:auto}
.cmdk{width:min(560px,94vw);background:var(--panel);border:1px solid var(--border2);border-radius:16px;box-shadow:0 30px 80px -20px rgba(0,0,0,.8);overflow:hidden;transform:translateY(-10px) scale(.98);transition:.2s cubic-bezier(.2,.8,.2,1)}
.cmdk-bg.open .cmdk{transform:none}
.cmdk-top{display:flex;align-items:center;gap:11px;padding:15px 18px;border-bottom:1px solid var(--border)}
.cmdk-top svg{width:18px;height:18px;color:var(--muted2);flex-shrink:0}
.cmdk-top input{flex:1;background:transparent;border:0;outline:0;color:var(--text);font-family:inherit;font-size:15px}
.cmdk-top kbd{font-size:10px;color:var(--muted2);border:1px solid var(--border);border-radius:6px;padding:2px 6px;font-family:inherit}
.cmdk-list{max-height:52vh;overflow-y:auto;padding:8px}
.cmdk-grp{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted2);padding:12px 12px 5px;font-weight:700}
.cmdk-item{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:10px;cursor:pointer;color:var(--muted);font-size:14px;font-weight:500}
.cmdk-item svg{width:17px;height:17px;flex-shrink:0}
.cmdk-item .ci-hint{margin-left:auto;font-size:11px;color:var(--muted2)}
.cmdk-item.sel,.cmdk-item:hover{background:var(--hover);color:var(--text)}
.cmdk-item.sel svg,.cmdk-item:hover svg{color:var(--cyan)}
.cmdk-empty{padding:30px;text-align:center;color:var(--muted2);font-size:13px}
.kbd-hint{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--muted2)}
.kbd-hint kbd{border:1px solid var(--border);border-radius:5px;padding:1px 6px;font-family:inherit;font-size:10px}

/* Botão de exportar */
.btn-export{display:inline-flex;align-items:center;gap:6px}
.btn-export svg{width:14px;height:14px}

/* Valor KPI com brilho ao mudar */
.k-val.flash{animation:valFlash .9s ease}
@keyframes valFlash{0%{color:var(--cyan);text-shadow:0 0 16px rgba(82,168,255,.6)}100%{}}

/* Título de seção com ponto animado */
.section-title>span:first-child{position:relative;padding-left:2px}

/* Acessibilidade — respeita preferência por menos movimento */
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}
}
</style>
</head>
<body>

<!-- Estrelas neon subindo no fundo da página inteira -->
<div class="bg-particles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>

<!-- Popup do globo expandido -->
<div class="globe-modal" id="globe-modal" hidden>
  <div class="gm-scrim" id="gm-scrim"></div>
  <div class="gm-panel" role="dialog" aria-label="Globo expandido">
    <button class="gm-close" id="gm-close" title="Fechar" aria-label="Fechar globo expandido"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
    <div class="gm-body" id="gm-body"></div>
  </div>
</div>

<!-- Tela de carregamento -->
<div id="loading-screen">
  <div class="spin"></div>
  <div class="load-text">Carregando ROI-NADOS...</div>
</div>

<div class="app">
  <!-- ── Header hero: logo + marca ROI-NADOS + dock de navegação ── -->
  <header class="hero-head" id="sidebar">
    <div class="hh-glow"></div>
    <div class="hh-inner">
      <div class="brand-xl">
        <div class="logo-orbit">
          <div class="logo-ring"></div>
          <img src="/assets/roi-nados-logo.jpg" alt="Logo ROI-NADOS" />
        </div>
        <div class="brand-txt">
          <div class="bt-name">ROI<span class="bt-dash">-</span>NADOS</div>
        </div>
      </div>
      <div class="hh-status">
        <div class="hh-live"><span class="dot" id="live-dot"></span>Ao vivo &middot; <span id="foot-updated">—</span></div>
      </div>
    </div>
    <nav class="nav dock" id="nav">
      <button data-view="overview" class="active"><span class="d-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/></svg></span><span class="d-lbl">Visão Geral</span></button>
      <button data-view="live"><span class="d-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 010 8.49M7.76 16.24a6 6 0 010-8.49M19.07 4.93a10 10 0 010 14.14M4.93 19.07a10 10 0 010-14.14"/></svg></span><span class="d-lbl">Ao Vivo</span><span class="badge live-badge" id="nav-live-badge" style="display:none">0</span></button>
      <button data-view="ab"><span class="d-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3"/></svg></span><span class="d-lbl">Teste A/B</span><span class="badge" id="nav-cooud-badge" style="display:none">!</span></button>
      <button data-view="pixels"><span class="d-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span><span class="d-lbl">Pixel TikTok</span><span class="badge" id="nav-px-badge" style="display:none">0</span></button>
      <button data-view="config"><span class="d-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06.06a1.65 1.65 0 00.33-1.82V8a1.65 1.65 0 001.51-1H22a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></span><span class="d-lbl">Configurações</span></button>
    </nav>
  </header>
  <div class="drawer-bg" id="side-scrim" style="display:none"></div>
  <div style="display:none" id="menuToggle"></div>

  <div class="main">
    <div class="topbar">
      <div>
        <h2 id="page-title">Visão Geral</h2>
        <div class="sub" id="page-sub">Resumo dos números que mais importam</div>
      </div>
      <div class="spacer"></div>
      <div class="tb-right">
        <button class="btn" id="cmdk-open" title="Buscar (Ctrl K)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></button>
        <button class="btn" id="refresh-btn" title="Atualizar agora"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg></button>
        <div class="segment" id="period">
          <button data-p="today">Hoje</button>
          <button data-p="7d" class="active">7 dias</button>
          <button data-p="30d">30 dias</button>
          <button data-p="all">Tudo</button>
          <button data-p="custom" id="period-custom" title="Segmentar por dias e horas"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><span id="period-custom-lbl"></span></button>
        </div>
        <!-- popover de segmentação por dias e horas -->
        <div class="dr-pop" id="dr-pop" hidden>
          <div class="dr-head">Segmentar per&iacute;odo</div>
          <div class="dr-row">
            <div class="dr-field"><label>De</label><input type="date" id="dr-from" class="inp dr-inp" /></div>
            <div class="dr-field"><label>At&eacute;</label><input type="date" id="dr-to" class="inp dr-inp" /></div>
          </div>
          <div class="dr-hours" id="dr-hours">
            <div class="dr-hours-head"><label>Faixa de hor&aacute;rio</label><span class="dr-hlbl" id="dr-hlbl">00:00 &ndash; 23:59</span></div>
            <div class="dr-sliders">
              <input type="range" id="dr-h-from" min="0" max="23" step="1" value="0" />
              <input type="range" id="dr-h-to" min="0" max="23" step="1" value="23" />
            </div>
            <p class="dr-hint" id="dr-hours-hint">dispon&iacute;vel quando De e At&eacute; s&atilde;o o mesmo dia</p>
          </div>
          <div class="dr-actions">
            <button class="btn btn-sm" id="dr-clear">Limpar</button>
            <button class="btn btn-sm primary" id="dr-apply">Aplicar</button>
          </div>
        </div>
      </div>
    </div>

    <div class="content">

      <!-- ── Ao Vivo ── -->
      <section class="view" id="view-live">
        <div class="grid kpis" id="live-kpis"></div>
        <div class="live-grid">
          <div class="card" style="padding:0">
            <div class="notif-head">
              <div class="nh-title"><span class="live-dot-anim"></span>Notifica&ccedil;&otilde;es</div>
              <div class="notif-tools">
                <button class="icon-btn on" id="notif-sound" title="Ativar/desativar som"></button>
                <button class="icon-btn" id="notif-clear" title="Limpar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg></button>
              </div>
            </div>
            <div class="notif-list" id="notif-list"></div>
          </div>
          <div class="card live-list-card"><div class="live-list" id="live-list"></div></div>
        </div>
      </section>

      <!-- ── Visão Geral ── -->
      <section class="view active" id="view-overview">
        <div class="ov-hero" id="ov-hero">
          <div class="ovh-border"></div>
          <div class="ovh-shine"></div>
          <div class="ovh-particles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <div class="ovh-left">
            <div class="ovh-greet" id="ov-greet">Bem-vindo de volta</div>
            <div class="ovh-title">Central de resultados <span class="ovh-brand">ROI-NADOS</span></div>
            <div class="ovh-sub" id="ov-hero-sub">acompanhando cada lead em tempo real</div>
          </div>
        </div>
        <div class="grid kpis kpis-xl" id="ov-kpis"></div>
        <div class="ministats" id="ov-chips"></div>
        <div class="section-title"><span>Atividade global ao vivo</span><span class="line"></span><span class="muted" style="font-size:11.5px" id="ov-globe-sub">pessoas online agora no mapa</span></div>
        <div class="globe-wrap">
          <div class="card globe-card" style="padding:0" id="globe-card">
            <div id="live-globe"></div>
            <div class="globe-tools">
              <button class="gt-btn" id="globe-zoom-in" title="Aproximar" aria-label="Aproximar zoom"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg></button>
              <button class="gt-btn" id="globe-zoom-out" title="Afastar" aria-label="Afastar zoom"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg></button>
              <div class="gt-div"></div>
              <button class="gt-btn" id="globe-fs" title="Expandir" aria-label="Expandir globo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="globe-fs-ico"><path d="M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M8 21H5a2 2 0 01-2-2v-3M16 21h3a2 2 0 002-2v-3"/></svg></button>
            </div>
            <div class="globe-hint">arraste para girar &middot; role para dar zoom</div>
          </div>
          <aside class="globe-side">
            <div class="gs-stats">
              <div class="gs-stat"><span class="gs-dot grn-d"></span><div class="gs-txt"><b id="gs-online">0</b><span>online agora</span></div></div>
              <div class="gs-stat"><span class="gs-dot pnk-d"></span><div class="gs-txt"><b id="gs-ck">0</b><span>no checkout</span></div></div>
            </div>
            <div class="card gs-leads">
              <div class="gs-head"><span class="live-dot-anim"></span>Leads rastreados<button class="gs-all" id="gs-all">Ver todos</button></div>
              <div class="gs-list" id="ov-live-list"><div class="live-empty" style="padding:20px">Aguardando visitantes...</div></div>
            </div>
          </aside>
        </div>
        <div class="card traffic-card" id="traffic-pulse"></div>
        <div class="section-title"><span>Meta de receita</span><span class="line"></span><span class="muted" style="font-size:11.5px">sugerida automaticamente</span></div>
        <div class="card goal-card" id="ov-goal"></div>
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
      </section>

      <!-- ── Funil & Leads ── -->
      <section class="view" id="view-funnel">
        <div class="block-head"><span class="bh-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h18l-7 8v7l-4 2v-9z"/></svg></span><div><h2>Funil &amp; Leads</h2><p>Cada visitante rastreado até o checkout</p></div></div>
        <div class="section-title" style="margin-top:0"><span>Funil de conversão</span><span class="line"></span><span class="muted" style="font-size:11.5px">visita &#8594; checkout &#8594; compra</span></div>
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
          <button class="btn btn-sm btn-export" id="export-leads"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>CSV</button>
          <span class="tbl-count" id="leads-count"></span>
        </div>
        <div class="tbl-wrap"><table id="leads-table">
          <thead><tr><th>Lead</th><th>Etapa</th><th>Checkout</th><th>País</th><th>Origem</th><th>Valor</th><th>Quando</th></tr></thead>
          <tbody id="leads-body"></tbody>
        </table></div>
      </section>

      <!-- ── Países ── -->
      <section class="view" id="view-geo">
        <div class="block-head"><span class="bh-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20 15 15 0 010-20z"/></svg></span><div><h2>Países</h2><p>De onde vêm seus leads</p></div></div>
        <div class="grid kpis" id="geo-kpis"></div>
        <div class="section-title"><span>Ranking por país</span><span class="line"></span><span class="muted" style="font-size:11.5px">leads e compras &middot; o globo 3D fica na Vis&atilde;o Geral</span></div>
        <div class="card"><div class="clist" id="country-list"></div></div>
      </section>

      <!-- ── Teste A/B ── -->
      <section class="view" id="view-ab">
        <div id="ab-alert"></div>
        <div class="ab-bar" id="ab-control">
          <label class="switch" title="Ligar/desligar o teste A/B"><input type="checkbox" id="ab-mode" /><span class="slider"></span></label>
          <span id="ab-mode-label" class="ab-status">&mdash;</span>
          <div id="ab-split-wrap" class="ab-split-wrap">
            <span class="cyn abm" id="ab-split-s">Stripe 50%</span>
            <input type="range" id="ab-split" min="0" max="100" step="5" value="50" />
            <span class="pnk abm" style="text-align:right" id="ab-split-c">Cooud 50%</span>
          </div>
          <button class="btn btn-sm primary" id="ab-save" style="display:none">Salvar</button>
          <div class="ab-links">
            <a href="/checkout?ab=stripe" target="_blank" rel="noopener" title="Abrir checkout for&ccedil;ando Stripe">Stripe &nearr;</a>
            <a href="/checkout?ab=cooud" target="_blank" rel="noopener" id="ab-test-cooud" title="Abrir checkout for&ccedil;ando o gateway externo">Cooud &nearr;</a>
          </div>
        </div>
        <div class="ab-grid">
          <div class="verdict" id="ab-verdict"></div>
          <div class="card" id="ab-metrics"></div>
        </div>
      </section>

      <!-- ── Anti-desvio (Cooud) ── -->
      <section class="view" id="view-cooud">
        <div class="block-head"><span class="bh-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/></svg></span><div><h2>Anti-desvio</h2><p>Vigilância do gateway externo (Cooud)</p></div></div>
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
        <div class="block-head"><span class="bh-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></span><div><h2>Atividade</h2><p>Tudo o que acontece em tempo real</p></div></div>
        <div class="section-title" style="margin-top:0"><span>Quando as vendas acontecem</span><span class="line"></span><span class="muted" style="font-size:11.5px">hora &times; dia da semana</span></div>
        <div class="card" id="act-heat"></div>
        <div class="section-title"><span>Linha do tempo</span><span class="line"></span></div>
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
          <button class="btn btn-sm btn-export" id="export-events"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>CSV</button>
          <span class="tbl-count" id="ev-count"></span>
        </div>
        <div class="card"><div class="feed" id="feed"></div></div>
      </section>

      <!-- ── Pixel TikTok ── -->
      <section class="view" id="view-pixels">
        <div class="alert info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><div><b>Rastreamento avançado por lead (Events API)</b><p>Cada pixel vive num arquivo próprio em <code>pixels/</code> e funciona sem a dashboard. Todo lead ganha um ID único (hash SHA-256) enviado como external_id em ViewContent, InitiateCheckout e CompletePayment — com IP, user-agent, ttclid, _ttp e e-mail hasheado para o melhor matching no gerenciador de anúncios.</p></div></div>
        <div class="grid" style="grid-template-columns:1.2fr 1fr">
          <div class="card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
              <h3 style="font-size:16px">Pixels configurados</h3>
              <button class="btn btn-sm primary" id="px-new">+ Adicionar pixel</button>
            </div>
            <div id="px-list"></div>
          </div>
          <div class="card" id="px-form-card" style="display:none">
            <h3 style="font-size:16px;margin-bottom:4px" id="px-form-title">Novo pixel</h3>
            <p class="hint" style="margin-bottom:14px">Salvo como arquivo próprio em <code>pixels/&lt;nome&gt;.json</code> + espelho no banco.</p>
            <div class="form-row">
              <label>Nome <span class="hint">— vira o nome do arquivo</span></label>
              <input class="inp" id="px-name" placeholder="Campanha Espanha" style="width:100%">
            </div>
            <div class="form-row">
              <label>Pixel Code <span class="hint">— do TikTok Events Manager</span></label>
              <input class="inp" id="px-code" placeholder="C0ABC1DE2FGH3IJKLM" style="width:100%;font-family:'Geist Mono',monospace">
            </div>
            <div class="form-row">
              <label>Access Token <span class="hint">— Events API, opcional p/ só-navegador</span></label>
              <input class="inp" id="px-token" placeholder="token da Events API" style="width:100%;font-family:'Geist Mono',monospace" autocomplete="off">
            </div>
            <div class="form-row">
              <label>Rotas <span class="hint">— uma por linha; vazio = todas as páginas</span></label>
              <textarea class="inp" id="px-routes" rows="3" placeholder="/&#10;/checkout&#10;/s1" style="width:100%;resize:vertical;font-family:'Geist Mono',monospace;font-size:12.5px"></textarea>
            </div>
            <div class="form-row">
              <label>Eventos server-side</label>
              <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px">
                <label style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" id="px-ev-vc" checked> ViewContent</label>
                <label style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" id="px-ev-ic" checked> InitiateCheckout</label>
                <label style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" id="px-ev-cp" checked> CompletePayment</label>
              </div>
            </div>
            <div class="form-row">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="px-active" checked> Pixel ativo</label>
            </div>
            <div style="display:flex;gap:10px;margin-top:6px">
              <button class="btn primary" id="px-save">Salvar pixel</button>
              <button class="btn" id="px-cancel">Cancelar</button>
            </div>
            <input type="hidden" id="px-slug" value="">
          </div>
        </div>
        <div class="section-title"><span>Disparos server-side recentes</span><span class="line"></span><button class="btn-icon" id="px-log-refresh">Atualizar</button></div>
        <div class="card" style="padding:0">
          <div class="tbl-wrap" style="border:0">
            <table>
              <thead><tr><th>Quando</th><th>Pixel</th><th>Evento</th><th>Lead</th><th>Status</th><th>Resposta</th></tr></thead>
              <tbody id="px-log"></tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ── Configurações ── -->
      <section class="view" id="view-config">
        <div class="grid cfg-grid" style="grid-template-columns:1fr 1fr">
          <div class="card cfg-card" style="--cc:var(--cyan)">
            <div class="cfg-head">
              <span class="cfg-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M8 3H3v5M3 16v5h5M21 16v5h-5M21 3l-7 7M3 3l7 7M3 21l7-7M21 21l-7-7"/></svg></span>
              <div><h3>Roteamento &amp; Teste A/B</h3><p>Divide o tr&aacute;fego entre Stripe e o gateway externo</p></div>
            </div>
            <div class="form-row">
              <label>Modo de operação</label>
              <select class="select" id="cfg-mode">
                <option value="ab">Teste A/B (dividir tráfego)</option>
                <option value="stripe_only">Apenas Stripe (100% nativo)</option>
              </select>
            </div>
            <div class="form-row" id="cfg-split-wrap">
              <label>Divisão do tráfego <span class="hint">— % para o Stripe</span></label>
              <div class="range-wrap">
                <input type="range" id="cfg-pct" min="0" max="100" step="5" value="50" />
                <span id="cfg-pct-val" style="font-family:'Geist Mono';font-weight:700;width:46px;text-align:right">50%</span>
              </div>
              <div class="split-preview" style="margin-top:10px">
                <div class="sp-stripe" id="sp-stripe" style="width:50%">Stripe 50%</div>
                <div class="sp-cooud" id="sp-cooud">Cooud 50%</div>
              </div>
            </div>
            <button class="btn primary" id="cfg-save" style="margin-top:6px;width:100%">Salvar configuração</button>
          </div>
          <div class="card cfg-card" style="--cc:var(--pink)">
            <div class="cfg-head">
              <span class="cfg-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg></span>
              <div><h3>Link externo (Cooud)</h3><p>Para onde o lead vai quando cai no gateway externo</p></div>
            </div>
            <div class="form-row">
              <label>Nome do gateway externo</label>
              <input class="inp" id="cfg-name" placeholder="Cooud" />
            </div>
            <div class="form-row">
              <label>URL do checkout externo</label>
              <input class="inp" id="cfg-url" placeholder="https://checkout.cooud.com/..." />
            </div>
            <p class="cfg-note">O ID do visitante &eacute; anexado automaticamente para conciliar vendas e detectar desvios.</p>
          </div>
          <div class="card cfg-card" style="--cc:var(--amber)">
            <div class="cfg-head">
              <span class="cfg-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/></svg></span>
              <div><h3>Rota&ccedil;&atilde;o da tt_url</h3><p>Oculta a URL real do TikTok na Stripe &mdash; cada venda mostra uma isca da lista; a real s&oacute; vai ao CAPI</p></div>
              <label class="switch" style="margin-left:auto" title="Ativar/desativar rotação"><input type="checkbox" id="cfg-rot" /><span class="slider"></span></label>
            </div>
            <div class="form-row" id="cfg-rot-wrap" style="margin-bottom:0">
              <label>URLs de rotação <span class="hint">— uma por linha</span></label>
              <textarea class="inp" id="cfg-rot-urls" rows="5" placeholder="https://tiktok.com/" style="resize:vertical;font-family:monospace;font-size:12.5px;line-height:1.6"></textarea>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;flex-wrap:wrap">
                <span class="hint" id="cfg-rot-count">—</span>
                <button class="btn btn-sm primary" id="cfg-rot-save">Salvar URLs</button>
              </div>
            </div>
          </div>
          <div class="card cfg-card" style="--cc:var(--green)">
            <div class="cfg-head">
              <span class="cfg-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></span>
              <div><h3>Sa&uacute;de do sistema</h3><p>Integra&ccedil;&otilde;es e vari&aacute;veis configuradas neste servidor</p></div>
            </div>
            <div class="health-grid" id="health-grid"><div class="muted" style="font-size:13px;padding:8px 0">Carregando...</div></div>
          </div>
        </div>
        <div class="card danger-card">
          <span class="cfg-ico" style="--cc:var(--red)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6"/></svg></span>
          <div style="flex:1;min-width:200px"><b style="font-size:13.5px">Zerar todas as estatísticas</b><p style="color:var(--muted2);margin:3px 0 0;font-size:12px">Apaga leads, eventos e contadores. Não afeta configurações ou chaves.</p></div>
          <button class="btn danger" id="reset-btn">Zerar estatísticas</button>
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

<!-- Paleta de comandos ⌘K -->
<div class="cmdk-bg" id="cmdk-bg">
  <div class="cmdk" role="dialog" aria-label="Paleta de comandos">
    <div class="cmdk-top">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <input id="cmdk-input" placeholder="Buscar telas, períodos e ações..." autocomplete="off" />
      <kbd>ESC</kbd>
    </div>
    <div class="cmdk-list" id="cmdk-list"></div>
  </div>
</div>

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

var DATA=null, CFG=null, HEALTH=null, period='7d', chartMode='revenue', evFilter='', autoTimer=null, currentView='overview', currentLeadId=null;
var leadsById={};
var LIVE={visitors:[],summary:{online:0,countries:[]}}, liveTimer=null, liveGlobe=null;

// Range personalizado: {from,to} em ms, definido pelo popover de segmentação
var CUSTOM={from:0,to:0};
// Fonte única de verdade do período atual — TODAS as métricas derivam daqui.
function periodRange(){
  var n=Date.now();
  if(period==='custom'&&CUSTOM.from) return {from:CUSTOM.from,to:CUSTOM.to||n};
  if(period==='today'){var d=new Date();d.setHours(0,0,0,0);return {from:d.getTime(),to:n};}
  if(period==='7d') return {from:n-7*864e5,to:n};
  if(period==='30d') return {from:n-30*864e5,to:n};
  return {from:0,to:n};
}
function cutoff(){ return periodRange().from; }
function inPeriod(iso){
  if(!iso) return period==='all';
  var t=new Date(iso).getTime(), r=periodRange();
  return t>=r.from&&t<=r.to;
}

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

function kpi(ico,cls,label,val,sub,extra){
  return '<div class="card kpi '+(cls||'')+'"><div class="k-top"><span class="k-ico">'+ico+'</span>'+esc(label)+'</div><div class="k-val">'+val+'</div><div class="k-sub">'+(sub||'')+'</div>'+(extra||'')+'</div>';
}
function chip(color,label,val){ return '<div class="chip"><span class="cdot" style="background:'+color+'"></span>'+label+' <b>'+val+'</b></div>'; }
var ARR_UP='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
var ARR_DN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';

/* ── Comparação de período (deltas) ── */
function prevWindow(){
  var now=Date.now();
  if(period==='today'){ var d=new Date();d.setHours(0,0,0,0); var s=d.getTime(); return {curFrom:s,curTo:now,prevFrom:s-864e5,prevTo:s}; }
  if(period==='7d') return {curFrom:now-7*864e5,curTo:now,prevFrom:now-14*864e5,prevTo:now-7*864e5};
  if(period==='30d') return {curFrom:now-30*864e5,curTo:now,prevFrom:now-60*864e5,prevTo:now-30*864e5};
  if(period==='custom'&&CUSTOM.from){
    // janela anterior = mesma duração imediatamente antes do range
    var span=(CUSTOM.to||now)-CUSTOM.from;
    return {curFrom:CUSTOM.from,curTo:CUSTOM.to||now,prevFrom:CUSTOM.from-span,prevTo:CUSTOM.from};
  }
  return null;
}
function aggregate(from,to){
  var visits=0,reached=0,bought=0;
  (DATA.leads||[]).forEach(function(l){ if(l.orphan)return; var t=l.at?new Date(l.at).getTime():0; if(t>=from&&t<to){ visits++; if(l.stage==='checkout'||l.stage==='purchased')reached++; if(l.stage==='purchased')bought++; } });
  var rev=0,sales=0,failed=0;
  (DATA.events||[]).forEach(function(e){ var t=e.at?new Date(e.at).getTime():0; if(t>=from&&t<to){ if(e.type==='sale'){sales++;rev+=e.amount||0;} else if(e.type==='failed')failed++; } });
  var att=sales+failed;
  return {visits:visits,reached:reached,bought:bought,rev:rev,sales:sales,failed:failed,approval:att?(sales/att*100):0,overall:visits?(bought/visits*100):0};
}
function deltaChip(cur,prev,invert){
  if(period==='all') return '';
  if(prev<=0){ if(cur<=0) return ''; return '<span class="k-delta up'+(invert?' inv':'')+'">'+ARR_UP+'novo</span>'; }
  var pct=((cur-prev)/prev)*100;
  if(Math.abs(pct)<0.1) return '<span class="k-delta flat">estável</span>';
  var up=pct>0, r=Math.abs(pct)>=100?Math.round(pct):(+pct.toFixed(1));
  return '<span class="k-delta '+(up?'up':'down')+(invert?' inv':'')+'">'+(up?ARR_UP:ARR_DN)+(up?'+':'')+r+'%</span>';
}

/* ── Sparklines ── */
function seriesFor(kind){
  var w=prevWindow(); var to=w?w.curTo:Date.now(), from=w?w.curFrom:0;
  var n = period==='today'?12 : period==='7d'?7 : period==='30d'?30 : 14;
  if(period==='custom'&&CUSTOM.from){ var spanH=(to-from)/36e5; n=spanH<=48?Math.max(4,Math.min(24,Math.ceil(spanH))):Math.max(4,Math.min(30,Math.ceil(spanH/24))); }
  if(!w){ var times=(DATA.leads||[]).map(function(l){return l.at?new Date(l.at).getTime():0;}).filter(Boolean); from=times.length?Math.min.apply(null,times):to-14*864e5; }
  var span=(to-from)||n*864e5, step=span/n, arr=[]; for(var i=0;i<n;i++)arr.push(0);
  function put(t,v){ if(t<from||t>to)return; var idx=Math.min(n-1,Math.floor((t-from)/step)); arr[idx]+=v; }
  if(kind==='revenue'||kind==='sales'){ (DATA.events||[]).forEach(function(e){ if(e.type!=='sale')return; put(new Date(e.at).getTime(), kind==='revenue'?(e.amount||0):1); }); }
  else if(kind==='visits'){ (DATA.leads||[]).forEach(function(l){ if(l.orphan)return; put(new Date(l.at).getTime(),1); }); }
  else if(kind==='approval'){ var s=[],f=[]; for(var j=0;j<n;j++){s.push(0);f.push(0);} (DATA.events||[]).forEach(function(e){ var t=new Date(e.at).getTime(); if(t<from||t>to)return; var idx=Math.min(n-1,Math.floor((t-from)/step)); if(e.type==='sale')s[idx]++; else if(e.type==='failed')f[idx]++; }); for(var k=0;k<n;k++){ var a=s[k]+f[k]; arr[k]=a?(s[k]/a*100):0; } }
  return arr;
}
function spark(values,color){
  if(!values||values.length<2) return '';
  var w=100,h=34,max=Math.max.apply(null,values),min=Math.min.apply(null,values);
  if(max===min)max=min+1;
  var n=values.length, step=w/(n-1);
  var pts=values.map(function(v,i){ return [i*step, h-((v-min)/(max-min))*(h-4)-2]; });
  var line=pts.map(function(p,i){return (i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1);}).join(' ');
  var area=line+' L'+w+' '+h+' L0 '+h+' Z';
  var len=0; for(var i=1;i<pts.length;i++){var dx=pts[i][0]-pts[i-1][0],dy=pts[i][1]-pts[i-1][1];len+=Math.sqrt(dx*dx+dy*dy);}
  var gid='sg'+Math.random().toString(36).slice(2,7);
  return '<div class="k-spark"><svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'+
    '<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+color+'" stop-opacity=".5"/><stop offset="1" stop-color="'+color+'" stop-opacity="0"/></linearGradient></defs>'+
    '<path class="area" d="'+area+'" fill="url(#'+gid+')"/>'+
    '<path class="line" d="'+line+'" stroke="'+color+'" vector-effect="non-scaling-stroke" style="--dash:'+len.toFixed(0)+'"/>'+
    '</svg></div>';
}

/* ── Visão Geral ── */
// Contagem animada: anima do valor anterior até o novo (não pisca 0→N
// em cada atualização); se o valor não mudou, apenas fixa o texto.
var CU_LAST={};
function countUp(el,target,suffix,dur){
  if(!el||isNaN(target)) return;
  var key=el.id||'anon';
  var from=CU_LAST[key]!=null?CU_LAST[key]:0;
  CU_LAST[key]=target;
  if(from===target){ el.textContent=target+(suffix||''); return; }
  var start=null; dur=dur||900;
  function frame(ts){
    if(!start)start=ts;
    var p=Math.min(1,(ts-start)/dur);
    var eased=1-Math.pow(1-p,3);
    el.textContent=Math.round(from+(target-from)*eased)+(suffix||'');
    if(p<1)requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
// Saudação conforme hora do dia
function greeting(){
  var h=new Date().getHours();
  if(h<6)return 'Boa madrugada';
  if(h<12)return 'Bom dia';
  if(h<18)return 'Boa tarde';
  return 'Boa noite';
}
function mstat(icoColor,icoBg,ico,label,val,sub,barPct,barColor,valId){
  return '<div class="mstat" style="--mc:'+icoColor+'">'+
    '<div class="ms-top"><span class="ms-ico" style="background:'+icoBg+';color:'+icoColor+'">'+ico+'</span>'+esc(label)+'</div>'+
    '<div class="ms-val"'+(valId?' id="'+valId+'"':'')+' style="color:'+icoColor+'">'+val+'</div>'+
    '<div class="ms-sub">'+(sub||'')+'</div>'+
    (barPct!=null?'<div class="ms-bar"><div class="ms-fill" data-w="'+Math.min(100,Math.max(0,barPct))+'" style="background:'+(barColor||icoColor)+'"></div></div>':'')+
  '</div>';
}
function renderOverview(m){
  var w=prevWindow();
  var cur=w?aggregate(w.curFrom,w.curTo):null, prev=w?aggregate(w.prevFrom,w.prevTo):null;
  function dc(k,inv){ return (cur&&prev)?deltaChip(cur[k],prev[k],inv):''; }

  // hero: saudação + resumo (números detalhados ficam só nos KPIs abaixo)
  var greet=document.getElementById('ov-greet');
  if(greet)greet.textContent=greeting();
  var heroSub=document.getElementById('ov-hero-sub');
  if(heroSub)heroSub.textContent=m.visits+' leads rastreados no per\u00edodo \u00b7 '+m.countries.length+' pa\u00edses ativos';

  // cores semânticas: receita/aprovação = verde (dinheiro bom), leads = ciano, conversão = dinâmica
  document.getElementById('ov-kpis').innerHTML=
    kpi(I.money,'tint-green','Receita total','<span class="pos">'+revObj(m.rev)+'</span>','no período selecionado', dc('rev')+spark(seriesFor('revenue'),'#3ecf8e'))+
    kpi(I.check,'tint-green','Vendas aprovadas','<span class="pos" id="ov-cu-sales">0</span>','<span class="neg">'+m.failed+'</span> recusadas', dc('sales')+spark(seriesFor('sales'),'#3ecf8e'))+
    kpi(I.users,'tint-cyan','Novos leads','<span class="cyn" id="ov-cu-visits">0</span>','entraram no funil', dc('visits')+spark(seriesFor('visits'),'#52a8ff'))+
    kpi(I.pct,'tint-amber','Conversão','<span class="'+pctColor(m.overall)+'">'+m.overall+'%</span>','visita &#8594; compra &middot; detalhes no Funil', dc('overall'));

  // ministats: aprovação verde quando saudável (ou sem tentativas), alertas âmbar/vermelho só quando existem
  var hasAttempts=(m.sales+m.failed)>0;
  var apColor=!hasAttempts||m.approval>=70?'#3ecf8e':m.approval>=40?'#f5b544':'#ff5674';
  var apBg=!hasAttempts||m.approval>=70?'rgba(62,207,142,.12)':m.approval>=40?'rgba(245,181,68,.12)':'rgba(255,86,116,.12)';
  var refColor=m.refunds?'#f5b544':'#3ecf8e', dispColor=m.disputes?'#ff5674':'#3ecf8e';
  document.getElementById('ov-chips').innerHTML=
    mstat(apColor,apBg,I.check,'Aprovação',m.approval+'%',m.sales+' aprovadas de '+(m.sales+m.failed)+' tentativas',m.approval,apColor)+
    mstat('#3ecf8e','rgba(62,207,142,.12)',I.money,'Ticket médio',money(m.avgTicket,m.mainCur),'por venda aprovada',null)+
    mstat('#25f4ee','rgba(37,244,238,.1)',I.globe,'Países ativos',m.countries.length,(m.countries[0]?'l\u00edder: '+flag(m.countries[0].code)+' '+esc(m.countries[0].code):'aguardando leads'),null)+
    mstat(refColor,m.refunds?'rgba(245,181,68,.12)':'rgba(62,207,142,.1)',I.refund,'Reembolsos',m.refunds,m.refunds?'exige aten\u00e7\u00e3o':'nenhum no per\u00edodo',null)+
    mstat(dispColor,m.disputes?'rgba(255,86,116,.12)':'rgba(62,207,142,.1)',I.dispute,'Disputas',m.disputes,m.disputes?'responda o quanto antes':'nenhuma aberta',null);

  // dispara contagens e barras animadas
  countUp(document.getElementById('ov-cu-sales'),m.sales);
  countUp(document.getElementById('ov-cu-visits'),m.visits);
  requestAnimationFrame(function(){
    document.querySelectorAll('#ov-chips .ms-fill').forEach(function(f){ f.style.width=f.getAttribute('data-w')+'%'; });
  });

  renderGoal(m,prev);
  renderChart(m);
}

/* ── Anel de meta de receita (meta sugerida = 1,2× período anterior) ── */
function renderGoal(m,prev){
  var el=document.getElementById('ov-goal'); if(!el) return;
  var curRev=sumRev(m.rev);
  var base=(prev&&prev.rev>0)?prev.rev:curRev;
  if(!curRev&&!base){
    el.innerHTML='<div class="empty" style="width:100%;text-align:center;padding:18px 0">Assim que a primeira venda entrar, a meta &eacute; calculada automaticamente aqui.</div>';
    return;
  }
  var goal=Math.max(base*1.2,curRev,1);
  var pct=Math.min(100,Math.round(curRev/goal*100));
  var R=46,C=2*Math.PI*R,off=C*(1-pct/100);
  var color=pct>=100?'#3ecf8e':pct>=60?'#52a8ff':pct>=30?'#f5b544':'#ff5674';
  el.innerHTML=
    '<div class="goal-ring"><svg width="104" height="104" viewBox="0 0 104 104">'+
      '<circle cx="52" cy="52" r="46" fill="none" stroke="var(--card2)" stroke-width="9"/>'+
      '<circle class="gr-c" cx="52" cy="52" r="46" fill="none" stroke="'+color+'" stroke-width="9" stroke-linecap="round" stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'"/>'+
    '</svg><div class="gr-txt"><div class="gr-pct" style="color:'+color+'">'+pct+'%</div><div class="gr-lbl">da meta</div></div></div>'+
    '<div class="goal-meta"><div class="muted" style="font-size:12px">Receita no per&iacute;odo</div><b>'+money(curRev,m.mainCur)+'</b>'+
      '<div class="gm-sub">Meta sugerida: <b style="color:var(--text)">'+money(goal,m.mainCur)+'</b></div>'+
      '<div class="gm-sub">'+(pct>=100?'<span class="grn">Meta batida! &#127881;</span>':'Faltam <b style="color:var(--text)">'+money(Math.max(0,goal-curRev),m.mainCur)+'</b> para bater a meta')+'</div>'+
    '</div>';
}

/* ── Gráfico de tendência ── */
function renderChart(m){
  var el=document.getElementById('chart');
  if(!el) return;
  var events=(DATA.events||[]).filter(function(e){return e.type==='sale'&&inPeriod(e.at);});
  // buckets
  var n, isHour=false, buckets=[];
  if(period==='custom'&&CUSTOM.from){
    // segmentado: horas quando o range cabe em 48h, senão dias — sempre limitado a from..to
    var r=periodRange(), spanH=(r.to-r.from)/36e5;
    isHour=spanH<=48;
    n=isHour?Math.max(4,Math.min(24,Math.ceil(spanH))):Math.max(4,Math.min(31,Math.ceil(spanH/24)));
    var step=(r.to-r.from)/n;
    for(var ci=0;ci<n;ci++) buckets.push({t:r.from+ci*step,sc:0,cc:0});
  } else {
    if(period==='today'){n=12;isHour=true;}
    else if(period==='7d'){n=7;}
    else if(period==='30d'){n=30;}
    else{n=Math.min(30,Math.max(7,Math.ceil((Date.now()-new Date(DATA.updatedAt||Date.now()).getTime())/864e5)+2));}
    var now=new Date();
    for(var i=n-1;i>=0;i--){
      var d=new Date(now);
      if(isHour){ d.setMinutes(0,0,0); d.setHours(now.getHours()-i*2); }
      else { d.setHours(0,0,0,0); d.setDate(now.getDate()-i); }
      buckets.push({t:d.getTime(),sc:0,cc:0});
    }
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
    if(scH>0){ svg+='<rect x="'+x.toFixed(1)+'" y="'+(baseY-scH).toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+scH.toFixed(1)+'" rx="3" fill="#52a8ff" opacity=".9"/>'; }
    if(ccH>0){ svg+='<rect x="'+x.toFixed(1)+'" y="'+(baseY-scH-ccH).toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+ccH.toFixed(1)+'" rx="3" fill="#ff5674" opacity=".9"/>'; }
    var dt=new Date(b.t);
    var lbl=isHour?(dt.getHours()+'h'):(dt.getDate()+'/'+(dt.getMonth()+1));
    svg+='<text x="'+(x+w/2).toFixed(1)+'" y="'+(padT+chartH+16)+'" fill="#6c6c80" font-size="9.5" text-anchor="middle" font-family="Inter,sans-serif">'+lbl+'</text>';
  });
  svg+='</svg>';
  el.innerHTML=svg;
}

/* ── Funil ── */
function renderFunnel(m){
  var max=Math.max(m.visits,1);
  var steps=[
    {l:'Visitaram',s:'topo do funil',v:m.visits,c:'#52a8ff',r:'100%'},
    {l:'Chegaram ao checkout',s:'iniciaram pagamento',v:m.reached,c:'#7ab8ff',r:m.v2c+'%'},
    {l:'Compraram',s:'pagamento aprovado',v:m.bought,c:'#3ecf8e',r:m.overall+'%'}
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
    gwCard('Stripe','stripe',gw.stripe,'#52a8ff')+
    gwCard(esc(extName),'cooud',gw.cooud,'#ff5674');
  renderLeadsTable();
}
function gwCard(title,cls,d,color){
  var conv=d.checkout?((d.purchased/d.checkout)*100).toFixed(1):0;
  return '<div class="card">'+
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><span class="tag '+cls+'">'+title+'</span><span class="muted" style="margin-left:auto;font-size:12px">'+conv+'% de conversão</span></div>'+
    '<div style="display:flex;gap:20px">'+
      '<div><div class="muted" style="font-size:12px">Checkouts</div><div class="k-val small">'+d.checkout+'</div></div>'+
      '<div><div class="muted" style="font-size:12px">Compras</div><div class="k-val small" style="color:'+color+'">'+d.purchased+'</div></div>'+
      '<div><div class="muted" style="font-size:12px">Convers&atilde;o</div><div class="k-val small">'+conv+'%</div></div>'+
    '</div>'+
    '<div class="mini-track"><i style="width:'+Math.min(100,conv)+'%;background:'+color+'"></i></div></div>';
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
    kpi(I.globe,'tint-cyan','Países ativos','<span class="cyn">'+m.countries.length+'</span>','com pelo menos 1 lead')+
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
}
// Construtor de globo (visual refinado) — usado pela aba Ao Vivo.
function makeGlobe(el,height){
  el.innerHTML=''; // limpa canvas/contexto WebGL residual antes de recriar
  var g=Globe()(el)
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
    .backgroundColor('rgba(0,0,0,0)')
    .showGraticules(false)
    .showAtmosphere(true).atmosphereColor('#3f9fff').atmosphereAltitude(0.28)
    .pointLat('lat').pointLng('lng')
    .ringLat('lat').ringLng('lng');
  try{
    var scene=g.scene && g.scene();
    if(scene){
      scene.add(new THREE.AmbientLight(0xf0f5ff,1.9));
      var dl=new THREE.DirectionalLight(0xdde9ff,1.1); dl.position.set(1,0.6,0.8); scene.add(dl);
      // luz de preenchimento rosa sutil vinda de baixo — assinatura da marca
      var pk=new THREE.DirectionalLight(0xff2d6f,0.18); pk.position.set(-1,-0.8,-0.4); scene.add(pk);
    }
  }catch(_){}
  g.pointOfView({lat:24,lng:-12,altitude:1.95},0);
  var ctrl=g.controls();
  if(ctrl){
    ctrl.autoRotate=true;ctrl.autoRotateSpeed=0.42;
    ctrl.enableZoom=true;ctrl.zoomSpeed=0.6;
    ctrl.minDistance=140;ctrl.maxDistance=520; // limites de zoom confortáveis
  }
  setTimeout(function(){ try{g.width(el.clientWidth).height(height);}catch(e){} },80);
  return g;
}
// Cor da marcação conforme intensidade: frio (ciano) → médio (azul) → quente (rosa)
function heatColor(sz){
  if(sz>=.75) return '#ff2d6f';
  if(sz>=.45) return '#52a8ff';
  return '#25f4ee';
}
function heatRGBA(sz,a){
  if(sz>=.75) return 'rgba(255,45,111,'+a+')';
  if(sz>=.45) return 'rgba(82,168,255,'+a+')';
  return 'rgba(37,244,238,'+a+')';
}
// ── Zoom programático (botões + e −) ──
function globeZoom(factor){
  if(!liveGlobe) return;
  try{
    var pov=liveGlobe.pointOfView();
    var alt=Math.max(0.45,Math.min(3.4,(pov.altitude||1.95)*factor));
    liveGlobe.pointOfView({lat:pov.lat,lng:pov.lng,altitude:alt},380);
  }catch(_){}
}
// ── Popup do globo (substitui o fullscreen nativo) ──
// O card do globo é movido para dentro do painel do modal e devolvido
// à posição original ao fechar — o Globe.gl continua vivo, só redimensiona.
var globePlaceholder=null;
function globeModalOpen(){
  var modal=document.getElementById('globe-modal'), card=document.getElementById('globe-card');
  if(!modal||!card||!modal.hidden) return;
  globePlaceholder=document.createElement('div');
  globePlaceholder.id='globe-ph';
  card.parentNode.insertBefore(globePlaceholder,card);
  document.getElementById('gm-body').appendChild(card);
  modal.hidden=false;
  document.body.style.overflow='hidden';
  requestAnimationFrame(function(){ requestAnimationFrame(function(){
    modal.classList.add('open');
    setTimeout(resizeGlobe,120); // redimensiona após o layout do painel assentar
    setTimeout(resizeGlobe,500); // e de novo ao fim da transição
  });});
}
function globeModalClose(){
  var modal=document.getElementById('globe-modal'), card=document.getElementById('globe-card');
  if(!modal||modal.hidden) return;
  modal.classList.remove('open');
  document.body.style.overflow='';
  setTimeout(function(){
    modal.hidden=true;
    if(globePlaceholder&&globePlaceholder.parentNode){
      globePlaceholder.parentNode.replaceChild(card,globePlaceholder);
      globePlaceholder=null;
    }
    resizeGlobe();
  },460); // espera a animação de saída
}
function globeFullscreen(){
  var modal=document.getElementById('globe-modal');
  (modal&&!modal.hidden)?globeModalClose():globeModalOpen();
}
function resizeGlobe(){
  var el=document.getElementById('live-globe'); if(!el||!liveGlobe) return;
  var inModal=!!document.getElementById('gm-body').contains(el);
  var h=inModal?el.parentElement.clientHeight||el.clientHeight:520;
  try{ liveGlobe.width(el.clientWidth).height(h); }catch(_){}
}
/* ── Ao Vivo ── */
function pageLabel(p){
  if(!p) return '—';
  var path=String(p).split('?')[0];
  if(path==='/'||path==='') return 'Página inicial';
  if(path.indexOf('checkout')!==-1) return 'Checkout';
  return path;
}
var liveLoading=false;
function loadLive(){
  if(liveLoading) return Promise.resolve(); // evita requisições sobrepostas
  liveLoading=true;
  return fetch('/api/live',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
    liveLoading=false;
    LIVE=d||{visitors:[],summary:{online:0,countries:[]}};
    updateLiveBadge();
    if(currentView==='live') renderLive();
    if(currentView==='overview') renderLiveGlobe(); // globo mora na Visão Geral
  }).catch(function(){liveLoading=false;});
}
function updateLiveBadge(){
  var n=(LIVE.summary&&LIVE.summary.online)||0;
  var b=document.getElementById('nav-live-badge');
  if(b){ b.textContent=n; b.style.display=n>0?'':'none'; }
}

/* ── Notificações (aba Ao Vivo) ─────────────────────────────────────────
   Alimentada pelo feed de eventos (DATA.events): vendas, leads, checkouts,
   recusas, reembolsos e disputas. Som opcional + limpar. */
var NOTIFS=[], NOTIF_SEEN={}, notifSound=(localStorage.getItem('rn_notif_sound')||'on')==='on',
    notifBooted=false, notifWired=false;
var NOTIF_META={
  sale:    {ico:'sale',    t:'Venda aprovada',   svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>'},
  failed:  {ico:'spike',   t:'Pagamento recusado',svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'},
  refund:  {ico:'checkout',t:'Reembolso',        svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>'},
  dispute: {ico:'spike',   t:'Disputa aberta',   svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>'},
  visit:   {ico:'visit',   t:'Novo lead no funil',svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>'},
  lead:    {ico:'checkout',t:'Chegou no checkout',svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>'}
};
function notifBeep(){
  if(!notifSound) return;
  try{
    var ctx=notifBeep._ctx||(notifBeep._ctx=new (window.AudioContext||window.webkitAudioContext)());
    var o=ctx.createOscillator(), g=ctx.createGain();
    o.type='sine'; o.frequency.value=880;
    g.gain.setValueAtTime(0.001,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12,ctx.currentTime+0.02);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.35);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime+0.4);
  }catch(_){}
}
function notifSub(e){
  var geo=[e.city,e.countryName||e.country].filter(Boolean).join(', ');
  if(e.type==='sale')   return (e.amount!=null?money(e.amount,e.currency||'EUR')+' \u00b7 ':'')+(geo||e.email||'');
  if(e.type==='failed') return (e.amount!=null?money(e.amount,e.currency||'EUR')+' \u00b7 ':'')+(e.reason||geo||'');
  if(e.type==='refund'||e.type==='dispute') return (e.amount!=null?money(e.amount,e.currency||'EUR'):'')+(geo?' \u00b7 '+geo:'');
  return geo||(e.page||'')||'';
}
function ingestNotifs(){
  var evs=(DATA&&DATA.events)||[];
  var fresh=[];
  for(var i=0;i<evs.length&&i<60;i++){
    var e=evs[i];
    if(!e.id||NOTIF_SEEN[e.id]) continue;
    if(!NOTIF_META[e.type]) continue;
    NOTIF_SEEN[e.id]=1;
    fresh.push(e);
  }
  if(!fresh.length) return;
  // na primeira carga, popula sem som (histórico); depois, som só p/ eventos importantes
  fresh.reverse().forEach(function(e){
    NOTIFS.unshift(e);
    if(notifBooted&&(e.type==='sale'||e.type==='dispute')) notifBeep();
  });
  if(NOTIFS.length>30) NOTIFS.length=30;
  notifBooted=true;
  renderNotifs();
}
function renderNotifs(){
  var el=document.getElementById('notif-list'); if(!el) return;
  wireNotifTools();
  if(!NOTIFS.length){
    el.innerHTML='<div class="notif-empty">Sem notifica\u00e7\u00f5es por enquanto.<br>Vendas, leads e alertas aparecem aqui em tempo real.</div>';
    return;
  }
  el.innerHTML=NOTIFS.map(function(e){
    var m=NOTIF_META[e.type];
    var t=e.at?new Date(e.at):null;
    var ago=t?fmtAgo(Date.now()-t.getTime()):'';
    return '<div class="nrow">'+
      '<div class="nico '+m.ico+'">'+m.svg+'</div>'+
      '<div class="nbody"><b>'+m.t+'</b><span>'+esc(notifSub(e)||'\u2014')+'</span></div>'+
      '<div class="ntime" title="'+(t?fmtHM(t.getTime()):'')+'">'+ago+'</div>'+
    '</div>';
  }).join('');
}
var NOTIF_SND_ON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14"/></svg>';
var NOTIF_SND_OFF='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M23 9l-6 6M17 9l6 6"/></svg>';
function wireNotifTools(){
  if(notifWired) return;
  var snd=document.getElementById('notif-sound'), clr=document.getElementById('notif-clear');
  if(!snd||!clr) return;
  notifWired=true;
  function paintSnd(){
    snd.innerHTML=notifSound?NOTIF_SND_ON:NOTIF_SND_OFF;
    snd.classList.toggle('on',notifSound);
    snd.title=notifSound?'Som ligado \u2014 clique para silenciar':'Som desligado \u2014 clique para ativar';
  }
  paintSnd();
  snd.onclick=function(){
    notifSound=!notifSound;
    localStorage.setItem('rn_notif_sound',notifSound?'on':'off');
    paintSnd();
    if(notifSound) notifBeep(); // feedback imediato
  };
  clr.onclick=function(){ NOTIFS=[]; renderNotifs(); };
}
// Pulso de tráfego: entradas de leads por minuto nos últimos 30 min (barras),
// + destaque de quantos estão no checkout AGORA (próprio + externo).
function fmtHM(t){ var d=new Date(t); return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2); }
function fmtAgo(ms){
  var s=Math.round(ms/1000);
  if(s<60) return 'h\u00e1 '+s+'s';
  var m=Math.floor(s/60);
  if(m<60) return 'h\u00e1 '+m+' min';
  return 'h\u00e1 '+Math.floor(m/60)+'h'+(m%60?(m%60)+'m':'');
}
function renderTrafficPulse(){
  var el=document.getElementById('traffic-pulse'); if(!el) return;
  var now=Date.now(), MIN=60000, WINDOW=30;
  var buckets=new Array(WINDOW).fill(0);
  // usa os eventos de "visit" (novo lead no funil) do feed principal
  var evs=(DATA&&DATA.events)||[];
  var lastAt=0;
  evs.forEach(function(e){
    if(e.type!=='visit') return;
    var t=e.at?new Date(e.at).getTime():0; if(!t) return;
    if(t>lastAt&&t<=now) lastAt=t;
    var idx=Math.floor((now-t)/MIN);
    if(idx>=0&&idx<WINDOW) buckets[WINDOW-1-idx]++; // mais antigo à esquerda
  });
  var total=buckets.reduce(function(a,b){return a+b;},0);
  var max=Math.max.apply(null,buckets.concat([1]));
  var half=buckets.length/2;
  var recent=buckets.slice(half).reduce(function(a,b){return a+b;},0);
  var older=buckets.slice(0,half).reduce(function(a,b){return a+b;},0);
  var trend=recent-older;
  var ck=LIVE.checkout||{stripeNow:0,cooudEst:0};
  var inCk=(ck.stripeNow||0)+(ck.cooudEst||0);
  // pico: minuto com mais entradas (horário real)
  var peakIdx=-1,peakVal=0;
  buckets.forEach(function(v,i){ if(v>peakVal){peakVal=v;peakIdx=i;} });
  var peakTime=peakIdx>=0&&peakVal>0?fmtHM(now-(WINDOW-1-peakIdx)*MIN):null;
  // média por minuto (só janela com atividade)
  var avg=total>0?(total/WINDOW):0;
  var avgTxt=avg>=1?avg.toFixed(1):(avg>0?avg.toFixed(2):'0');
  // barras com tooltip de horário real
  var bars=buckets.map(function(v,i){
    var h=Math.max(4,Math.round(v/max*100));
    var t=now-(WINDOW-1-i)*MIN;
    var cls='tb'+(i===buckets.length-1?' cur':'')+(v>=max&&max>1&&v>0?' hot':'');
    return '<div class="'+cls+'" style="height:'+h+'%" title="'+fmtHM(t)+' \u2014 '+v+' entrada(s)"></div>';
  }).join('');
  // eixo de tempo abaixo das barras
  var axis='<div class="tf-axis">'+
    '<span>'+fmtHM(now-29*MIN)+'</span><span>'+fmtHM(now-20*MIN)+'</span>'+
    '<span>'+fmtHM(now-10*MIN)+'</span><span class="ax-now">agora \u00b7 '+fmtHM(now)+'</span></div>';
  var tCls=trend>0?'up':(trend<0?'down':'flat');
  var tIco=trend>0?ARR_UP:(trend<0?ARR_DN:'');
  var tTxt=trend>0?('+'+trend+' subindo'):(trend<0?(trend+' caindo'):'est\u00e1vel');
  if(inCk>=3){ tCls='hot'; tTxt=inCk+' no checkout agora'; }
  el.innerHTML=
    '<div class="tf-now">'+
      '<span class="tf-big">'+total+'</span><span class="tf-lbl">leads em 30 min</span>'+
      '<span class="tf-avg">m\u00e9dia <b>'+avgTxt+'</b>/min</span>'+
    '</div>'+
    '<div class="tf-mid"><div class="tf-bars">'+bars+'</div>'+axis+'</div>'+
    '<div class="tf-trend '+tCls+'">'+tIco+tTxt+'</div>'+
    '<div class="tf-sub">'+
      '<span class="tfs"><i class="tfd" style="background:var(--cyan)"></i>\u00daltima entrada: <b>'+(lastAt?fmtHM(lastAt)+' \u00b7 '+fmtAgo(now-lastAt):'\u2014')+'</b></span>'+
      '<span class="tfs"><i class="tfd" style="background:var(--amber)"></i>Pico: <b>'+(peakTime?peakTime+' \u00b7 '+peakVal+' lead'+(peakVal>1?'s':''):'\u2014')+'</b></span>'+
      '<span class="tfs"><i class="tfd" style="background:var(--pink)"></i>No checkout: <b>'+inCk+'</b> <span class="tfm">('+(ck.stripeNow||0)+' Stripe \u00b7 '+(ck.cooudEst||0)+' externo)</span></span>'+
      '<span class="tfs"><i class="tfd" style="background:var(--green)"></i>Online agora: <b>'+((LIVE.summary&&LIVE.summary.online)||0)+'</b></span>'+
      '<span class="tfs tfm" style="margin-left:auto">'+(recent)+' entradas nos \u00faltimos 15 min \u00b7 '+(older)+' nos 15 anteriores</span>'+
    '</div>';
}
// Um lead está "no checkout" quando a página atual contém checkout.
function isCheckoutLead(v){ return !!(v.page&&v.page.indexOf('checkout')!==-1); }
function renderLive(){
  var s=LIVE.summary||{online:0,countries:[]}; var vs=LIVE.visitors||[];
  // dedupe defensivo por id: o servidor já garante 1 sessão por visitante,
  // mas descartamos qualquer duplicata que chegue ao cliente
  var seen={}; vs=vs.filter(function(v){
    var id=v.id||JSON.stringify([v.country,v.page,v.durationMs]);
    if(seen[id]) return false; seen[id]=1; return true;
  });
  var ck=LIVE.checkout||{stripeNow:0,cooudEst:0};
  // "no checkout" próprio (Stripe): usa presença real da página; fallback p/ filtro local
  var stripeNow=ck.stripeNow!=null?ck.stripeNow:vs.filter(isCheckoutLead).length;
  var cooudEst=ck.cooudEst||0;
  var totalCheckout=stripeNow+cooudEst;
  document.getElementById('live-kpis').innerHTML=
    kpi(I.users,'tint-green','Online agora','<span class="grn">'+s.online+'</span>','pessoas navegando &middot; '+((s.countries||[]).length)+' pa&iacute;ses')+
    kpi(I.cart,'tint-pink','No checkout agora','<span class="pnk">'+totalCheckout+'</span>',
      '<span class="grn">'+stripeNow+'</span> Stripe &middot; <span style="color:var(--amber)">'+cooudEst+'</span> externo')+
    kpi(I.zap,'tint-cyan','Checkout externo','<span style="color:var(--amber)">'+cooudEst+'</span>','rastreados no Cooud &middot; ~10&nbsp;min');
  // Card "Pulso de tráfego"
  renderTrafficPulse();
  // checkout primeiro (mais quentes no topo), depois por atividade
  var sorted=vs.slice().sort(function(a,b){
    var ac=isCheckoutLead(a)?1:0, bc=isCheckoutLead(b)?1:0;
    if(ac!==bc) return bc-ac;
    return (a.idleMs||0)-(b.idleMs||0);
  });
  var nCk=vs.filter(isCheckoutLead).length;
  var list=document.getElementById('live-list');
  var header=nCk>0?'<div class="lhot-head"><span class="lhot-dot"></span>'+nCk+' lead'+(nCk>1?'s':'')+' no checkout agora</div>':'';
  list.innerHTML=sorted.length?header+sorted.map(function(v){
    var idle=v.idleMs>20000;
    var inCk=isCheckoutLead(v);
    var gw=v.variant==='cooud'?'cooud':(v.variant==='stripe'?'stripe':'');
    var funnel=(v.pageviews||1)>1?'<span class="lfun" title="p\u00e1ginas vistas nesta sess\u00e3o">'+v.pageviews+' p\u00e1gs</span>':'';
    return '<div class="lrow'+(idle?' idle':'')+(inCk?' hot':'')+'">'+
      '<span class="ldot"></span>'+
      '<span class="lflag">'+flag(v.country)+'</span>'+
      '<div class="lmain"><b>'+esc(v.countryName||v.country||'Local desconhecido')+(v.city?' &middot; '+esc(v.city):'')+'</b>'+
        '<span class="lpage">'+esc(pageLabel(v.page))+'</span></div>'+
      '<div class="lmeta">'+
        (inCk?'<span class="lck">'+I.cart+'no checkout</span>':'')+
        (gw?'<span class="lgw '+gw+'">'+gw+'</span>':'')+
        funnel+
        '<span class="ldur">'+liveDur(v.durationMs)+'</span></div>'+
    '</div>';
  }).join(''):'<div class="live-empty">Ningu&eacute;m navegando agora.<br>Assim que algu&eacute;m abrir o site, aparece aqui em tempo real.</div>';
}
function liveDur(ms){
  var s=Math.floor((ms||0)/1000);
  if(s<60) return s+'s';
  if(s<3600) return Math.floor(s/60)+'min';
  return Math.floor(s/3600)+'h';
}
function renderLiveGlobe(){
  var el=document.getElementById('live-globe'); if(!el) return;
  if(typeof Globe==='undefined'){ el.innerHTML='<div class="empty" style="height:100%;display:flex;align-items:center;justify-content:center">Globo indispon&iacute;vel.</div>'; return; }
  var cs=(LIVE.summary&&LIVE.summary.countries)||[];
  var top=cs[0]?cs[0].count:1;
  var pts=cs.filter(function(c){return GEO[c.code];}).map(function(c){
    var g=GEO[c.code]; var sz=Math.max(.25,Math.min(1,c.count/top));
    return {lat:g[0],lng:g[1],size:sz,count:c.count,name:c.name,code:c.code};
  });
  try{
    if(!liveGlobe){
      liveGlobe=makeGlobe(el,520);
      liveGlobe.pointAltitude(function(d){return 0.03+d.size*0.32;})
        .pointRadius(function(d){return 0.3+d.size*0.55;})
        .pointColor(function(d){return heatColor(d.size);})
        .pointLabel(function(d){
          var c=heatColor(d.size);
          return '<div style="background:rgba(13,13,20,.94);border:1px solid '+c+'55;padding:10px 14px;border-radius:12px;'+
            'font-family:Inter,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.6),0 0 18px -6px '+c+';backdrop-filter:blur(8px)">'+
            '<div style="font-size:13px;color:#fff;font-weight:600;display:flex;align-items:center;gap:7px">'+
              '<span style="font-size:17px">'+flag(d.code)+'</span>'+d.name+'</div>'+
            '<div style="font-size:11px;color:#8b8b98;margin-top:5px;display:flex;align-items:center;gap:6px">'+
              '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:'+c+';box-shadow:0 0 7px '+c+'"></span>'+
              '<b style="color:'+c+';font-size:13px">'+d.count+'</b>&nbsp;online agora</div>'+
          '</div>';
        })
        .ringColor(function(d){return function(t){return heatRGBA(d.size,(1-t)*.9);};})
        .ringMaxRadius(function(d){return 2.8+d.size*5;})
        .ringPropagationSpeed(2.2)
        .ringRepeatPeriod(function(d){return 850-d.size*400;});
      // liga controles: zoom +/− e tela cheia
      var zi=document.getElementById('globe-zoom-in'), zo=document.getElementById('globe-zoom-out'), fs=document.getElementById('globe-fs');
      if(zi)zi.onclick=function(){globeZoom(0.72);};
      if(zo)zo.onclick=function(){globeZoom(1.38);};
      if(fs)fs.onclick=globeFullscreen;
      window.addEventListener('resize',resizeGlobe);
    }
    liveGlobe.pointsData(pts);
    liveGlobe.ringsData(pts);
  }catch(e){ el.innerHTML='<div class="empty">N&atilde;o foi poss&iacute;vel carregar o globo.</div>'; }
  // subtítulo com presença atual
  var n=(LIVE.summary&&LIVE.summary.online)||0;
  var sub=document.getElementById('ov-globe-sub');
  if(sub)sub.textContent=n>0?(n+' pessoa'+(n>1?'s':'')+' online \u00b7 '+cs.length+' pa\u00eds'+(cs.length>1?'es':'')):'aguardando visitantes';
  renderGlobeSide();
  renderTrafficPulse(); // pulso de tráfego vive junto do globo
}
// Painel lateral do globo: stats compactos + até 5 leads rastreados
function renderGlobeSide(){
  var vs=(LIVE.visitors||[]);
  var seen={}; vs=vs.filter(function(v){ var id=v.id||JSON.stringify([v.country,v.page,v.durationMs]); if(seen[id])return false; seen[id]=1; return true; });
  var ck=LIVE.checkout||{};
  var stripeNow=ck.stripeNow!=null?ck.stripeNow:vs.filter(isCheckoutLead).length;
  var totalCk=stripeNow+(ck.cooudEst||0);
  var on=document.getElementById('gs-online'); if(on)on.textContent=(LIVE.summary&&LIVE.summary.online)||0;
  var ce=document.getElementById('gs-ck'); if(ce)ce.textContent=totalCk;
  var list=document.getElementById('ov-live-list'); if(!list) return;
  // mais quentes primeiro (checkout > ativos), limitado a 5
  var sorted=vs.slice().sort(function(a,b){
    var ac=isCheckoutLead(a)?1:0, bc=isCheckoutLead(b)?1:0;
    if(ac!==bc) return bc-ac;
    return (a.idleMs||0)-(b.idleMs||0);
  });
  var top=sorted.slice(0,5), extra=sorted.length-top.length;
  list.innerHTML=top.length?top.map(function(v,i){
    var inCk=isCheckoutLead(v);
    return '<div class="gs-row'+(inCk?' hot':'')+'" style="animation-delay:'+(i*.05)+'s">'+
      '<span class="gr-flag">'+flag(v.country)+'</span>'+
      '<div class="gr-main"><b>'+esc(v.countryName||v.country||'Desconhecido')+(v.city?' \u00b7 '+esc(v.city):'')+'</b>'+
        '<span>'+esc(pageLabel(v.page))+'</span></div>'+
      (inCk?'<span class="gr-ck" title="no checkout">'+I.cart+'</span>':'')+
      '<span class="gr-dur">'+liveDur(v.durationMs)+'</span>'+
    '</div>';
  }).join('')+(extra>0?'<div class="gs-more">+'+extra+' lead'+(extra>1?'s':'')+' navegando \u2014 veja todos na aba Ao Vivo</div>':'')
  :'<div class="live-empty" style="padding:20px">Ningu\u00e9m navegando agora.</div>';
}

/* ── Teste A/B ── */
function zScore(nA,cA,nB,cB){ if(!nA||!nB) return 0; var pA=cA/nA,pB=cB/nB,p=(cA+cB)/(nA+nB); var se=Math.sqrt(p*(1-p)*(1/nA+1/nB)); if(!se||isNaN(se)) return 0; return (pA-pB)/se; }
function confFromZ(z){ z=Math.abs(z); var t=1/(1+0.2316419*z); var d=0.3989423*Math.exp(-z*z/2); var p=1-d*(0.3193815*t-0.3565638*t*t+1.781478*t*t*t-1.821256*Math.pow(t,4)+1.330274*Math.pow(t,5)); return +(((2*p-1))*100).toFixed(1); }
function renderAB(){
  fillABControl();
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
    '<div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;font-weight:600">Vencedor por receita/visitante</div>'+
    '<div class="win '+(winner==='cooud'?'pnk':'cyn')+'">'+winName+'</div>'+
    '<div class="vgrid">'+
      '<div class="vcell" style="--vc:var(--cyan)"><div class="vt">RPV Stripe</div><div class="vv cyn">'+money(rpvS,Object.keys(s.revenue||{})[0]||'EUR')+'</div></div>'+
      '<div class="vcell" style="--vc:var(--pink)"><div class="vt">RPV '+esc(extName)+'</div><div class="vv pnk">'+money(rpvC,Object.keys(c.revenue||{})[0]||'EUR')+'</div></div>'+
    '</div>'+
    '<div class="vstats">'+
      '<span class="vstat">Uplift <b>+'+uplift+'%</b></span>'+
      '<span class="vstat">Confian&ccedil;a <b>'+conf+'%</b></span>'+
    '</div>'+
    '<div class="conf-bar"><i style="width:'+Math.min(100,conf)+'%;background:'+(conf>=95?'var(--green)':'var(--amber)')+'"></i></div>';
  // comparativo único com barras integradas (substitui tabela + gráfico + cards duplicados)
  var maxRev=Math.max(sumRev(s.revenue),sumRev(c.revenue),1);
  document.getElementById('ab-metrics').innerHTML=
    '<div class="abm-head"><span>Comparativo</span><span class="cyn">Stripe</span><span class="pnk">'+esc(extName)+'</span></div>'+
    abRow('Visitantes',s.assignments,c.assignments,s.assignments,c.assignments)+
    abRow('Cliques no checkout',s.clicks||0,c.clicks||0,s.clicks||0,c.clicks||0)+
    abRow('Convers&otilde;es',s.conversions,c.conversions,s.conversions,c.conversions)+
    abRow('Taxa de convers&atilde;o',(s.conversionRate||0)+'%',(c.conversionRate||0)+'%',s.conversionRate||0,c.conversionRate||0)+
    abRow('Receita',revObj(s.revenue),revObj(c.revenue),sumRev(s.revenue)/maxRev*100,sumRev(c.revenue)/maxRev*100);
}
// Linha do comparativo: valores + barras proporcionais + seta no líder
function abRow(label,dispA,dispB,numA,numB){
  var max=Math.max(numA,numB,0.0001);
  var wa=Math.max(1.5,numA/max*100), wb=Math.max(1.5,numB/max*100);
  var leadA=numA>numB, leadB=numB>numA;
  return '<div class="abrow">'+
    '<div class="abr-top"><span class="lbl">'+label+'</span>'+
      '<span class="va cyn'+(leadA?' lead-val':'')+'">'+dispA+'</span>'+
      '<span class="vb pnk'+(leadB?' lead-val':'')+'">'+dispB+'</span></div>'+
    '<div class="abr-bars">'+
      '<div class="b s" style="width:'+wa+'%"></div>'+
      '<div class="b c" style="width:'+wb+'%"></div>'+
    '</div></div>';
}
// ── Painel de controle do experimento (aba A/B) ──────────────────────
var abDirty=false; // evita sobrescrever edições do usuário no auto-refresh
function fillABControl(){
  if(!CFG||abDirty) return;
  var isAB=CFG.mode!=='stripe_only';
  var extName=CFG.externalName||'Cooud';
  document.getElementById('ab-mode').checked=isAB;
  document.getElementById('ab-mode-label').textContent=isAB?'Teste ativo — tráfego dividido':'Pausado — 100% Stripe';
  document.getElementById('ab-split-wrap').style.opacity=isAB?'1':'.35';
  document.getElementById('ab-split').disabled=!isAB;
  document.getElementById('ab-split').value=CFG.stripePct;
  document.getElementById('ab-split-s').textContent='Stripe '+CFG.stripePct+'%';
  document.getElementById('ab-split-c').textContent=esc(extName)+' '+(100-CFG.stripePct)+'%';
  document.getElementById('ab-mode-label').classList.toggle('on',isAB);
  document.getElementById('ab-test-cooud').innerHTML=esc(extName)+' \u2197';
}
function abControlChanged(){
  abDirty=true;
  var pct=+document.getElementById('ab-split').value;
  var isAB=document.getElementById('ab-mode').checked;
  var extName=CFG&&CFG.externalName||'Cooud';
  document.getElementById('ab-mode-label').textContent=isAB?'Teste ativo — tráfego dividido':'Pausado — 100% Stripe';
  document.getElementById('ab-mode-label').classList.toggle('on',isAB);
  document.getElementById('ab-split-wrap').style.opacity=isAB?'1':'.35';
  document.getElementById('ab-split').disabled=!isAB;
  document.getElementById('ab-split-s').textContent='Stripe '+pct+'%';
  document.getElementById('ab-split-c').textContent=esc(extName)+' '+(100-pct)+'%';
  document.getElementById('ab-save').style.display='inline-flex';
}
document.getElementById('ab-split').addEventListener('input',abControlChanged);
document.getElementById('ab-mode').addEventListener('change',abControlChanged);
document.getElementById('ab-save').addEventListener('click',function(){
  var body={mode:document.getElementById('ab-mode').checked?'ab':'stripe_only',stripePct:+document.getElementById('ab-split').value};
  fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.ok){ CFG=d.config; abDirty=false; document.getElementById('ab-save').style.display='none'; fillABControl(); toast('Experimento atualizado'); }
      else toast('Erro ao salvar');
    }).catch(function(){ toast('Erro ao salvar'); });
});

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
    kpi(I.dispute,'tint-pink','Vendas órfãs','<span class="pnk">'+(co.orphans||0)+'</span>','sem lead nosso')+
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

/* ── Heatmap de vendas (hora × dia da semana) ── */
function renderHeat(){
  var el=document.getElementById('act-heat'); if(!el) return;
  var cells=[],max=0,tot=0; for(var d=0;d<7;d++){cells.push([]);for(var h=0;h<24;h++)cells[d].push(0);}
  (DATA.events||[]).forEach(function(e){ if(e.type!=='sale'||!e.at)return; var dt=new Date(e.at); var dd=(dt.getDay()+6)%7; var hh=dt.getHours(); cells[dd][hh]++; tot++; if(cells[dd][hh]>max)max=cells[dd][hh]; });
  if(!max){ el.innerHTML='<div class="empty" style="padding:30px">Sem vendas suficientes para o mapa de calor ainda.</div>'; return; }
  var days=['Seg','Ter','Qua','Qui','Sex','S&aacute;b','Dom'];
  function col(v){ if(!v)return 'var(--card2)'; var t=v/max; if(t<.25)return 'rgba(82,168,255,.30)'; if(t<.5)return 'rgba(82,168,255,.55)'; if(t<.75)return 'rgba(82,168,255,.75)'; return '#ff5674'; }
  var html='<div class="heat">';
  for(var d2=0;d2<7;d2++){ html+='<div class="hh">'+days[d2]+'</div>'; for(var h2=0;h2<24;h2++){ var v=cells[d2][h2]; html+='<div class="hc" style="background:'+col(v)+'" title="'+days[d2].replace('&aacute;','á')+' '+h2+'h: '+v+' venda(s)"></div>'; } }
  html+='</div><div class="heat-x"><span class="hx-pad"></span>';
  for(var hx=0;hx<24;hx++){ html+='<span>'+(hx%3===0?hx:'')+'</span>'; }
  html+='</div><div class="heat-legend">Menos<span class="hl-scale"><i style="background:var(--card2)"></i><i style="background:rgba(82,168,255,.30)"></i><i style="background:rgba(82,168,255,.55)"></i><i style="background:rgba(82,168,255,.75)"></i><i style="background:#ff5674"></i></span>Mais &middot; pico de <b style="color:var(--text)">'+max+'</b> venda(s)/hora &middot; '+tot+' vendas mapeadas</div>';
  el.innerHTML=html;
}

/* ── Atividade ── */
function renderActivity(){
  renderHeat();
  var all=(DATA.events||[]);
  var events=all.filter(function(e){return !evFilter||e.type===evFilter;});
  var feed=document.getElementById('feed');
  var cnt=document.getElementById('ev-count');
  if(cnt) cnt.textContent=events.length+' evento'+(events.length!==1?'s':'');
  var extName=CFG&&CFG.externalName||'Cooud';
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
  updateRotCount();
}
function isValidRotUrl(u){
  u=u.toLowerCase();
  return (u.indexOf('http://')===0||u.indexOf('https://')===0)&&u.length>8;
}
function updateRotCount(){
  var el=document.getElementById('cfg-rot-count'); if(!el) return;
  var lines=document.getElementById('cfg-rot-urls').value.split(String.fromCharCode(10)).map(function(u){return u.trim();});
  var valid=lines.filter(isValidRotUrl).length;
  var invalid=lines.filter(function(u){return u&&!isValidRotUrl(u);}).length;
  el.textContent=valid+' URL'+(valid===1?'':'s')+' válida'+(valid===1?'':'s')+(invalid?' · '+invalid+' ignorada'+(invalid===1?'':'s'):'');
  el.style.color=invalid?'var(--warn,#e0a800)':'var(--muted2)';
}
// Salva apenas o bloco de rotação (botão dedicado no card)
function saveRotation(){
  var body={
    rotateTtUrl:document.getElementById('cfg-rot').checked,
    rotateUrls:document.getElementById('cfg-rot-urls').value
  };
  var btn=document.getElementById('cfg-rot-save');
  btn.disabled=true;
  fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json();})
    .then(function(d){
      btn.disabled=false;
      if(d.ok){ CFG=d.config; document.getElementById('cfg-rot-urls').value=(CFG.rotateUrls||[]).join(String.fromCharCode(10)); updateRotCount(); toast('URLs de rotação salvas'); }
      else toast('Erro ao salvar',false);
    })
    .catch(function(){ btn.disabled=false; toast('Erro ao salvar',false); });
}
/* ── Pixel TikTok ─────────────────────────────────────────────────── */
var PX_LIST=[];
function loadPixels(){
  fetch('/api/pixels').then(function(r){return r.json();}).then(function(d){
    PX_LIST=d.pixels||[];
    renderPixels();
    var badge=document.getElementById('nav-px-badge');
    var n=PX_LIST.filter(function(p){return p.active;}).length;
    if(badge){ badge.textContent=n; badge.style.display=n?'':'none'; badge.className='badge live-badge'; }
  }).catch(function(){});
  loadPxLog();
}
function renderPixels(){
  var el=document.getElementById('px-list'); if(!el) return;
  if(!PX_LIST.length){
    el.innerHTML='<div class="live-empty">Nenhum pixel ainda.<br>Clique em "+ Adicionar pixel" — cada pixel vira um arquivo próprio em <code>pixels/</code> e passa a disparar em todas as páginas na hora.</div>';
    return;
  }
  el.innerHTML=PX_LIST.map(function(p){
    var routes=(p.routes&&p.routes.length)?p.routes.join(', '):'todas as páginas';
    var evs=Object.keys(p.events||{}).filter(function(k){return p.events[k];}).join(' · ')||'nenhum';
    return '<div class="lrow" style="cursor:default">'+
      '<span class="ldot" style="background:'+(p.active?'var(--green)':'var(--muted2)')+';box-shadow:none"></span>'+
      '<div class="lmain">'+
        '<b>'+esc(p.name)+' <span class="hint" style="font-weight:400">pixels/'+esc(p.slug)+'.json</span></b>'+
        '<span style="font-family:\\'Geist Mono\\',monospace">'+esc(p.pixelCode)+'</span>'+
        '<span>Rotas: '+esc(routes)+' &middot; Server-side: '+esc(evs)+(p.hasToken?'':' &middot; <span class="amb">sem token (só navegador)</span>')+'</span>'+
      '</div>'+
      '<div class="lmeta" style="flex-direction:row;gap:6px;align-items:center">'+
        '<button class="btn-icon" onclick="testPixel(\\''+esc(p.slug)+'\\')">Testar</button>'+
        '<button class="btn-icon" onclick="editPixel(\\''+esc(p.slug)+'\\')">Editar</button>'+
        '<button class="btn-icon" style="color:var(--red)" onclick="delPixel(\\''+esc(p.slug)+'\\')">Excluir</button>'+
      '</div>'+
    '</div>';
  }).join('');
}
function showPxForm(px){
  document.getElementById('px-form-card').style.display='';
  document.getElementById('px-form-title').textContent=px?('Editar: '+px.name):'Novo pixel';
  document.getElementById('px-slug').value=px?px.slug:'';
  document.getElementById('px-name').value=px?px.name:'';
  document.getElementById('px-code').value=px?px.pixelCode:'';
  document.getElementById('px-token').value=px?(px.accessToken||''):'';
  document.getElementById('px-routes').value=px?((px.routes||[]).join(String.fromCharCode(10))):'';
  var ev=px?(px.events||{}):{ViewContent:true,InitiateCheckout:true,CompletePayment:true};
  document.getElementById('px-ev-vc').checked=!!ev.ViewContent;
  document.getElementById('px-ev-ic').checked=!!ev.InitiateCheckout;
  document.getElementById('px-ev-cp').checked=!!ev.CompletePayment;
  document.getElementById('px-active').checked=px?!!px.active:true;
  document.getElementById('px-name').focus();
}
function editPixel(slug){
  var px=PX_LIST.filter(function(p){return p.slug===slug;})[0];
  if(px) showPxForm(px);
}
function delPixel(slug){
  if(!confirm('Excluir o pixel "'+slug+'"? O arquivo pixels/'+slug+'.json será removido.')) return;
  fetch('/api/pixels/'+encodeURIComponent(slug),{method:'DELETE'})
    .then(function(r){return r.json();})
    .then(function(d){ if(d.ok){ toast('Pixel removido'); loadPixels(); } else toast(d.error||'Erro',false); })
    .catch(function(){ toast('Erro ao remover',false); });
}
function testPixel(slug){
  toast('Enviando evento de teste...');
  fetch('/api/pixels/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:slug})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.ok) toast('TikTok aceitou o disparo (code 0)');
      else toast('Falhou: '+(d.message||d.error||'ver log'),false);
      loadPxLog();
    })
    .catch(function(){ toast('Erro no teste',false); });
}
function savePixel(){
  var slug=document.getElementById('px-slug').value;
  var body={
    slug:slug||undefined,
    name:document.getElementById('px-name').value.trim(),
    pixelCode:document.getElementById('px-code').value.trim(),
    accessToken:document.getElementById('px-token').value.trim(),
    routes:document.getElementById('px-routes').value.split(String.fromCharCode(10)).map(function(s){return s.trim();}).filter(Boolean),
    events:{
      ViewContent:document.getElementById('px-ev-vc').checked,
      InitiateCheckout:document.getElementById('px-ev-ic').checked,
      CompletePayment:document.getElementById('px-ev-cp').checked
    },
    active:document.getElementById('px-active').checked
  };
  if(!body.pixelCode){ toast('Pixel Code é obrigatório',false); return; }
  var btn=document.getElementById('px-save'); btn.disabled=true;
  fetch('/api/pixels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json();})
    .then(function(d){
      btn.disabled=false;
      if(d.ok){ toast('Pixel salvo em pixels/'+d.pixel.slug+'.json'); document.getElementById('px-form-card').style.display='none'; loadPixels(); }
      else toast(d.error||'Erro ao salvar',false);
    })
    .catch(function(){ btn.disabled=false; toast('Erro ao salvar',false); });
}
function loadPxLog(){
  fetch('/api/pixels/log').then(function(r){return r.json();}).then(function(d){
    var tb=document.getElementById('px-log'); if(!tb) return;
    var log=d.log||[];
    if(!log.length){ tb.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--muted2);padding:26px">Nenhum disparo ainda — os eventos aparecem aqui conforme os leads navegam.</td></tr>'; return; }
    tb.innerHTML=log.map(function(e){
      var ok=e.status==='ok';
      var resp=e.response&&e.response.message?e.response.message:(ok?'aceito':'—');
      return '<tr style="cursor:default">'+
        '<td>'+timeAgo(e.at)+'</td>'+
        '<td>'+esc(e.pixel||'—')+'</td>'+
        '<td><span class="tag '+(e.event==='CompletePayment'?'purchased':(e.event==='InitiateCheckout'?'checkout':'visit'))+'">'+esc(e.event||'—')+'</span></td>'+
        '<td style="font-family:\\'Geist Mono\\',monospace;font-size:11.5px">'+esc((e.leadId||'—').slice(0,10))+'</td>'+
        '<td><span class="'+(ok?'grn':'neg')+'">'+(ok?'OK':'erro')+'</span></td>'+
        '<td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;font-size:11.5px;color:var(--muted2)">'+esc(String(resp).slice(0,120))+'</td>'+
      '</tr>';
    }).join('');
  }).catch(function(){});
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
  var dbOk=!!HEALTH.db;
  var redisOk=HEALTH.redisEnabled?!!HEALTH.redis:null;
  var dbLatency=HEALTH.dbLatencyMs;
  document.getElementById('health-grid').innerHTML=
    '<div class="hitem"><div class="hdot '+(dbOk?'ok':'warn')+'"></div><div class="hlbl">Neon (banco)</div><div class="hstatus '+(dbOk?'ok':'warn')+'">'+(dbOk?('OK'+(dbLatency?'&nbsp;&middot;&nbsp;'+dbLatency+'ms':'')):'Offline')+'</div></div>'+
    (HEALTH.redisEnabled?'<div class="hitem"><div class="hdot '+(redisOk?'ok':'warn')+'"></div><div class="hlbl">Upstash Redis</div><div class="hstatus '+(redisOk?'ok':'warn')+'">'+(redisOk?'OK &middot; conectado':'Offline')+'</div></div>':'<div class="hitem"><div class="hdot warn"></div><div class="hlbl">Upstash Redis</div><div class="hstatus warn">Sem variáveis</div></div>')+
    items.map(function(it){
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

/* ── Exportação CSV ── */
function downloadCSV(name,rows){
  var NL=String.fromCharCode(10);
  var csv=rows.map(function(r){ return r.map(function(c){ c=(c==null?'':String(c)); if(/[",;\\n]/.test(c)) c='"'+c.replace(/"/g,'""')+'"'; return c; }).join(';'); }).join(NL);
  var blob=new Blob([String.fromCharCode(0xFEFF)+csv],{type:'text/csv;charset=utf-8'});
  var url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}
function exportLeads(){
  if(!DATA){return;}
  var q=(document.getElementById('lead-search').value||'').toLowerCase();
  var stage=document.getElementById('lead-stage').value, gwf=document.getElementById('lead-gw').value;
  var leads=(DATA.leads||[]).filter(function(l){ if(l.orphan)return false; if(!inPeriod(l.at))return false; if(stage&&l.stage!==stage)return false; if(gwf&&l.gateway!==gwf)return false; if(q){var hay=[l.id,l.country,l.countryName,l.customer,l.email].filter(Boolean).join(' ').toLowerCase(); if(hay.indexOf(q)<0)return false;} return true; });
  var rows=[['ID','Etapa','Gateway','Pais','Cidade','Cliente','Email','Origem','Esperado','Reportado','Moeda','Entrou']];
  leads.forEach(function(l){ rows.push([l.id,l.stage,l.gateway||'',l.countryName||l.country||'',l.city||'',l.customer||'',l.email||'',(l.utm&&l.utm.source)||'',((l.expectedAmount||0)/100).toFixed(2),((l.reportedAmount||0)/100).toFixed(2),l.reportedCurrency||l.expectedCurrency||'',l.at||'']); });
  downloadCSV('roi-nados-leads-'+period+'.csv',rows);
  toast(leads.length+' leads exportados');
}
function exportEvents(){
  if(!DATA){return;}
  var events=(DATA.events||[]).filter(function(e){return !evFilter||e.type===evFilter;});
  var rows=[['Tipo','Titulo','Cliente','Email','Gateway','Pais','Cartao','Valor','Moeda','Quando']];
  events.forEach(function(e){ rows.push([e.type,e.title||'',e.customer||'',e.email||'',e.gateway||'',e.country||'',e.card||'',((e.amount||0)/100).toFixed(2),e.currency||'',e.at||'']); });
  downloadCSV('pulse-eventos.csv',rows);
  toast(events.length+' eventos exportados');
}

/* ── Período (programático — usado pela paleta e pelo segmento) ── */
function setPeriod(p){
  period=p;
  if(p!=='custom'){ CUSTOM={from:0,to:0}; var l=document.getElementById('period-custom-lbl'); if(l)l.textContent=''; }
  document.querySelectorAll('#period button').forEach(function(x){x.classList.toggle('active',x.getAttribute('data-p')===p);});
  RENDERED_GROUPS={}; // período mudou: todos os grupos precisam repintar
  renderAll();
}

/* ── Segmentação por dias e horas (popover) ── */
function drPad(v){return ('0'+v).slice(-2);}
function drDateVal(d){return d.getFullYear()+'-'+drPad(d.getMonth()+1)+'-'+drPad(d.getDate());}
function openDrPop(){
  var pop=document.getElementById('dr-pop'); if(!pop) return;
  // pré-preenche: range atual se houver, senão hoje
  var f=document.getElementById('dr-from'), t=document.getElementById('dr-to');
  if(CUSTOM.from){ f.value=drDateVal(new Date(CUSTOM.from)); t.value=drDateVal(new Date(CUSTOM.to)); }
  else { var today=drDateVal(new Date()); f.value=today; t.value=today; }
  pop.hidden=false;
  drSyncHours();
}
function closeDrPop(){ var pop=document.getElementById('dr-pop'); if(pop)pop.hidden=true; }
// horas só fazem sentido quando De === Até (um único dia)
function drSyncHours(){
  var f=document.getElementById('dr-from').value, t=document.getElementById('dr-to').value;
  var sameDay=f&&t&&f===t;
  document.getElementById('dr-hours').classList.toggle('off',!sameDay);
  document.getElementById('dr-hours-hint').style.display=sameDay?'none':'';
  drSyncHourLabel();
}
function drSyncHourLabel(){
  var h1=+document.getElementById('dr-h-from').value, h2=+document.getElementById('dr-h-to').value;
  if(h1>h2){ var tmp=h1;h1=h2;h2=tmp; }
  document.getElementById('dr-hlbl').textContent=drPad(h1)+':00 \u2013 '+drPad(h2)+':59';
}
function applyDr(){
  var fv=document.getElementById('dr-from').value, tv=document.getElementById('dr-to').value;
  if(!fv||!tv){ toast('Escolha as duas datas'); return; }
  if(fv>tv){ var sw=fv;fv=tv;tv=sw; }
  var from=new Date(fv+'T00:00:00').getTime();
  var to=new Date(tv+'T23:59:59.999').getTime();
  var sameDay=fv===tv;
  if(sameDay){
    var h1=+document.getElementById('dr-h-from').value, h2=+document.getElementById('dr-h-to').value;
    if(h1>h2){ var tm=h1;h1=h2;h2=tm; }
    from=new Date(fv+'T00:00:00').getTime()+h1*36e5;
    to=new Date(fv+'T00:00:00').getTime()+h2*36e5+36e5-1; // fim da hora h2
  }
  CUSTOM={from:from,to:Math.min(to,Date.now())};
  period='custom';
  // rótulo compacto no botão: "12/05" ou "12–15/05" ou "12/05 09–18h"
  var fd=new Date(from), td=new Date(to);
  var lbl=sameDay
    ? drPad(fd.getDate())+'/'+drPad(fd.getMonth()+1)+((+document.getElementById('dr-h-from').value!==0||+document.getElementById('dr-h-to').value!==23)?' '+drPad(fd.getHours())+'\u2013'+drPad(td.getHours())+'h':'')
    : drPad(fd.getDate())+'/'+drPad(fd.getMonth()+1)+'\u2013'+drPad(td.getDate())+'/'+drPad(td.getMonth()+1);
  document.getElementById('period-custom-lbl').textContent=lbl;
  document.querySelectorAll('#period button').forEach(function(x){x.classList.toggle('active',x.getAttribute('data-p')==='custom');});
  closeDrPop();
  RENDERED_GROUPS={}; // range mudou: repintar tudo
  renderAll();
  toast('Per\u00edodo segmentado aplicado');
}

/* ── Paleta de comandos ⌘K ── */
var CMD_ITEMS=[
  {g:'Telas',t:'Visão Geral',h:'resumo',ic:I.money,act:function(){setView('overview');}},
  {g:'Telas',t:'Ao Vivo',h:'presença, funil, países',ic:I.zap,act:function(){setView('live');}},
  {g:'Telas',t:'Teste A/B',h:'gateways + anti-desvio',ic:I.pct,act:function(){setView('ab');}},
  {g:'Telas',t:'Pixel TikTok',h:'rastreamento, events api',ic:I.zap,act:function(){setView('pixels');}},
  {g:'Telas',t:'Configurações',h:'sistema',ic:I.check,act:function(){setView('config');}},
  {g:'Ir para',t:'Funil & Leads',h:'dentro de Ao Vivo',ic:I.cart,act:function(){setView('funnel');}},
  {g:'Ir para',t:'Países',h:'dentro de Ao Vivo',ic:I.globe,act:function(){setView('geo');}},
  {g:'Ir para',t:'Atividade',h:'dentro de Ao Vivo',ic:I.zap,act:function(){setView('activity');}},
  {g:'Ir para',t:'Anti-desvio',h:'dentro de Teste A/B',ic:I.shield,act:function(){setView('cooud');}},
  {g:'Período',t:'Hoje',ic:I.check,act:function(){setPeriod('today');}},
  {g:'Período',t:'Últimos 7 dias',ic:I.check,act:function(){setPeriod('7d');}},
  {g:'Período',t:'Últimos 30 dias',ic:I.check,act:function(){setPeriod('30d');}},
  {g:'Período',t:'Todo o histórico',ic:I.check,act:function(){setPeriod('all');}},
  {g:'Período',t:'Segmentar dias e horas',h:'range personalizado',ic:I.check,act:function(){openDrPop();}},
  {g:'Ações',t:'Atualizar agora',h:'refresh',ic:I.zap,act:function(){refresh().then(function(){toast('Atualizado');});}},
  {g:'Ações',t:'Exportar leads (CSV)',ic:I.cart,act:function(){setView('funnel');setTimeout(exportLeads,60);}},
  {g:'Ações',t:'Exportar eventos (CSV)',ic:I.zap,act:function(){setView('activity');setTimeout(exportEvents,60);}}
];
var cmdkSel=0, cmdkFiltered=[];
function openCmdk(){ var bg=document.getElementById('cmdk-bg'); bg.classList.add('open'); var inp=document.getElementById('cmdk-input'); inp.value=''; renderCmdk(''); setTimeout(function(){inp.focus();},40); }
function closeCmdk(){ document.getElementById('cmdk-bg').classList.remove('open'); }
function renderCmdk(q){
  q=(q||'').toLowerCase().trim();
  cmdkFiltered=CMD_ITEMS.filter(function(it){ return !q || (it.t+' '+(it.h||'')+' '+it.g).toLowerCase().indexOf(q)>=0; });
  cmdkSel=0;
  var list=document.getElementById('cmdk-list');
  if(!cmdkFiltered.length){ list.innerHTML='<div class="cmdk-empty">Nada encontrado.</div>'; return; }
  var html='',lastG='';
  cmdkFiltered.forEach(function(it,i){ if(it.g!==lastG){ html+='<div class="cmdk-grp">'+it.g+'</div>'; lastG=it.g; } html+='<div class="cmdk-item'+(i===0?' sel':'')+'" data-i="'+i+'">'+(it.ic||I.zap)+'<span>'+esc(it.t)+'</span>'+(it.h?'<span class="ci-hint">'+esc(it.h)+'</span>':'')+'</div>'; });
  list.innerHTML=html;
}
function cmdkMove(dir){ var items=document.querySelectorAll('.cmdk-item'); if(!items.length)return; cmdkSel=(cmdkSel+dir+items.length)%items.length; items.forEach(function(el,i){el.classList.toggle('sel',i===cmdkSel);}); var s=items[cmdkSel]; if(s)s.scrollIntoView({block:'nearest'}); }
function cmdkRun(i){ var it=cmdkFiltered[i]; if(!it)return; closeCmdk(); it.act(); }

/* ── Render geral ──
   Renderiza apenas as sections do grupo ativo — as demais são pintadas
   ao trocar de aba (setView chama renderAll). Corta ~70% do trabalho
   de DOM em cada ciclo de atualização. */
var RENDERED_GROUPS={}; // grupos já pintados com o DATA atual
function renderAll(){
  if(!DATA) return;
  buildLeadIndex();
  var m=metrics(); // calculado UMA vez e passado para cada render
  var g=currentView||'overview';
  if(g==='overview'){ renderOverview(m); }
  else if(g==='live'){ renderFunnel(m); renderGeo(m); renderActivity(); }
  else if(g==='ab'){ renderAB(); renderCooud(); }
  RENDERED_GROUPS[g]=true;
  renderFooter();
}
function renderFooter(){
  var _ago=DATA.updatedAt?timeAgo(DATA.updatedAt):'agora';
  document.getElementById('foot-updated').textContent=(_ago==='agora')?'agora':_ago+' atrás';
  // dot ao vivo: verde se dados atualizados < 60s
  var dot=document.getElementById('live-dot');
  if(dot){ var age=DATA.updatedAt?(Date.now()-new Date(DATA.updatedAt).getTime())/1000:9999; dot.className='dot'+(age>60?' off':''); }
}
function buildLeadIndex(){ leadsById={}; (DATA.leads||[]).forEach(function(l){leadsById[l.id]=l;}); }

/* ── API ── */
function loadStats(){ return fetch('/api/stats',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){DATA=d;}); }
function loadConfig(){ return fetch('/api/config',{cache:'no-store'}).then(function(r){return r.json();}).then(function(c){CFG=c;}); }
function loadHealth(){ return fetch('/api/health',{cache:'no-store'}).then(function(r){return r.json();}).then(function(h){HEALTH=h;}).catch(function(){}); }
/* Atualização inteligente: só re-renderiza quando os dados realmente
   mudaram (fingerprint) — elimina o repinte periódico que reiniciava
   animações e piscava a tela a cada 12s. */
var lastFp='', refreshing=false;
function dataFp(){
  if(!DATA) return '';
  return (DATA.updatedAt||'')+':'+((DATA.events||[]).length)+':'+((DATA.leads||[]).length)+':'+JSON.stringify(CFG||{});
}
function refresh(force){
  if(refreshing) return Promise.resolve(); // evita requisições sobrepostas
  refreshing=true;
  return Promise.all([loadStats(),loadConfig()])
    .then(function(){
      refreshing=false;
      var fp=dataFp();
      if(force||fp!==lastFp){
        lastFp=fp;
        RENDERED_GROUPS={}; // dados novos: os outros grupos repintam ao serem abertos
        fillConfig(); renderAll(); ingestNotifs();
      } else {
        renderFooter(); // nada mudou: só o relógio do rodapé
      }
    })
    .catch(function(e){ refreshing=false; console.warn('[pulse] refresh error',e); });
}

/* ── Navegação ──
   Menu consolidado em 4 grupos. Cada item do menu ativa um GRUPO de
   sections empilhadas — menos opções, tudo relacionado junto na mesma tela. */
var VIEW_GROUPS={
  overview:['overview'],
  live:['live','funnel','geo','activity'],
  ab:['ab','cooud'],
  pixels:['pixels'],
  config:['config']
};
var titles={
  overview:['Visão Geral','Resumo dos números que mais importam'],
  live:['Ao Vivo','Presença, funil, países e atividade — tudo em tempo real'],
  ab:['Teste A/B','Gateways, desempenho e anti-desvio'],
  pixels:['Pixel TikTok','Rastreamento server-side por lead — um pixel por arquivo'],
  config:['Configurações','Roteamento, chaves e saúde do sistema']
};
// Aceita tanto a chave do grupo quanto o nome de uma sub-view antiga
// (ex.: setView('funnel') abre o grupo Ao Vivo e rola até o funil).
function groupOf(v){
  if(VIEW_GROUPS[v]) return v;
  for(var g in VIEW_GROUPS){ if(VIEW_GROUPS[g].indexOf(v)>=0) return g; }
  return 'overview';
}
function setView(v){
  var g=groupOf(v), sub=(v!==g)?v:null;
  currentView=g;
  var views=VIEW_GROUPS[g];
  document.querySelectorAll('.nav button[data-view]').forEach(function(b){ b.classList.toggle('active',b.getAttribute('data-view')===g); });
  document.querySelectorAll('section.view').forEach(function(s){ s.classList.toggle('active',views.indexOf(s.id.replace('view-',''))>=0); });
  document.getElementById('page-title').textContent=titles[g][0];
  document.getElementById('page-sub').textContent=titles[g][1];
  document.getElementById('sidebar').classList.remove('open');
  var scrim=document.getElementById('side-scrim'); if(scrim) scrim.classList.remove('open');
  // animação de entrada em cascata (só na primeira section do grupo)
  var sec=document.getElementById('view-'+views[0]);
  if(sec){ sec.classList.remove('entering'); void sec.offsetWidth; sec.classList.add('entering'); setTimeout(function(){sec.classList.remove('entering');},700); }
  if(!RENDERED_GROUPS[g]) renderAll(); // pinta o grupo na primeira abertura com os dados atuais
  if(g==='live'){
    renderLive();
    loadLive();
  }
  if(g==='overview'){
    renderLiveGlobe();
    setTimeout(function(){ if(liveGlobe){ try{liveGlobe.width(document.getElementById('live-globe').clientWidth).height(520);}catch(e){} } },80);
  }
  setupLivePoll(g==='live'); // polling mais rápido quando a aba Ao Vivo está aberta
  if(g==='config') loadHealth().then(renderHealth);
  if(g==='pixels') loadPixels();
  // veio de uma sub-view (paleta de comandos)? rola até a section correspondente
  if(sub){ setTimeout(function(){ var t=document.getElementById('view-'+sub); if(t) t.scrollIntoView({behavior:'smooth',block:'start'}); },120); }
  else { document.querySelector('.main').scrollTop=0; window.scrollTo(0,0); }
}
// Polling de presença: 4s na aba Ao Vivo, 10s em segundo plano (para o badge).
function setupLivePoll(fast){
  if(liveTimer) clearInterval(liveTimer);
  liveTimer=setInterval(loadLive,fast?4000:10000);
}

/* ── Listeners ── */
document.getElementById('nav').addEventListener('click',function(e){
  var b=e.target.closest('button[data-view]'); if(b) setView(b.getAttribute('data-view'));
});
function setSideMenu(open){
  document.getElementById('sidebar').classList.toggle('open',open);
  document.getElementById('side-scrim').classList.toggle('open',open);
}
document.getElementById('menuToggle').addEventListener('click',function(){
  setSideMenu(!document.getElementById('sidebar').classList.contains('open'));
});
document.getElementById('side-scrim').addEventListener('click',function(){ setSideMenu(false); });
// popup do globo + "ver todos" os leads
document.getElementById('gm-close').addEventListener('click',globeModalClose);
document.getElementById('gm-scrim').addEventListener('click',globeModalClose);
document.getElementById('gs-all').addEventListener('click',function(){ setView('live'); });
document.addEventListener('keydown',function(e){ if(e.key==='Escape') globeModalClose(); });
// popover de segmentação de período
document.getElementById('dr-from').addEventListener('change',drSyncHours);
document.getElementById('dr-to').addEventListener('change',drSyncHours);
document.getElementById('dr-h-from').addEventListener('input',drSyncHourLabel);
document.getElementById('dr-h-to').addEventListener('input',drSyncHourLabel);
document.getElementById('dr-apply').addEventListener('click',applyDr);
document.getElementById('dr-clear').addEventListener('click',function(){ closeDrPop(); setPeriod('7d'); });
document.addEventListener('click',function(e){
  var pop=document.getElementById('dr-pop');
  if(pop&&!pop.hidden&&!pop.contains(e.target)&&!e.target.closest('#period-custom')) closeDrPop();
});
document.getElementById('period').addEventListener('click',function(e){
  var b=e.target.closest('button'); if(!b) return;
  if(b.getAttribute('data-p')==='custom'){
    var pop=document.getElementById('dr-pop');
    pop.hidden?openDrPop():closeDrPop();
    return;
  }
  closeDrPop();
  setPeriod(b.getAttribute('data-p'));
});
document.getElementById('chart-mode').addEventListener('click',function(e){
  var b=e.target.closest('button'); if(!b) return;
  chartMode=b.getAttribute('data-m');
  document.querySelectorAll('#chart-mode button').forEach(function(x){x.classList.toggle('active',x===b);});
  if(DATA){ var m=metrics(); renderChart(m); }
});
document.getElementById('refresh-btn').addEventListener('click',function(){
  var b=this; b.classList.add('spinning');
  refresh(true).then(function(){toast('Atualizado');}).catch(function(){toast('Falha ao atualizar',false);}).then(function(){ setTimeout(function(){b.classList.remove('spinning');},450); });
});
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
document.getElementById('export-leads').addEventListener('click',exportLeads);
document.getElementById('export-events').addEventListener('click',exportEvents);
document.getElementById('cmdk-open').addEventListener('click',openCmdk);
document.getElementById('cmdk-bg').addEventListener('click',function(e){ if(e.target===this) closeCmdk(); });
document.getElementById('cmdk-input').addEventListener('input',function(e){ renderCmdk(e.target.value); });
document.getElementById('cmdk-list').addEventListener('click',function(e){ var it=e.target.closest('.cmdk-item'); if(it) cmdkRun(+it.getAttribute('data-i')); });
document.addEventListener('keydown',function(e){
  var open=document.getElementById('cmdk-bg').classList.contains('open');
  if((e.metaKey||e.ctrlKey)&&(e.key==='k'||e.key==='K')){ e.preventDefault(); open?closeCmdk():openCmdk(); return; }
  if(!open) return;
  if(e.key==='Escape'){ e.preventDefault(); closeCmdk(); }
  else if(e.key==='ArrowDown'){ e.preventDefault(); cmdkMove(1); }
  else if(e.key==='ArrowUp'){ e.preventDefault(); cmdkMove(-1); }
  else if(e.key==='Enter'){ e.preventDefault(); cmdkRun(cmdkSel); }
});

document.getElementById('cfg-mode').addEventListener('change',updateSplitPreview);
document.getElementById('cfg-pct').addEventListener('input',updateSplitPreview);
document.getElementById('cfg-rot').addEventListener('change',updateRotPreview);
document.getElementById('cfg-rot-urls').addEventListener('input',updateRotCount);
document.getElementById('cfg-rot-save').addEventListener('click',saveRotation);
document.getElementById('px-new').addEventListener('click',function(){ showPxForm(null); });
document.getElementById('px-save').addEventListener('click',savePixel);
document.getElementById('px-cancel').addEventListener('click',function(){ document.getElementById('px-form-card').style.display='none'; });
document.getElementById('px-log-refresh').addEventListener('click',loadPxLog);
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
      if(d.ok){ CFG=d.config; fillConfig(); toast('Configuração salva'); RENDERED_GROUPS={}; renderAll(); }
      else toast('Erro ao salvar',false);
    })
    .catch(function(){toast('Erro ao salvar',false);});
});
document.getElementById('reset-btn').addEventListener('click',function(){
  if(!confirm('Tem certeza? Isto apaga todos os leads e eventos.')) return;
  fetch('/api/reset-stats',{method:'POST'})
    .then(function(){ toast('Estatísticas zeradas'); refresh(); })
    .catch(function(){toast('Erro',false);});
});

/* ── Auto-refresh ── */
function setupAuto(){
  if(autoTimer) clearInterval(autoTimer);
  autoTimer=setInterval(refresh,12000); // sempre ligado, a cada 12s
}
// Aba oculta? Pausa todo o polling; ao voltar, atualiza na hora.
document.addEventListener('visibilitychange',function(){
  if(document.hidden){
    if(autoTimer){clearInterval(autoTimer);autoTimer=null;}
    if(liveTimer){clearInterval(liveTimer);liveTimer=null;}
  } else {
    refresh(); loadLive();
    setupAuto();
    setupLivePoll(currentView==='live');
  }
});


/* ── Boot ── */
var LS=document.getElementById('loading-screen');
function hideLS(){ if(LS){ LS.classList.add('hide'); setTimeout(function(){LS.style.display='none';},320); } }
// rede de segurança: nunca deixa a tela de carregamento presa
var lsGuard=setTimeout(hideLS,8000);
refresh().then(function(){
  setupAuto();
  loadLive();            // primeira leitura de presença
  setupLivePoll(false);  // mantém o badge "Ao Vivo" atualizado em segundo plano
  clearTimeout(lsGuard); hideLS();
  // anima a aba inicial (Visão Geral) na primeira pintura
  var a=document.querySelector('section.view.active');
  if(a){ a.classList.add('entering'); setTimeout(function(){a.classList.remove('entering');},700); }
}).catch(function(){
  clearTimeout(lsGuard); hideLS();
});
</script>
</body>
</html>`;
