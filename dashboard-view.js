// Dashboard "Pulse" — servida como HTML estático em /dashboard.
// Todos os dados são carregados via /api/stats, /api/config e /api/health (client-side).
// IMPORTANTE: este arquivo é uma template string — não usar crase nem ${ } no conteúdo.
module.exports = `<!DOCTYPE html>
<html lang="pt" class="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0a0a0b" />
<meta name="color-scheme" content="dark" />
<title>ROI-NADOS — Radar de Vendas & Funil</title>
<link rel="icon" href="/assets/roi-nados-logo.jpg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
:root{
  /* ═══ TEMA GLITCH TIKTOK (derivado da logo ROI-NADOS) ═══ */
  /* Fundo preto neutro (sai o azul-marinho); superfícies em carvão */
  --bg:#08080a; --bg2:#0e0e11; --card:rgba(19,19,22,0.82); --card2:rgba(24,24,28,0.9);
  --border:rgba(255,255,255,0.09); --border2:rgba(37,244,238,0.25);
  --text:#f4f4f5; --text-sub:#d4d4d8; --text-muted:#a1a1aa;
  
  /* Semânticos: ciano = interação · rosa = ao vivo/atenção · verde = SÓ dinheiro */
  --accent:#25f4ee; --accent-light:rgba(37,244,238,0.12); --accent-dark:#0ec2bd;
  --success:#22c55e; --success-light:rgba(34,197,94,0.15);
  --warning:#fbbf24; --warning-light:rgba(251,191,36,0.15);
  --error:#ef4444; --error-light:rgba(239,68,68,0.15);
  --info:#25f4ee;
  --money:#22c55e; --gold:#fbbf24;
  /* Degradê de marca — reservado a: logo, card-herói de Receita e anel do globo */
  --brand-grad:linear-gradient(135deg,#25f4ee,#fe2c55);
  
  /* Estados (4) */
  --hover:rgba(255,255,255,.05); --active:rgba(255,255,255,.08);
  --focus-ring:#25f4ee; --disabled:rgba(255,255,255,.3);
  
  /* Globo-específicas: visita = ciano, checkout = dourado, compra = verde */
  --globe-point-nav:#25f4ee; --globe-point-chk:#fbbf24; --globe-point-buy:#22c55e;
  --globe-poly-base:rgba(255,255,255,.08); --globe-poly-hot:rgba(37,244,238,.18);
  --globe-arc-const:rgba(37,244,238,.08); --globe-graticule:rgba(255,255,255,.02);
  
  /* Vidro (tinta neutra, sem tom azul) */
  --lg-tint:rgba(19,19,22,.45); --lg-tint-thick:rgba(14,14,17,.8);
  --lg-tint-clear:rgba(10,10,11,.2); --lg-tint-brand:rgba(37,244,238,.05);
  --lg-blur:16px; --lg-sat:160%; --lg-bright:1.0;
  --lg-rim-top:rgba(255,255,255,.08); --lg-rim-side:rgba(255,255,255,.04);
  
  /* Motion tokens */
  --dur-fast:150ms; --dur:300ms; --dur-slow:450ms;
  --ease:cubic-bezier(.22,.61,.36,1); --ease-spring:cubic-bezier(.32,.72,.24,1.06);
  --spring:cubic-bezier(.32,.72,.24,1.06);
  
  /* Sombras em camadas (cards flutuam do preto) */
  --shadow-0:none; /* hairline só */
  --shadow-1:0 1px 2px rgba(0,0,0,.5),0 1px 1px rgba(0,0,0,.3);
  --shadow-2:0 1px 2px rgba(0,0,0,.5),0 8px 24px rgba(0,0,0,.45);
  --shadow-3:0 12px 32px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.3);
  --shadow-4:0 24px 64px rgba(0,0,0,.6),0 4px 16px rgba(0,0,0,.35);
  
  /* Tipografia e raios em escala única: cards 14, internos 10, pills 999 */
  --radius:14px; --radius-sm:10px; --radius-md:14px;
  --lh-tight:1.2; --lh-normal:1.55; --lh-relaxed:1.8;
}
:root{
  /* Aliases legados → semânticos (compat com os ~230 usos existentes) */
  --green:var(--success); --red:var(--error); --amber:var(--warning);
  --cyan:var(--accent); /* --cyan É o acento (botões, ícones) */
  --pink:#fe2c55; /* rosa TikTok: "ao vivo", badges, atenção */
  --muted:var(--text-muted); --muted2:#9d9da8; --text-lighter:#b4b4bd;
  --line:var(--border); --ring:var(--focus-ring); --shadow:var(--shadow-3);
}
*{box-sizing:border-box}
html{background:var(--bg);color-scheme:dark;overflow-x:clip}
body{overflow-x:clip}
html,body{margin:0;padding:0}
body{
  background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;font-size:13.5px;line-height:1.55;-webkit-font-smoothing:antialiased;
  font-feature-settings:'cv11','ss01';
}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
h1,h2,h3,h4{font-family:'Inter',system-ui,sans-serif;margin:0;letter-spacing:-.02em;font-weight:600;color:var(--text)}
h1{font-size:21px;font-weight:650}
h2{font-size:16px;font-weight:650;letter-spacing:-.015em}
h3{font-size:14px;font-weight:600}
h4{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted)}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:8px;transition:.3s}
::-webkit-scrollbar-thumb:hover{background:rgba(37,244,238,.4)}
::-webkit-scrollbar-track{background:transparent}
::-selection{background:var(--accent-light);color:var(--text)}

/* ═══ Fundo preto com profundidade + aurora glitch (ciano/rosa da logo) ═══ */
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:-1;
  background:
    /* base: preto neutro com luz radial no topo */
    radial-gradient(1200px at 50% -10%, #131318 0%, #08080a 55%),
    /* grelha de pontos ténue */
    radial-gradient(rgba(255,255,255,.028) 1px, transparent 1px);
  background-size:auto, 28px 28px;
  background-attachment:fixed;
}
body::after{content:'';position:fixed;inset:-20%;pointer-events:none;z-index:-1;
  background:
    /* aurora glitch: um blob ciano e um rosa, opacidade ~5% */
    radial-gradient(700px at 12% 15%, rgba(37,244,238,.06) 0%, transparent 60%),
    radial-gradient(650px at 88% 75%, rgba(254,44,85,.05) 0%, transparent 60%);
  will-change:transform;
  animation:auroraDrift 60s ease-in-out infinite alternate;
}
@keyframes auroraDrift{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(3%,-2%,0)}}
@media(prefers-reduced-motion:reduce){body::after{animation:none}}

/* grain SVG inline (camada 5, sutil a 1.2% para dark theme) */
html{background-image:url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="4" result="noise"/></filter><rect width="100" height="100" fill="rgba(255,255,255,.01)" filter="url(%23n)"/></svg>');}

/* animação dos blobs: dessincronizados (28s, 34s, 41s) */
@keyframes meshFloat1{0%{background-position:0% 0%}50%{background-position:3% -3%}100%{background-position:0% 0%}}
@keyframes meshFloat2{0%{background-position:0% 0%}50%{background-position:-2% 3%}100%{background-position:0% 0%}}
@keyframes meshFloat3{0%{background-position:0% 0%}50%{background-position:2% -2%}100%{background-position:0% 0%}}

/* fundo responde à atividade (aba ativa ou online > 5) via classe dinâmica .bg-active */
@media(prefers-reduced-motion:no-preference){
  body::before{animation:meshFloat1 28s ease-in-out infinite, meshFloat2 34s ease-in-out infinite;background-size:200% 200%}
  body.bg-active::before{animation:meshFloat1 22s ease-in-out infinite, meshFloat2 28s ease-in-out infinite}
}

/* ═══ SISTEMA LIQUID GLASS (iOS 26) — 4 camadas: tint / frost / rim / sheen ═══ */
.lg,.lg-thick,.lg-clear,.lg-tinted{
  position:relative;isolation:isolate;
  background:var(--lg-tint);
  -webkit-backdrop-filter:blur(var(--lg-blur)) saturate(var(--lg-sat)) brightness(var(--lg-bright));
  backdrop-filter:blur(var(--lg-blur)) saturate(var(--lg-sat)) brightness(var(--lg-bright));
  border:1px solid rgba(255,255,255,.18);
  box-shadow:
    var(--shadow-2),
    inset 0 1px 1px var(--lg-rim-top),
    inset 0 -1px 1px rgba(255,255,255,.30),
    inset 1px 0 1px var(--lg-rim-side),
    inset -1px 0 1px var(--lg-rim-side);
}
.lg-thick{background:var(--lg-tint-thick)}
.lg-clear{background:var(--lg-tint-clear);box-shadow:inset 0 1px 1px var(--lg-rim-top),inset 0 -1px 1px rgba(255,255,255,.2)}
.lg-tinted{background:var(--lg-tint-brand)}
/* camada 4: sheen diagonal glossy (screen blend = luz real) */
.lg::after,.lg-thick::after,.lg-tinted::after{
  content:'';position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none;
  background:linear-gradient(135deg,rgba(255,255,255,.45),rgba(255,255,255,.08) 28%,transparent 58%);
  mix-blend-mode:screen;
}
/* tier 2: wobble líquido — só quando o gate confirma Chromium */
html[data-liquid-glass] .lg{
  -webkit-backdrop-filter:blur(var(--lg-blur)) saturate(var(--lg-sat)) brightness(var(--lg-bright)) url(#lg-wobble);
  backdrop-filter:blur(var(--lg-blur)) saturate(var(--lg-sat)) brightness(var(--lg-bright)) url(#lg-wobble);
}
/* tier 3: lente geométrica — SÓ elementos-assinatura pequenos */
html[data-liquid-glass] .lg-lens{
  -webkit-backdrop-filter:blur(var(--lg-blur)) saturate(var(--lg-sat)) brightness(var(--lg-bright)) url(#lg-lens);
  backdrop-filter:blur(var(--lg-blur)) saturate(var(--lg-sat)) brightness(var(--lg-bright)) url(#lg-lens);
}
/* fallback tier 0: sem backdrop-filter */
@supports not (backdrop-filter:blur(1px)){
  .lg,.lg-thick,.lg-clear,.lg-tinted{background:rgba(255,255,255,.92)}
}
/* interatividade do vidro: press morph (rim inverte + afunda) */
.lg-press:active{transform:scale(.97);box-shadow:var(--shadow-1),inset 0 1px 2px rgba(30,40,80,.12),inset 0 -1px 1px rgba(255,255,255,.5)}

/* ═══ MESCLA "LIQUID GLASS" (projeto de referência) ═══
   1) Especular que segue o mouse: Desativado a pedido para visual mais limpo e profissional sem a mancha branca.
   2) Elasticidade: o vidro estica sutilmente na direção do cursor no hover. */
html[data-liquid-glass] .card::before,
html[data-liquid-glass] .lg::before,
html[data-liquid-glass] .lg-thick::before{
  content:'';position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none;
  opacity:0;
}
html[data-liquid-glass] .card:hover::before,
html[data-liquid-glass] .lg:hover::before,
html[data-liquid-glass] .lg-thick:hover::before{opacity:0}

/* 3) Ripple no clique: círculo branco que expande e some em 600ms */
@keyframes liquidRipple{from{transform:translate(-50%,-50%) scale(0);opacity:.5}to{transform:translate(-50%,-50%) scale(1);opacity:0}}
.lg-ripple{position:absolute;border-radius:50%;pointer-events:none;z-index:3;
  background:radial-gradient(circle,rgba(255,255,255,.9),rgba(255,255,255,.3) 60%,transparent);
  mix-blend-mode:screen;animation:liquidRipple .6s ease-out forwards}
/* 4) Wobble elástico ao soltar o clique (oscilação com decaimento) */
@keyframes liquidWobble{0%{transform:scale(.96)}35%{transform:scale(1.02)}60%{transform:scale(.988)}80%{transform:scale(1.006)}100%{transform:scale(1)}}
.lg-wobbling{animation:liquidWobble .55s cubic-bezier(.2,.8,.2,1)}
@media(prefers-reduced-motion:reduce){.lg-ripple,.lg-wobbling{animation:none}}

/* ── Layout ── */
.app{display:flex;flex-direction:column;min-height:100vh}

/* ── Header hero: marca ROI-NADOS + dock ── */
.hero-head{position:relative;background:linear-gradient(180deg,rgba(8,8,10,.97) 0%,rgba(14,14,17,.94) 100%);border-bottom:1px solid var(--border);overflow:hidden}
.hh-glow{position:absolute;inset:-40% -10% auto;height:180%;pointer-events:none;
  background:radial-gradient(520px 220px at 50% 0%, rgba(37,244,238,.06), transparent 65%)}
/* cabeçalho compacto de ~64px: logo pequena + nav + status numa única fila */
.hh-inner{position:relative;display:flex;align-items:center;gap:18px;padding:10px 22px;flex-wrap:wrap}
.brand-xl{display:flex;align-items:center;justify-content:flex-start;gap:12px;flex:0 0 auto;min-width:0}
.logo-orbit{position:relative;width:60px;height:60px;flex-shrink:0}
.logo-orbit img{position:absolute;inset:5px;width:50px;height:50px;border-radius:50%;object-fit:cover;z-index:2;
  box-shadow:0 0 0 1px rgba(255,255,255,.14),0 2px 10px rgba(0,0,0,.6);
  filter:contrast(1.18) saturate(1.25) brightness(1.08)}
.logo-orbit::after{content:'';position:absolute;inset:5px;border-radius:50%;z-index:3;pointer-events:none;
  background:radial-gradient(circle at 32% 26%,rgba(255,255,255,.22),transparent 48%)}
/* animação premium sempre ativa: giro rápido + brilho intenso (antes só no hover) */
.logo-ring{position:absolute;inset:0;border-radius:50%;padding:2px;z-index:1;
  background:conic-gradient(from var(--ra,0deg),#fe2c55,#25f4ee,#fe2c55);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;
  animation:ringSpin 3s linear infinite;
  filter:drop-shadow(0 0 12px rgba(254,44,85,.7))}
@property --ra{syntax:'<angle>';initial-value:0deg;inherits:false}
@keyframes ringSpin{to{--ra:360deg}}
.brand-txt{display:flex;flex-direction:column;gap:2px}
.hh-status{margin-left:auto;display:flex;align-items:center;gap:12px;flex-shrink:0}
.hh-live{font-size:12px;color:var(--text-sub);background:var(--card);border:1px solid var(--border);padding:7px 14px;border-radius:20px;box-shadow:var(--shadow-1)}

/* dock de navegação inline no header compacto */
.nav.dock{position:relative;display:flex;flex-direction:row;gap:6px;padding:0;overflow-x:auto;scrollbar-width:none;flex:1;justify-content:center;min-width:0}
.nav.dock::-webkit-scrollbar{display:none}
.nav.dock button{position:relative;display:flex;align-items:center;gap:8px;cursor:pointer;border:1px solid var(--border2);background:var(--card);color:var(--text-sub);padding:8px 15px;border-radius:10px;font-size:13.5px;font-weight:600;font-family:inherit;transition:.2s;white-space:nowrap}
.nav.dock button .d-ico{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:var(--bg);box-shadow:inset 0 0 0 1px var(--border);transition:.2s;flex-shrink:0}
.nav.dock button svg{width:15px;height:15px}
.nav.dock button:hover{color:var(--text);background:var(--hover);transform:translateY(-2px)}
.nav.dock button:hover .d-ico{background:var(--card2);box-shadow:inset 0 0 0 1px var(--border),var(--shadow-2)}
.nav.dock button.active{color:var(--text);background:transparent;border-color:transparent;box-shadow:none}
.nav.dock.no-gota button.active{background:var(--card);border-color:var(--accent);box-shadow:var(--shadow-2)}
.nav.dock button.active .d-ico{background:rgba(37,244,238,.2);box-shadow:inset 0 0 0 1px rgba(37,244,238,.4), 0 0 8px rgba(37,244,238,.3)}
.nav.dock button.active svg{color:var(--accent)}
/* sublinhado removido — a gota deslizante (#nav-gota) substitui o indicador */
.nav .badge{margin-left:2px;background:var(--error);color:#fff;font-size:11px;font-weight:700;padding:1px 7px;border-radius:20px}
/* dots de presença com respiração (pulsam) */
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--success);margin-right:6px;box-shadow:0 0 8px var(--success);animation:dotBreak 2.4s ease-in-out infinite}
.dot.off{background:var(--error);box-shadow:0 0 8px var(--error);animation:none}
@keyframes dotBreak{0%,100%{box-shadow:0 0 8px var(--success)}50%{box-shadow:0 0 16px var(--success)}}
@media(prefers-reduced-motion:reduce){.dot{animation:none}}

.main{flex:1;min-width:0;display:flex;flex-direction:column}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 26px;background:var(--lg-tint-thick);backdrop-filter:blur(var(--lg-blur)) saturate(var(--lg-sat)) brightness(var(--lg-bright));-webkit-backdrop-filter:blur(var(--lg-blur)) saturate(var(--lg-sat)) brightness(var(--lg-bright));border-bottom:1px solid var(--border);box-shadow:var(--shadow-1),inset 0 1px 1px var(--lg-rim-top);transition:padding .25s var(--ease),box-shadow .25s var(--ease)}
.topbar.condensed{padding:7px 26px;box-shadow:var(--shadow-2),inset 0 1px 1px var(--lg-rim-top)}
.topbar.condensed h1{font-size:17px}
.topbar.condensed{padding:8px 26px}
.topbar.condensed h2{font-size:17px}
/* Escala tipográfica (7 níveis): display 30/700 · h1 21/650 · h2 16/650 · h3 14/600 · eyebrow 11/650 · body 13.5/450 · caption 12/450 */
.topbar h2{font-size:21px;font-weight:650;letter-spacing:-.02em;background:linear-gradient(180deg,var(--text),var(--text-sub));-webkit-background-clip:text;background-clip:text;color:transparent;transition:.3s}
.topbar .sub{font-size:12px;color:var(--text-muted);margin-top:2px}
.spacer{flex:1}
.segment{display:flex;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:2px;gap:2px;max-width:100%;overflow-x:auto;scrollbar-width:none}
/* grupo do topo à direita: busca, atualizar e período */
.tb-right{display:flex;align-items:center;gap:8px;margin-left:auto;position:relative;min-width:0;max-width:100%}
/* mobile: o grupo ocupa a linha inteira e o seletor de período rola horizontal
   (sem estourar a viewport — causava overflow de ~17px em telas de 375px) */
@media(max-width:560px){
  .tb-right{width:100%;margin-left:0}
  .tb-right .segment{flex:1;overflow-x:auto;scrollbar-width:none}
  .tb-right .segment::-webkit-scrollbar{display:none}
  .dr-pop{right:auto;left:0;width:min(320px,calc(100vw - 40px))}
}
#period-custom{display:inline-flex;align-items:center;gap:6px}
#period-custom svg{flex-shrink:0}
#period-custom-lbl:empty{display:none}
#period-custom-lbl{font-size:11px;font-family:'Geist Mono';color:var(--cyan)}
/* popover de segmentação */
.dr-pop{position:absolute;top:calc(100% + 8px);right:0;z-index:60;width:320px;background:var(--card);backdrop-filter:blur(16px) saturate(180%);-webkit-backdrop-filter:blur(16px) saturate(180%);border:1px solid var(--border);border-radius:16px;padding:16px;
  box-shadow:var(--shadow-4),inset 0 1px 1px var(--lg-rim-top);animation:drIn .25s var(--spring)}
@keyframes drIn{from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:none}}
.dr-head{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:14px}
.dr-row{display:flex;gap:10px;margin-bottom:14px}
.dr-field{flex:1;display:flex;flex-direction:column;gap:6px}
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
/* Switch estilo iOS: trilho cinza → verde, knob branco com sombra e spring */
.switch{position:relative;width:44px;height:26px;flex-shrink:0}
.switch input{opacity:0;width:0;height:0}
.slider{position:absolute;inset:0;background:rgba(120,130,155,.35);border-radius:26px;cursor:pointer;
  transition:background .25s var(--ease);box-shadow:inset 0 1px 2px rgba(30,40,80,.15)}
.slider:before{content:'';position:absolute;height:22px;width:22px;left:2px;top:2px;background:#fff;border-radius:50%;
  transition:transform var(--dur) var(--spring),width .15s;
  box-shadow:0 2px 6px rgba(30,40,80,.3),0 0 1px rgba(30,40,80,.2)}
input:checked+.slider{background:var(--success)}
input:checked+.slider:before{transform:translateX(18px)}
/* knob estica ao pressionar (feedback tátil iOS) */
.switch:active .slider:before{width:26px}
.switch:active input:checked+.slider:before{transform:translateX(14px)}
.select,.inp{background:var(--card2);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:8px 12px;font-family:inherit;font-size:13.5px;outline:none;transition:all .2s cubic-bezier(.2,.8,.2,1)}
.select::placeholder,.inp::placeholder{color:var(--text-muted)}
.select:focus,.inp:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-light), inset 0 1px 1px rgba(0,0,0,0.2);background:var(--card)}
/* padrão = botão secundário discreto (Cancelar, Validar, etc.) */
.btn{position:relative;background:var(--card2);color:var(--text);border:1px solid var(--border2);border-radius:10px;padding:9px 16px;font-family:inherit;font-weight:600;font-size:13px;cursor:pointer;transition:all .18s cubic-bezier(.2,.8,.2,1)}
.btn:hover{background:var(--hover);border-color:var(--muted2);color:var(--text)}
.btn:active{transform:scale(.98)}
.btn svg{width:16px;height:16px;display:block}
/* .primary = ação principal em accent, texto escuro consistente e brilho contido */
.btn.primary{background:var(--accent);color:#08080a;border-color:transparent;font-weight:700;box-shadow:none}
.btn.primary:hover{background:var(--accent-dark);color:#08080a;filter:none}
.btn.danger{border-color:rgba(239,68,68,.3);color:var(--error);background:transparent}
.btn.danger:hover{background:var(--error-light);border-color:rgba(239,68,68,.5);transform:translateY(-1.5px)}
.btn-sm{padding:5px 11px;font-size:12px;border-radius:8px}
.btn-icon{background:var(--card2);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:6px 9px;cursor:pointer;font-size:11px;font-family:inherit;font-weight:600;transition:all .18s ease;white-space:nowrap}
.btn-icon:hover{background:var(--hover);color:var(--text);border-color:var(--border2);transform:translateY(-1px)}

.content{padding:28px 30px 90px;max-width:1440px;margin:0 auto;width:100%}
/* Uma seção por vez: só a aba ativa fica visível */
section.view{display:none}
section.view.active{display:block;animation:fade .3s ease}
/* sections empilhadas no mesmo grupo: divisor sutil entre elas */
section.view.active~section.view.active{margin-top:34px;padding-top:30px;border-top:1px solid var(--border)}
/* cabeçalho de bloco (aparece só quando a section está empilhada num grupo) */
.block-head{display:none;align-items:center;gap:12px;margin:0 0 18px}
section.view.active~section.view.active .block-head{display:flex}
.block-head .bh-ico{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--card2);flex-shrink:0;box-shadow:inset 0 0 0 1px var(--border)}
.block-head .bh-ico svg{width:18px;height:18px;color:var(--cyan)}
.block-head h2{font-size:18px;font-weight:700;line-height:1.1}
.block-head p{font-size:12.5px;color:var(--muted2);margin-top:1px}
/* quando empilhada, o primeiro section-title da section não precisa de margin-top */
section.view.active~section.view.active .section-title:first-of-type{margin-top:0}
@keyframes fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
/* Cabeçalho âncora de cada seção */
.view-head{display:flex;align-items:center;gap:12px;margin:0 0 18px}
.view-head .vh-ico{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:var(--card2);flex-shrink:0;box-shadow:inset 0 0 0 1px var(--border)}
.view-head .vh-ico svg{width:22px;height:22px;color:var(--cyan)}
.view-head h2{font-size:26px;line-height:1.05}
.view-head .vh-sub{font-size:13.5px;color:var(--muted2);margin-top:3px}
/* Revelação ao rolar */
.reveal{opacity:0;transform:translateY(22px);transition:opacity .6s cubic-bezier(.2,.8,.2,1),transform .6s cubic-bezier(.2,.8,.2,1)}
.reveal.in{opacity:1;transform:none}
/* stagger de KPIs: cada card entra 60ms depois do anterior (cascata iOS) */
@keyframes kpiRise{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:none}}
.kpis .kpi,.ministats .mstat{animation:kpiRise .55s var(--spring) backwards}
.kpis .kpi:nth-child(1),.ministats .mstat:nth-child(1){animation-delay:.02s}
.kpis .kpi:nth-child(2),.ministats .mstat:nth-child(2){animation-delay:.08s}
.kpis .kpi:nth-child(3),.ministats .mstat:nth-child(3){animation-delay:.14s}
.kpis .kpi:nth-child(4),.ministats .mstat:nth-child(4){animation-delay:.20s}
.kpis .kpi:nth-child(5),.ministats .mstat:nth-child(5){animation-delay:.26s}
.kpis .kpi:nth-child(n+6),.ministats .mstat:nth-child(n+6){animation-delay:.32s}
@media(prefers-reduced-motion:reduce){.kpis .kpi,.ministats .mstat{animation:none}}

/* ── Loading skeleton ── */
#loading-screen{position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:100;flex-direction:column;gap:12px;transition:opacity .3s}
#loading-screen.hide{opacity:0;pointer-events:none}
.spin{width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--cyan);border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.load-text{font-size:13.5px;color:var(--muted);font-weight:500}

/* ── Cards & KPIs ── */
.grid{display:grid;gap:16px}
.dynamic-grid{display:grid;grid-template-columns:1fr;gap:16px;transition:all .3s cubic-bezier(.25,.8,.25,1)}
.dynamic-grid.form-open{grid-template-columns:1.2fr 1fr}
@media(max-width:860px){.dynamic-grid.form-open{grid-template-columns:1fr}}
@media(max-width:768px){.step-line{display:none!important}}
/* KPIs em grelha fixa: 4 → 2 → 1 (acaba o card órfão do auto-fit) */
.kpis{grid-template-columns:repeat(4,1fr)}
@media(max-width:1100px){.kpis{grid-template-columns:repeat(2,1fr)}}
@media(max-width:560px){.kpis{grid-template-columns:1fr}}

.card{
  position:relative;isolation:isolate;
  background:var(--card);
  backdrop-filter:blur(8px) saturate(140%);
  -webkit-backdrop-filter:blur(8px) saturate(140%);
  border:1px solid var(--border);border-radius:var(--radius);padding:18px 20px;
  box-shadow:var(--shadow-2),inset 0 1px 0 rgba(255,255,255,.06);
  transition:transform .2s var(--ease),box-shadow .2s var(--ease),border-color .2s var(--ease);
}
.card:hover{transform:translateY(-2px);box-shadow:var(--shadow-3),inset 0 1px 0 rgba(255,255,255,.06);border-color:rgba(37,244,238,.25)}
.card::after{content:'';position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none;
  background:linear-gradient(135deg,rgba(255,255,255,.04),rgba(255,255,255,.01) 28%,transparent 58%);mix-blend-mode:screen}
@supports not (backdrop-filter:blur(1px)){.card{background:var(--card)}}
.card.tint-cyan,.card.tint-pink,.card.tint-green,.card.tint-amber{background:var(--card)}
.kpi .k-top{display:flex;align-items:center;gap:8px;color:var(--text-muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.1em}
.kpi .k-val{font-family:'Geist Mono',monospace;font-weight:800;font-size:34px;margin-top:12px;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums;color:var(--text)}
.kpi .k-val.pos{color:var(--success)}
.kpi .k-val.cyn{color:var(--info)}
.kpi .k-val.amb{color:var(--warning)}
.kpi .k-val.pnk{color:var(--error)}
.kpi .k-val.mut{color:var(--text-muted)}
.kpi .k-sub{font-size:12px;color:var(--text-muted);margin-top:7px}
.k-val.small{font-size:25px}
.k-val.xsmall{font-size:19px}
.k-ico.ic-cyan{background:rgba(37,244,238,.12);color:var(--cyan)}
.k-ico.ic-pink{background:rgba(254,44,85,.12);color:var(--pink)}
.k-ico.ic-green{background:rgba(34,197,94,.12);color:var(--green)}
.k-ico.ic-amber{background:rgba(245,181,68,.12);color:var(--amber)}
.hl-card .k-flag{display:inline-flex;align-items:center;gap:8px}
.hl-card .k-flag .fi{font-size:20px;line-height:1}
/* ── Ao Vivo ── */
.nav .live-badge{background:var(--success);color:#fff}
  #live-globe{width:100%;height:520px;border-radius:var(--radius);overflow:hidden;position:relative;
  background:radial-gradient(circle at 50% 50%, #121216 0%, #060608 100%) !important;border:1px solid rgba(37,244,238,.2);box-shadow:0 24px 64px rgba(0,0,0,0.85), inset 0 0 60px rgba(0,0,0,0.7)}
/* filtro CSS por-frame removido: re-filtrava o canvas inteiro a cada frame do globo */
/* ── Globo hero na Visão Geral ── */
#globe-hero{width:100%;height:560px;border-radius:var(--radius);overflow:hidden;position:relative;
  background:var(--card);border:1px solid var(--border);box-shadow:var(--shadow-3);
  grid-column:1/-1;margin:24px 0}
#globe-hero::after{content:'';position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 1px 2px rgba(255,255,255,.04);pointer-events:none;z-index:1}
/* skeleton do globo: shimmer radial */
.globe-skel{width:100%;height:560px;border-radius:var(--radius);background:linear-gradient(135deg,var(--card),var(--card2));overflow:hidden;position:relative;margin:24px 0}
.globe-skel::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(255,255,255,.05),transparent 70%);animation:skelShimmer 1.4s ease-in-out infinite}
/* badge de presença sobre o globo (vidro claro) */
.globe-badge{position:absolute;top:14px;left:14px;z-index:5;display:flex;align-items:center;gap:8px;
  font-size:12px;color:var(--text);background:var(--card);border:1px solid var(--border);
  padding:7px 13px;border-radius:20px;backdrop-filter:blur(12px) saturate(180%);box-shadow:var(--shadow-2),inset 0 1px 1px var(--lg-rim-top)}
.globe-badge b{font-family:'Geist Mono';color:var(--success)}
/* card do globo: controles flutuantes em vidro (tier 3 candidato à lente) */
.globe-card{position:relative;overflow:hidden}
.globe-tools{position:absolute;top:14px;right:14px;z-index:5;display:flex;flex-direction:column;gap:6px;
  background:var(--card2);border:1px solid var(--border);border-radius:12px;padding:6px;
  backdrop-filter:blur(12px) saturate(180%);-webkit-backdrop-filter:blur(12px) saturate(180%);
  box-shadow:var(--shadow-2),inset 0 1px 1px var(--lg-rim-top)}
html[data-liquid-glass] .globe-tools{backdrop-filter:blur(12px) saturate(180%) url(#lg-lens);-webkit-backdrop-filter:blur(12px) saturate(180%) url(#lg-lens)}
.gt-btn{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;border:0;background:transparent;color:var(--text-muted);cursor:pointer;transition:.18s}
.gt-btn svg{width:16px;height:16px}
.gt-btn:hover{background:var(--hover);color:var(--accent-dark);transform:scale(1.08)}
.gt-btn:active{transform:scale(.94)}
.gt-div{height:1px;background:var(--border);margin:1px 4px}
.globe-hint{position:absolute;left:14px;bottom:12px;z-index:5;font-size:10.5px;color:var(--text-muted);letter-spacing:.06em;
  background:var(--card);border:1px solid var(--border);padding:4px 10px;border-radius:14px;backdrop-filter:blur(8px);pointer-events:none;opacity:.9}
/* layout: globo + painel lateral de presença */
.globe-wrap{display:grid;grid-template-columns:1fr 340px;gap:16px;margin-bottom:16px}
@media(max-width:960px){.globe-wrap{grid-template-columns:1fr}}
.globe-side{display:flex;flex-direction:column;gap:12px;min-width:0}
.gs-stats{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.gs-stat{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:12px;transition:.2s}

.gs-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.gs-dot.grn-d{background:var(--green)}
.gs-dot.pnk-d{background:var(--pink)}
.gs-txt{display:flex;flex-direction:column;line-height:1.2}
.gs-txt b{font-family:'Geist Mono';font-size:19px}
.gs-txt span{font-size:10.5px;color:var(--muted2);text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.gs-leads{padding:0;flex:1;display:flex;flex-direction:column;overflow:hidden}
.gs-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border);font-size:12.5px;font-weight:700}
.gs-all{margin-left:auto;background:none;border:1px solid var(--border);color:var(--muted);font-size:11px;font-weight:600;padding:4px 10px;border-radius:7px;cursor:pointer;transition:.2s}
.gs-all:hover{color:var(--text);border-color:var(--cyan);box-shadow:0 0 10px -4px var(--cyan)}
.gs-list{flex:1;overflow-y:auto}
.gs-row{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--border);font-size:12px;animation:kpiIn .35s ease backwards}
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
/* CRÍTICO: display:grid acima vence o display:none do atributo [hidden] —
   sem esta regra o modal invisível cobre a tela e engole TODOS os cliques */
.globe-modal[hidden]{display:none}
.gm-scrim{position:absolute;inset:0;background:rgba(40,50,80,.3);backdrop-filter:blur(10px) saturate(130%);opacity:0;transition:opacity .4s ease}
.gm-panel{position:relative;width:min(1240px,95vw);height:min(88vh,920px);opacity:0;transform:scale(.9) translateY(22px);
  transition:opacity .45s cubic-bezier(.2,.8,.3,1),transform .45s cubic-bezier(.2,.8,.3,1)}
.globe-modal.open .gm-scrim{opacity:1}
.globe-modal.open .gm-panel{opacity:1;transform:none}
.gm-body{width:100%;height:100%}
.gm-body .globe-card{height:100%;border-radius:18px;box-shadow:var(--shadow-4),inset 0 1px 1px var(--lg-rim-top)}
.gm-body #live-globe{height:100%!important;border-radius:18px}
.gm-close{position:absolute;top:-14px;right:-14px;z-index:6;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;cursor:pointer;
  background:var(--card);border:1px solid var(--border2);color:var(--muted);transition:.25s cubic-bezier(.34,1.56,.64,1)}
.gm-close svg{width:16px;height:16px}
.gm-close:hover{color:var(--text);transform:scale(1.15) rotate(90deg);border-color:var(--pink);box-shadow:0 0 14px -4px var(--pink)}
/* fundo do globo: aurora em drift lento + vinheta de profundidade e brilho espacial */
#live-globe::before{content:'';position:absolute;inset:-40%;z-index:0;pointer-events:none;
  background:
    radial-gradient(45% 45% at 50% 50%,rgba(37,244,238,.22) 0%,transparent 65%),
    radial-gradient(35% 35% at 30% 35%,rgba(254,44,85,.14) 0%,transparent 60%),
    radial-gradient(40% 40% at 75% 65%,rgba(37,244,238,.12) 0%,transparent 65%);
  animation:auroraDrift 18s ease-in-out infinite alternate;will-change:transform;
  filter:blur(15px);opacity:0.9}
#live-globe::after{content:'';position:absolute;inset:0;z-index:1;pointer-events:none;border-radius:inherit;
  box-shadow:inset 0 0 110px rgba(0,0,0,0.9), inset 0 0 40px rgba(37,244,238,0.22), 0 0 50px rgba(37,244,238,0.08);
  animation:globePulse 4s ease-in-out infinite alternate}
@keyframes globePulse{from{box-shadow:inset 0 0 110px rgba(0,0,0,0.9), inset 0 0 35px rgba(37,244,238,0.18), 0 0 40px rgba(37,244,238,0.05)}to{box-shadow:inset 0 0 110px rgba(0,0,0,0.9), inset 0 0 45px rgba(37,244,238,0.26), 0 0 60px rgba(37,244,238,0.12)}}
@keyframes auroraDrift{from{transform:rotate(0deg) scale(1)}to{transform:rotate(12deg) scale(1.12)}}
@media(prefers-reduced-motion:reduce){#live-globe::before,#globe::before{animation:none}}
.live-grid{display:grid;grid-template-columns:1fr 340px;gap:16px}
.live-grid>.card{min-width:0}
#live-globe canvas{max-width:100%}
@media(max-width:1000px){.live-grid{grid-template-columns:1fr}}
.live-list-card{padding:0;max-height:560px;overflow-y:auto}
.live-list{display:flex;flex-direction:column}
/* pills semânticas: sucesso, warning, error, info */
.live-pill{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--success);background:var(--success-light);border:1px solid rgba(34,197,94,.3);padding:4px 11px;border-radius:20px;box-shadow:var(--shadow-1)}
.live-pill.warn{color:var(--warning);background:var(--warning-light);border-color:rgba(217,151,6,.3)}
.live-pill.err{color:var(--error);background:var(--error-light);border-color:rgba(220,38,38,.3)}
.live-pill.info{color:var(--accent-dark);background:var(--accent-light);border-color:rgba(47,125,255,.3)}
.live-dot-anim{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 0 rgba(34,197,94,.6);animation:livePulse 1.6s infinite}
@keyframes livePulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}70%{box-shadow:0 0 0 7px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.lrow{display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border);transition:all .22s cubic-bezier(.2,.8,.2,1);cursor:pointer;border-radius:6px}
.lrow:last-child{border-bottom:0}
.lrow:hover{background:var(--hover);transform:translateX(3px);border-bottom-color:transparent}
.lrow .lflag{font-size:22px;line-height:1;flex-shrink:0}
.lrow .lmain{min-width:0;flex:1}
.lrow .lmain b{display:block;font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lrow .lmain span{display:block;font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.lrow .ldur{font-size:11px;color:var(--text-muted)}
.lrow .ldot{width:7px;height:7px;border-radius:50%;background:var(--green);flex-shrink:0;box-shadow:0 0 8px var(--green)}
.lrow.idle .ldot{background:var(--amber);box-shadow:0 0 8px var(--amber)}
/* lead quente: passou pelo funil e está no checkout agora */
.lrow.hot{position:relative;background:linear-gradient(90deg,rgba(254,44,85,.09),rgba(254,44,85,.02) 60%,transparent);border-left:3px solid var(--pink);padding-left:11px}
.lrow.hot:hover{background:linear-gradient(90deg,rgba(254,44,85,.14),rgba(254,44,85,.04) 60%,transparent)}
.lrow.hot .ldot{background:var(--pink);box-shadow:0 0 9px var(--pink);animation:hotDot 1.3s ease-in-out infinite}
@keyframes hotDot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.45);opacity:.75}}
.lrow.hot .lmain b{color:var(--pink)}
.lck{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  padding:3px 9px;border-radius:20px;background:rgba(254,44,85,.16);color:var(--pink);border:1px solid rgba(254,44,85,.35)}
.lck svg{width:11px;height:11px}
.lfun{font-size:11px;color:var(--muted);background:var(--card2);border:1px solid var(--border);padding:2px 7px;border-radius:12px;font-family:'Geist Mono'}
.lhot-head{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:700;color:var(--pink);text-transform:uppercase;letter-spacing:.09em;
  padding:10px 14px;border-bottom:1px solid rgba(254,44,85,.25);background:rgba(254,44,85,.06);position:sticky;top:0;z-index:2;backdrop-filter:blur(6px)}
.lhot-dot{width:8px;height:8px;border-radius:50%;background:var(--pink);box-shadow:0 0 10px var(--pink);animation:hotDot 1.3s ease-in-out infinite}
.live-empty{padding:48px 24px;text-align:center;color:var(--text-sub);font-size:13px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;opacity:0.85}
.live-empty svg{color:var(--accent);filter:drop-shadow(0 0 8px var(--accent-light));opacity:0.75;margin-bottom:4px}
/* Entrada escalonada de cima para baixo */
@keyframes liveRowIn{0%{opacity:0;transform:translateY(-14px)}60%{opacity:1}100%{opacity:1;transform:translateY(0)}}
.lrow.enter{animation:liveRowIn .5s cubic-bezier(.2,.8,.2,1) both}
.lrow.fresh{background:linear-gradient(90deg,rgba(34,197,94,.12),transparent 60%)}
.lrow .lnew{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#fff;background:var(--success);padding:2px 6px;border-radius:20px;margin-right:2px}
/* ── Pulso de tráfego ── */
.traffic-card{display:grid;grid-template-columns:auto 1fr auto;gap:20px;align-items:center;position:relative;overflow:hidden;border-radius:14px;margin-top:16px}
@media(max-width:760px){.traffic-card{grid-template-columns:1fr;gap:12px}}
.tf-now{display:flex;flex-direction:column;gap:3px}
.tf-now .tf-big{font-family:'Geist Mono';font-size:34px;line-height:1;font-weight:700}
.tf-now .tf-lbl{font-size:11.5px;color:var(--muted2)}
.tf-now .tf-avg{font-size:11px;color:var(--muted2);margin-top:4px;background:var(--card2);border:1px solid var(--border);padding:3px 9px;border-radius:12px;width:max-content}
.tf-now .tf-avg b{color:var(--cyan);font-family:'Geist Mono'}
.tf-mid{display:flex;flex-direction:column;gap:6px;min-width:0}
.tf-bars{display:flex;align-items:flex-end;gap:3px;height:64px;min-width:0}
.tf-bars .tb{flex:1;min-width:2px;border-radius:3px 3px 0 0;background:linear-gradient(180deg,var(--cyan),rgba(47,125,255,.5));opacity:.55;transition:height .5s cubic-bezier(.2,.8,.2,1),opacity .3s;transform-origin:bottom;cursor:default}
.tf-bars .tb:hover{opacity:1;box-shadow:0 0 8px rgba(6,182,212,.5)}
.tf-bars .tb.hot{background:linear-gradient(180deg,var(--amber),rgba(217,119,6,.55));opacity:1;box-shadow:0 0 8px rgba(217,119,6,.4)}
.tf-bars .tb.cur{opacity:1;background:var(--accent)}
.tf-axis{display:flex;justify-content:space-between;font-size:11px;color:var(--muted2);font-family:'Geist Mono';letter-spacing:.03em;padding:0 1px}
.tf-axis .ax-now{color:var(--pink);font-weight:600}
.tf-trend{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:700;padding:8px 14px;border-radius:12px;white-space:nowrap}
.tf-trend svg{width:15px;height:15px}
.tf-trend.up{color:var(--green);background:rgba(34,197,94,.13)}
.tf-trend.down{color:var(--red);background:rgba(220,38,38,.13)}
.tf-trend.flat{color:var(--muted2);background:var(--card2)}
.tf-trend.hot{color:var(--amber);background:rgba(217,119,6,.14)}
.tf-sub{grid-column:1/-1;font-size:12px;color:var(--muted2);border-top:1px solid var(--border);padding-top:12px;margin-top:2px;display:flex;gap:16px;flex-wrap:wrap;align-items:center}
.tf-sub b{color:var(--text);font-family:'Geist Mono'}
.tf-sub .tfs{display:inline-flex;align-items:center;gap:8px}
.tf-sub .tfd{width:7px;height:7px;border-radius:50%;flex-shrink:0;box-shadow:0 0 7px currentColor}
.tf-sub .tfm{color:var(--muted2);font-size:11px}
/* ── Notificações ── */
.notif-head{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;border-bottom:1px solid var(--border)}
.notif-head .nh-title{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700}
.notif-head .nh-title .live-dot-anim{width:7px;height:7px}
.notif-tools{display:flex;align-items:center;gap:6px}
.icon-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--muted);cursor:pointer;transition:.15s}
/* botões utilitários do topo (busca/atualizar): fantasma — o ciano cheio gritava
   mais que os próprios dados; o preenchido fica só para ações primárias */
#cmdk-open,#refresh-btn{background:var(--card);color:var(--accent);border:1px solid var(--border2);box-shadow:none}
#cmdk-open:hover,#refresh-btn:hover{background:var(--accent-light);border-color:var(--accent)}
.icon-btn:hover{color:var(--text);border-color:var(--border2)}
.icon-btn svg{width:16px;height:16px}
.icon-btn.on{color:var(--green);border-color:rgba(34,197,94,.4);background:rgba(34,197,94,.1)}
.notif-list{max-height:300px;overflow-y:auto;padding:6px}
.nrow{display:flex;align-items:flex-start;gap:12px;padding:10px 11px;border-radius:10px;animation:liveRowIn .45s cubic-bezier(.2,.8,.2,1) both}
.nrow:hover{background:var(--hover)}
.nrow .nico{width:30px;height:30px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.nrow .nico svg{width:15px;height:15px}
.nrow .nico.visit{background:rgba(47,125,255,.14);color:var(--blue)}
.nrow .nico.checkout{background:rgba(217,119,6,.14);color:var(--amber)}
.nrow .nico.sale{background:rgba(34,197,94,.14);color:var(--green)}
.nrow .nico.spike{background:rgba(220,38,38,.14);color:var(--pink)}
.nrow .nbody{min-width:0;flex:1}
.nrow .nbody b{font-size:12.5px;font-weight:600;color:var(--text);display:block}
.nrow .nbody span{font-size:11px;color:var(--muted2)}
.nrow .ntime{font-size:10.5px;color:var(--muted2);flex-shrink:0;margin-top:2px}
.notif-empty{padding:34px 18px;text-align:center;color:var(--muted2);font-size:12.5px}
.live-right{display:flex;flex-direction:column;gap:16px;min-width:0}
.pos{color:var(--green)} .neg{color:var(--red)} .cyn{color:var(--cyan)} .pnk{color:var(--pink)} .amb{color:var(--amber)} .grn{color:var(--green)}
/* Valores de KPI com cor semântica — sem glow; zero = neutro (sem falso alarme/celebração) */
.k-val .pos,.k-val .grn{color:var(--success)}
.k-val .cyn,.k-val .blu{color:var(--info)}
.k-val .pnk{color:var(--error)}
.k-val .amb{color:var(--warning)}
.k-val .mut,.k-sub .mut{color:var(--text-muted)}

  .section-title{display:flex;align-items:center;gap:10px;margin:38px 0 18px;font-size:15.5px;font-weight:700;color:#ffffff;flex-wrap:wrap;min-width:0;letter-spacing:-0.015em}
.section-title span:first-child{position:relative;padding-left:16px}
.section-title span:first-child::before{content:'';position:absolute;left:2px;top:50%;transform:translateY(-50%);width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 6px var(--accent)}
  /* passos numerados dos cards de instrução (snippet, webhook) */
  .steps{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:14px}
  .step{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text)}
  .step b{display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--kg1,var(--pink));color:#fff;font-size:11.5px;flex:none}
  .mini-feats{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}
  .mini-feats span{font-size:12px;color:var(--muted2);display:flex;align-items:center;gap:6px}
  .mini-feats span::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--kg1,var(--pink));flex:none}
  /* tutorial passo a passo (instalação do script) */
  .tut-step{display:flex;gap:16px;align-items:flex-start;padding:18px 20px;border:1px solid var(--border);background:var(--card2);border-radius:12px;margin-bottom:16px;transition:all .25s cubic-bezier(.2,.8,.2,1)}
  .tut-step:hover{border-color:var(--border2);box-shadow:0 12px 32px rgba(0,0,0,.5);transform:translateY(-1.5px)}
  .tut-n{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#25f4ee 0%,#fe2c55 100%);color:#fff;font-size:14px;font-weight:800;flex:none;box-shadow:0 0 12px rgba(37,244,238,.25)}
  .tut-txt{flex:1;min-width:0}
  .tut-txt>b{font-size:15px;color:var(--text);font-weight:700;letter-spacing:.02em}
  .tut-txt p{margin:8px 0 0;font-size:13.5px;color:var(--text-sub);line-height:1.65}
  .tut-list{margin:10px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:8px}
  .tut-list li{font-size:13px;color:var(--text-sub);line-height:1.65}
  .tut-list li b{color:var(--text);font-weight:600}
  /* Mockups interativos para os tutoriais */
  .mock-container{background:#0a0c16;border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-top:14px;box-shadow:0 12px 36px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,0.03);transition:all .22s ease}
  .mock-container:hover{border-color:var(--border2);box-shadow:0 16px 44px rgba(0,0,0,.6)}
  .mock-header{background:#0e111e;border-bottom:1px solid rgba(255,255,255,.05);padding:10px 14px;display:flex;align-items:center;gap:6px}
  .mock-dot{width:8.5px;height:8.5px;border-radius:50%;background:#ff5f56;flex-shrink:0}
  .mock-dot:nth-child(2){background:#ffbd2e}
  .mock-dot:nth-child(3){background:#27c93f}
  .mock-title{font-size:11.5px;color:var(--text-muted);margin-left:8px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mock-body{padding:16px;font-size:12.5px;color:var(--text-sub)}
  .mock-code-box{background:#060608;border-radius:8px;padding:12px;margin:10px 0;font-family:'Geist Mono',monospace;font-size:11.5px;color:#7ff7f3;border-left:3px solid var(--pink);position:relative;overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.5)}
  .btn-xs{padding:3px 9px;font-size:10.5px;border-radius:6px;font-weight:700;letter-spacing:0.02em;box-shadow:0 2px 6px rgba(0,0,0,0.25)}
  .mock-pointer{display:inline-flex;align-items:center;gap:6px;color:var(--pink);font-weight:700;font-size:11.5px;margin-top:6px;animation:mockBounce 1.2s ease-in-out infinite alternate}
  @keyframes mockBounce{from{transform:translateX(0)}to{transform:translateX(8px)}}
  /* linha do tempo do trajeto do lead (drawer) */
  .jrny{display:flex;flex-direction:column;gap:0;margin:4px 0 10px;padding-left:5px}
  .jstep{display:flex;align-items:center;gap:10px;position:relative;padding:5px 0 5px 14px}
  .jstep::before{content:'';position:absolute;left:2px;top:0;bottom:0;width:2px;background:var(--line,rgba(255,255,255,.08))}
  .jstep:first-child::before{top:50%}
  .jstep:last-child::before{bottom:50%}
  .jdot{position:absolute;left:-1px;width:8px;height:8px;border-radius:50%;background:var(--muted2);flex:none}
  .jstep.go .jdot{background:var(--amber,#f5a524)}
  .jstep.buy .jdot{background:var(--green,#2fbf71)}
  .jstep.clk .jdot{background:var(--kg1,#25f4ee)}
  .jp{font-size:12.5px;color:var(--text);font-family:'Geist Mono',monospace;word-break:break-all}
  .jstep.buy .jp{color:var(--green,#2fbf71);font-weight:600}
  .jstep.clk .jp{color:var(--kg1,#25f4ee)}
  .jdelta{font-size:10.5px;color:var(--muted2);font-family:'Geist Mono',monospace;background:var(--line,rgba(255,255,255,.07));border-radius:4px;padding:1px 5px;margin-left:4px}
  .jt{font-size:11px;color:var(--muted2);margin-left:auto;flex:none}
  /* KPIs de saúde da CAPI (aba Pixel) */
  .ph-kpis{display:flex;gap:28px;flex-wrap:wrap}
  .ph-k{display:flex;flex-direction:column;gap:3px}
  .ph-v{font-family:'Geist Mono',monospace;font-size:23px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
  .ph-v.pos{color:var(--green)}
  .ph-v.amb{color:var(--amber)}
  .ph-v.neg{color:var(--red)}
  .ph-l{font-size:11px;color:var(--muted2)}
  .ph-err{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--red);padding:4px 0}
  .ph-err .pe-t{color:var(--muted2);font-size:11px;margin-left:auto;flex:none}
  /* Funil por página (Visão Geral) */
  .pf-row{display:flex;align-items:center;gap:12px;padding:7px 0}
  .pf-lbl{width:180px;flex:none;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:'Geist Mono',monospace}
  .pf-track{flex:1;height:26px;background:var(--card2);border-radius:7px;overflow:hidden;position:relative}
  .pf-track i{display:block;height:100%;border-radius:7px;width:0;transition:width .7s cubic-bezier(.22,1,.36,1)}
  .pf-n{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:11.5px;font-weight:600;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6);font-variant-numeric:tabular-nums}
  .pf-pct{width:52px;flex:none;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;font-weight:600}
  .pf-drop{display:flex;align-items:center;gap:6px;padding:0 0 0 192px;font-size:11px;color:var(--red)}
  .pf-drop svg{width:11px;height:11px}
  @media(max-width:720px){.pf-lbl{width:110px}.pf-drop{padding-left:122px}}
  /* Comparador de páginas de entrada */
  .en-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
  .en-tbl th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted2);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line,rgba(255,255,255,.07))}
  .en-tbl td{padding:9px 10px;border-bottom:1px solid var(--line,rgba(255,255,255,.05));font-variant-numeric:tabular-nums}
  .en-tbl tr:last-child td{border-bottom:none}
  .en-tbl .en-p{font-family:'Geist Mono',monospace;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .en-tbl .num{text-align:right}
  .en-best td{background:rgba(34,197,94,.05)}
  .en-badge{display:inline-block;font-size:9.5px;font-weight:700;color:#22c55e;border:1px solid rgba(34,197,94,.4);border-radius:5px;padding:1px 6px;margin-left:6px;vertical-align:1px}
  /* Heatmap de horários */
  .hm-grid{display:grid;grid-template-columns:34px repeat(24,1fr);gap:2px;font-size:9.5px}
  .hm-lbl{color:var(--muted2);display:flex;align-items:center;justify-content:flex-end;padding-right:6px}
  .hm-cell{aspect-ratio:1.5/1;border-radius:3px;background:var(--card2);min-width:0;cursor:default}
  .hm-top{display:flex;align-items:center;justify-content:center;color:var(--muted2);padding-bottom:2px}
  .hm-foot{display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-top:8px;font-size:10.5px;color:var(--muted2)}
  .hm-foot i{width:11px;height:11px;border-radius:3px;display:inline-block}
  .sl-slug{font-family:'Geist Mono',monospace;color:var(--cyan);flex:none}
  /* Notas do gráfico */
  .note-add{background:none;border:1px dashed var(--line,rgba(255,255,255,.15));border-radius:7px;color:var(--muted2);font-size:11px;padding:3px 9px;cursor:pointer;margin-right:8px;flex:none;transition:color .15s,border-color .15s}
  .note-add:hover{color:var(--text);border-color:var(--muted2)}
  .note-dot{cursor:pointer}
  .chart-notes{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .cn-item{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);background:var(--card2);border-radius:7px;padding:3px 8px}
  .cn-item b{color:var(--amber,#f5a524);font-weight:600;font-family:'Geist Mono',monospace}
  .cn-x{cursor:pointer;color:var(--muted2);border:none;background:none;padding:0 0 0 2px;font-size:13px;line-height:1}
  .cn-x:hover{color:var(--red)}
  /* Tooltip do gráfico de tendência */
  .chart-wrap{position:relative}
  .chart-tip{position:absolute;pointer-events:none;background:var(--card2);backdrop-filter:blur(12px) saturate(180%);border:1px solid var(--border);border-radius:10px;padding:7px 10px;font-size:12px;z-index:5;box-shadow:var(--shadow-3),inset 0 1px 1px var(--lg-rim-top);white-space:nowrap}
  .chart-tip b{display:block;font-family:'Geist Mono',monospace;font-size:14px}
  .chart-tip span{color:var(--muted2);font-size:10.5px}
.section-title .line{flex:1;height:1px;background:linear-gradient(90deg, var(--border2), var(--border) 60%, transparent);opacity:0.85}
/* legenda à direita do título: leve, não compete com o título (que é 700) */
.section-title .muted{font-weight:500;letter-spacing:0}
/* badges de estado do domínio: pill âmbar (pendente) / verde (validado) */
.badge-warn{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;color:var(--warning);background:var(--warning-light);border:1px solid rgba(251,191,36,.3);width:max-content;max-width:100%}
.badge-warn::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--warning)}
.badge-ok{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;color:var(--success);background:var(--success-light);border:1px solid rgba(34,197,94,.3);width:max-content;max-width:100%}
.badge-ok::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--success)}

/* ── Gráfico ── */
.chart-wrap{position:relative;min-height:220px;width:100%}
.chart-legend{display:flex;gap:18px;font-size:12px;color:var(--muted);margin-top:12px;flex-wrap:wrap}
.leg-dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:middle}

/* ── Funil ── */
.funnel{display:flex;flex-direction:column;gap:12px}
.fstep{display:flex;align-items:center;gap:12px}
.fbar-track{flex:1;height:48px;background:var(--card2);border-radius:12px;overflow:hidden;position:relative}
.fbar{height:100%;border-radius:12px;display:flex;align-items:center;padding:0 16px;font-weight:700;font-family:'Geist Mono';color:#fff;min-width:54px;transition:width .7s cubic-bezier(.2,.8,.2,1)}
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
/* dados novos entram animados (tabelas só repintam quando os dados mudam) */
tbody tr{animation:rowIn .38s cubic-bezier(.2,.8,.3,1) backwards}
tbody tr:nth-child(1){animation-delay:.03s}tbody tr:nth-child(2){animation-delay:.07s}
tbody tr:nth-child(3){animation-delay:.11s}tbody tr:nth-child(4){animation-delay:.15s}
tbody tr:nth-child(5){animation-delay:.19s}tbody tr:nth-child(6){animation-delay:.23s}
@keyframes rowIn{from{opacity:0;transform:translateY(-7px)}to{opacity:1;transform:none}}
.tag{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;border:1px solid var(--border2)}
.tag.visit{color:var(--muted);background:var(--card2)}
.tag.checkout{color:var(--amber);background:rgba(217,119,6,.12);border-color:rgba(217,119,6,.3)}
.tag.purchased{color:var(--green);background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.3)}
.tag.orphan{color:var(--red);background:rgba(220,38,38,.12);border-color:rgba(220,38,38,.3)}
.muted{color:var(--muted2)}
/* Empty state padronizado: compacto, 1 frase, sem ocupar meia tela */
/* estado vazio com presença: moldura tracejada + ponto ciano, deixa de parecer "tela seca" */
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:34px 16px;text-align:center;color:var(--muted2);font-size:13px;border:1px dashed var(--border);border-radius:10px;margin:6px}
.empty::before{content:'';width:34px;height:34px;border-radius:50%;background:var(--accent-light);
  box-shadow:inset 0 0 0 1px rgba(37,244,238,.3),0 0 14px rgba(37,244,238,.12);
  background-image:radial-gradient(circle,var(--accent) 3px,transparent 3.5px);background-position:center;background-repeat:no-repeat}
.empty svg{width:18px;height:18px;opacity:.7}
.tbl-count{font-size:12px;color:var(--muted2);margin-left:auto}

/* ── Geo ── */
.geo-grid{display:grid;grid-template-columns:1fr 340px;gap:16px}
#globe{width:100%;height:440px;border-radius:var(--radius);overflow:hidden;position:relative;background:radial-gradient(circle at 50% 40%,#151518,#0a0a0b)}
.clist{display:flex;flex-direction:column;gap:2px;max-height:440px;overflow-y:auto}
.crow{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;transition:.12s}
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
.ab-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:10px 16px;margin-bottom:16px;position:relative;overflow:hidden}
.ab-bar::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--cyan),#2f7dff 50%,var(--pink));opacity:.45}
.ab-status{font-size:12.5px;color:var(--muted);font-weight:600;white-space:nowrap}
.ab-status.on{color:var(--green)}
.ab-split-wrap{flex:1;min-width:200px;display:flex;align-items:center;gap:10px;transition:opacity .25s}
.ab-split-wrap .abm{font-size:12px;font-family:'Geist Mono';min-width:78px;font-weight:600}
.ab-split-wrap input[type=range]{flex:1}
.ab-links{display:flex;gap:4px;margin-left:auto}
.ab-links a{font-size:11.5px;font-weight:600;color:var(--muted);text-decoration:none;padding:5px 10px;border-radius:8px;border:1px solid var(--border);transition:.15s;white-space:nowrap}
.ab-links a:hover{color:var(--cyan);border-color:var(--cyan)}
.ab-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:stretch}
@media(max-width:860px){.ab-grid{grid-template-columns:1fr}}
/* veredito refinado */
.verdict{position:relative;overflow:hidden;border:1px solid var(--border2);border-radius:14px;padding:22px;background:var(--card);animation:kpiIn .5s cubic-bezier(.2,.7,.3,1) backwards}
.verdict::before{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(320px 150px at 85% 0%,rgba(254,44,85,.08),transparent 65%),radial-gradient(280px 140px at 10% 100%,rgba(47,125,255,.07),transparent 65%)}
.verdict .win{font-family:'Geist Mono';font-size:30px;font-weight:700;margin-top:6px;letter-spacing:-.02em}
 .verdict .win.cyn{text-shadow:0 0 22px rgba(37,244,238,.45)}
.verdict .win.pnk{text-shadow:0 0 22px rgba(220,38,38,.45)}
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
.abrow .abr-bars .b.s{background:linear-gradient(90deg,var(--cyan),rgba(47,125,255,.55))}
.abrow .abr-bars .b.c{background:linear-gradient(90deg,var(--pink),rgba(220,38,38,.55))}

/* ── Config form ���─ */
.form-row{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}
.form-row label{font-size:12.5px;color:var(--muted);font-weight:600}
.form-row .hint{font-size:11.5px;color:var(--muted2);font-weight:400}
.range-wrap{display:flex;align-items:center;gap:12px}
input[type=range]{flex:1;accent-color:var(--cyan)}
/* cards de configuração com identidade */
.cfg-grid .cfg-card{position:relative;border-radius:14px;overflow:hidden;animation:kpiIn .5s var(--ease) backwards;transition:border-color var(--dur) var(--ease),box-shadow var(--dur) var(--ease)}
.cfg-grid .cfg-card:nth-child(1){animation-delay:.02s}.cfg-grid .cfg-card:nth-child(2){animation-delay:.09s}
.cfg-grid .cfg-card:nth-child(3){animation-delay:.16s}.cfg-grid .cfg-card:nth-child(4){animation-delay:.23s}
.cfg-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:18px}
.cfg-head h3{font-size:14.5px;line-height:1.3}
.cfg-head p{margin:3px 0 0;font-size:11.5px;color:var(--muted2);line-height:1.45}
.cfg-ico{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex-shrink:0;
  background:color-mix(in srgb,var(--cc) 12%,transparent);color:var(--cc);border:1px solid color-mix(in srgb,var(--cc) 22%,transparent);
  transition:transform var(--dur) var(--ease)}
.cfg-ico svg{width:16px;height:16px}
.cfg-note{margin:2px 0 0;font-size:11.5px;color:var(--muted2);line-height:1.5;padding:9px 12px;background:var(--card2);border-radius:10px;border-left:2px solid var(--pink)}
/* segmented control (sensibilidade do filtro de bots) */
.seg{display:flex;gap:6px;background:var(--card2);padding:5px;border-radius:10px;border:1px solid var(--border);margin-top:8px}
.seg button{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:9px 6px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--muted2);font-size:12.5px;font-weight:600;cursor:pointer;transition:.18s}
.seg button:hover{color:var(--text);background:var(--card)}
.seg button.on{background:color-mix(in srgb,var(--cyan) 16%,transparent);color:var(--cyan);border-color:color-mix(in srgb,var(--cyan) 35%,transparent)}
.seg-sub{font-size:11px;font-weight:500;opacity:.75}
/* linha de camada de detecção */
.ck-layer{display:flex;align-items:center;gap:12px;padding:13px 14px;background:var(--card);border:1px solid var(--border);border-radius:12px;transition:.2s}
.ck-layer:hover{border-color:var(--border2)}
.ck-layer.on{border-color:color-mix(in srgb,var(--cyan) 30%,transparent)}
.ck-layer .ck-l-body{flex:1;min-width:0}
.ck-layer .ck-l-body b{display:block;font-size:12.5px;color:var(--text)}
.ck-layer .ck-l-body span{display:block;font-size:11px;color:var(--muted2);line-height:1.4;margin-top:2px}
.ck-verdict{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;font-weight:600;font-size:13px}
.ck-verdict.real{background:color-mix(in srgb,var(--green) 14%,transparent);color:var(--green);border:1px solid color-mix(in srgb,var(--green) 30%,transparent)}
.ck-verdict.bot{background:color-mix(in srgb,var(--pink,#f31260) 14%,transparent);color:var(--pink,#f31260);border:1px solid color-mix(in srgb,var(--pink,#f31260) 30%,transparent)}
/* Regras por link (cloak) */
.ck-rule{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px;animation:kpiIn .35s cubic-bezier(.2,.7,.3,1) backwards}
.ck-rule .ck-field{display:flex;flex-direction:column;gap:8px}
.ck-rule .ck-field.full{grid-column:1/-1}
.ck-rule label{font-size:12px;font-weight:600;color:var(--muted);letter-spacing:.01em}
.ck-rule label .hint{font-weight:500}
.ck-offer{display:flex;align-items:center;gap:8px;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--muted2);word-break:break-all}
.ck-offer svg{width:15px;height:15px;flex-shrink:0;color:var(--green)}
.pais-box{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:8px 9px;min-height:42px}
.pais-chip{display:inline-flex;align-items:center;gap:6px;background:color-mix(in srgb,var(--cyan) 14%,transparent);color:var(--cyan);border:1px solid color-mix(in srgb,var(--cyan) 32%,transparent);border-radius:7px;padding:4px 6px 4px 9px;font-size:12px;font-weight:700;letter-spacing:.03em}
.pais-chip button{border:none;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:0;opacity:.7}
.pais-chip button:hover{opacity:1}
.pais-box input{flex:1;min-width:70px;border:none;background:transparent;color:var(--text);font-size:12.5px;text-transform:uppercase;outline:none;padding:4px}
.pais-box.all input{text-transform:none}
/* Grid de checkboxes de país/idioma (allowlist do cloaker) */
.geo-collapse{border:1px solid var(--border);border-radius:12px;background:var(--card);overflow:hidden;margin-top:6px}
.geo-collapse>summary{list-style:none;cursor:pointer;padding:13px 15px;font-size:13.5px;color:var(--text);display:flex;align-items:center;gap:8px;flex-wrap:wrap;position:relative}
.geo-collapse>summary::-webkit-details-marker{display:none}
.geo-collapse>summary::after{content:'\\25be';margin-left:auto;color:var(--muted2);transition:transform .2s}
.geo-collapse[open]>summary::after{transform:rotate(180deg)}
.geo-collapse>summary:hover{background:var(--card2)}
.geo-collapse>summary b{font-weight:600}
.geo-collapse>.geo-wrap,.geo-collapse>p{margin-left:15px;margin-right:15px}
.geo-collapse>.geo-wrap{margin-bottom:15px}
.geo-wrap{background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:11px 12px;display:flex;flex-direction:column;gap:12px}
.geo-block{display:flex;flex-direction:column;gap:8px}
.geo-block-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.geo-block-head b{font-size:11px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:.05em}
.geo-block-head button{border:none;background:transparent;color:var(--cyan);cursor:pointer;font-size:11px;font-weight:600;padding:0}
.geo-block-head button:hover{text-decoration:underline}
.geo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px}
.geo-chk{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;font-size:12.5px;color:var(--text);background:var(--card);border:1px solid var(--border);border-radius:8px;padding:6px 9px;transition:border-color .15s,background .15s}
.geo-chk:hover{border-color:color-mix(in srgb,var(--cyan) 40%,transparent)}
.geo-chk input{accent-color:var(--cyan);width:15px;height:15px;flex-shrink:0;margin:0}
.geo-chk.on{background:color-mix(in srgb,var(--cyan) 12%,transparent);border-color:color-mix(in srgb,var(--cyan) 38%,transparent)}
.geo-chk .flag{font-size:15px;line-height:1}
.geo-chk .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ck-sync{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted2);cursor:pointer;user-select:none}
.ck-adv{margin-top:16px;border:1px solid var(--border);border-radius:12px;background:var(--card);overflow:hidden}
.ck-adv>summary{list-style:none;cursor:pointer;padding:14px 16px;font-size:13px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:8px}
.ck-adv>summary::-webkit-details-marker{display:none}
.ck-adv>summary .chev{margin-left:auto;transition:transform .2s;color:var(--muted2)}
.ck-adv[open]>summary .chev{transform:rotate(180deg)}
.ck-adv>summary:hover{background:var(--card2)}
.ck-adv .ck-adv-body{padding:0 16px 16px}
/* zona de risco compacta */
/* ── Popup genérico: confirmações bonitas no lugar dos confirm() nativos ── */
.pop-bg{position:fixed;inset:0;z-index:90;display:none;align-items:center;justify-content:center;
  background:rgba(0,0,0,.6);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.pop-bg.open{display:flex;animation:popBgIn .2s ease}
@keyframes popBgIn{from{opacity:0}to{opacity:1}}
.pop{width:min(400px,calc(100vw - 40px));background:var(--card2);border:1px solid var(--border2);
  border-radius:16px;padding:24px;text-align:center;box-shadow:var(--shadow-4);
  animation:popIn .25s var(--spring)}
@keyframes popIn{from{opacity:0;transform:translateY(10px) scale(.96)}to{opacity:1;transform:none}}
.pop-ico{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;margin:0 auto 14px;font-size:24px}
.pop-ico.warn{background:var(--error-light);color:var(--error)}
.pop-ico.info{background:var(--accent-light);color:var(--accent)}
.pop-ico.hi{background:var(--success-light);color:var(--success)}
.pop h3{font-size:17px;margin-bottom:8px}
.pop p{font-size:13px;color:var(--text-muted);line-height:1.55;margin:0 0 20px}
.pop-actions{display:flex;gap:8px;justify-content:center}
.pop-actions .btn{min-width:110px}
.pop-actions .btn.pop-danger{background:var(--error);color:#fff;box-shadow:0 4px 16px rgba(239,68,68,.3)}
@media(prefers-reduced-motion:reduce){.pop,.pop-bg.open{animation:none}}
.danger-card{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px;border-color:rgba(220,38,38,.22)!important;
  background:linear-gradient(90deg,rgba(220,38,38,.05),transparent 55%);animation:kpiIn .5s cubic-bezier(.2,.7,.3,1) .3s backwards}
.danger-card:hover{border-color:rgba(220,38,38,.4)!important}

/* ── Atividade ── */
.feed{display:flex;flex-direction:column}
.ev{display:flex;gap:12px;padding:13px 4px;border-bottom:1px solid var(--border)}
.ev:last-child{border-bottom:0}
.ev .ei{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex-shrink:0;background:var(--card2)}
.ev .ei svg{width:16px;height:16px}
.ev .et{font-size:13.5px;font-weight:600}
.ev .em{font-size:12px;color:var(--muted2);margin-top:2px}
.ev .ea{margin-left:auto;text-align:right;font-size:12px;color:var(--muted2);white-space:nowrap;flex-shrink:0}
.ev .amt{font-family:'Geist Mono';font-weight:700;font-size:14px}

/* ── Alertas ── */
.alert{display:flex;gap:12px;align-items:flex-start;border-radius:var(--radius);padding:15px 17px;margin-bottom:16px;border:1px solid rgba(217,119,6,.3);background:rgba(217,119,6,.08)}
.alert.info{border-color:rgba(47,125,255,.3);background:rgba(47,125,255,.07)}
.alert.ok{border-color:rgba(34,197,94,.3);background:rgba(34,197,94,.07)}
.alert.err{border-color:rgba(220,38,38,.3);background:rgba(220,38,38,.07)}
.alert svg{width:20px;height:20px;flex-shrink:0;color:var(--amber);margin-top:1px}
.alert.info svg{color:var(--cyan)} .alert.ok svg{color:var(--green)} .alert.err svg{color:var(--red)}
.alert b{display:block;font-size:13.5px}
.alert p{margin:3px 0 0;font-size:12.5px;color:var(--muted)}

/* ── Drawer ── */
.drawer-bg{position:fixed;inset:0;background:rgba(40,50,80,.25);backdrop-filter:blur(6px) saturate(120%);opacity:0;pointer-events:none;transition:.25s;z-index:40}
.drawer-bg.open{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;height:100vh;width:min(460px,94vw);background:rgba(9,12,24,0.85);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border-left:1px solid var(--border);box-shadow:-12px 0 48px rgba(0,0,0,.6);transform:translateX(100%);transition:transform var(--dur-slow) var(--spring);z-index:50;display:flex;flex-direction:column}
.drawer.open{transform:none}
.drawer-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--border);gap:10px}
.drawer-head h3{font-size:16px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drawer-head .head-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.x{background:var(--card);border:1px solid var(--border);color:var(--muted);width:34px;height:34px;border-radius:10px;cursor:pointer;font-size:18px;display:grid;place-items:center}
.drawer-body{padding:20px;overflow-y:auto;flex:1}
.dl{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px}
.dl:last-child{border-bottom:0}
.dl .dk{color:var(--muted2);flex-shrink:0}
.dl .dv{font-weight:600;text-align:right;word-break:break-all;max-width:240px}
.dgroup{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted2);margin:18px 0 4px;font-weight:600}

/* ── Btn-icon (copiar ID, etc.) ── */
.btn-icon{background:var(--card2);border:1px solid var(--border);color:var(--muted);height:30px;padding:0 10px;border-radius:8px;cursor:pointer;font-size:11.5px;font-weight:600;letter-spacing:.02em;display:inline-flex;align-items:center;gap:6px;transition:color .15s,border-color .15s}
.btn-icon:hover{color:var(--cyan);border-color:var(--cyan)}

/* ── Toast ── */
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(80px);opacity:0;visibility:hidden;background:rgba(19,19,22,0.92);backdrop-filter:blur(12px) saturate(150%);-webkit-backdrop-filter:blur(12px) saturate(180%);border:1px solid var(--border2);color:var(--text);padding:12px 20px;border-radius:14px;font-size:13.5px;font-weight:600;z-index:60;transition:transform var(--dur-slow) var(--spring),opacity .3s,visibility .3s;box-shadow:0 12px 32px rgba(0,0,0,.5),inset 0 1px 1px var(--lg-rim-top);pointer-events:none}
.toast.show{transform:translateX(-50%) translateY(0);opacity:1;visibility:visible}
 /* faixa lateral + fundo tingido: verde = sucesso, vermelho = erro */
 .toast.ok{border-color:rgba(34,197,94,.5);border-left:3px solid var(--success);background:linear-gradient(90deg,rgba(34,197,94,.14),rgba(19,19,22,.9) 40%)}
 .toast.err{border-color:rgba(220,38,38,.5);border-left:3px solid var(--error);background:linear-gradient(90deg,rgba(239,68,68,.14),rgba(19,19,22,.9) 40%)}

/* ── Health dots ── */
.health-grid{display:block}

/* ── Sub-abas do Rastreamento ── */
.tracking-tabs{margin-bottom:20px}
.tracking-tabs[hidden]{display:none!important} /* .segment é flex; garante que hidden vença */
.tracking-tabs button{padding:8px 16px;font-size:13px}

/* ── Setup guiado (checklist com progresso) ── */
.setup-card{border-color:color-mix(in srgb,var(--accent) 22%,transparent)}
/* recolhível: summary vira a linha-resumo; corpo esconde o título duplicado */
.setup-summary{display:flex;align-items:center;gap:10px;cursor:pointer;list-style:none;font-size:13.5px;user-select:none}
.setup-summary::-webkit-details-marker{display:none}
.setup-summary .chev{color:var(--muted);transition:transform var(--dur) var(--ease)}
details[open]>.setup-summary .chev{transform:rotate(180deg)}
.setup-badge{display:grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:20px;
  background:color-mix(in srgb,var(--accent) 15%,transparent);color:var(--accent);font-size:12px;font-weight:700}
.setup-body{margin-top:14px}
.setup-body .setup-title,.setup-body .setup-sub{display:none} /* summary já mostra título e contagem */
.setup-head{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:14px}
.setup-title{font-size:14px;font-weight:600;display:block}
.setup-sub{font-size:12px;color:var(--muted);display:block;margin-top:2px}
.setup-bar{flex:1;min-width:140px;height:6px;border-radius:6px;background:var(--card2);overflow:hidden}
.setup-bar i{display:block;height:100%;border-radius:6px;background:var(--accent);transition:width var(--dur-slow) var(--ease)}
.setup-list{display:flex;flex-direction:column;gap:8px}
.setup-item{display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--card2);border:1px solid var(--border);border-radius:10px}
.setup-item.done{opacity:.55}
.si-dot{width:20px;height:20px;border-radius:50%;flex-shrink:0;display:grid;place-items:center;border:1.5px solid var(--border2);color:var(--green)}
.setup-item.done .si-dot{border-color:var(--green);background:color-mix(in srgb,var(--green) 12%,transparent)}
.si-dot svg{width:11px;height:11px}
.si-txt{flex:1;min-width:0}
.si-txt b{font-size:13px;font-weight:600;display:block}
.si-txt span{font-size:12px;color:var(--muted);display:block;margin-top:1px}
.si-go{flex-shrink:0}

/* ── Funil + entradas lado a lado na Visão Geral ── */
@media(max-width:900px){.ov-pages{grid-template-columns:1fr!important}}

/* ── Configurações: coluna única estilo Vercel ── */
.settings-col{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:36px}
.set-sec-head{margin-bottom:12px}
.set-sec-head h3{font-size:15px;font-weight:600;margin:0}
.set-sec-head p{font-size:12.5px;color:var(--muted);margin:3px 0 0}
.settings-col .ck-adv{margin-top:0}
.settings-col .cfg-grid{grid-template-columns:1fr!important}

/* linhas de toggle com descrição */
.tgl-list{display:flex;flex-direction:column;margin-top:4px}
.tgl-row{display:flex;align-items:center;gap:12px;padding:11px 2px;cursor:pointer;border-bottom:1px solid var(--border)}
.tgl-row:last-child{border-bottom:0}
.tgl-txt{flex:1;min-width:0}
.tgl-txt b{font-size:13px;font-weight:600;display:block}
.tgl-txt span{font-size:12px;color:var(--muted);display:block;margin-top:1px}
.hitem{display:flex;align-items:center;gap:10px;padding:11px 14px;background:var(--card2);border-radius:10px;border:1px solid var(--border);font-size:12.5px;transition:.2s}

.hitem .hdot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.hitem .hdot.ok{background:var(--green)}
.hitem .hdot.warn{background:var(--red)}
.hitem .hlbl{flex:1;font-weight:500}
.hitem .hstatus{font-size:11px;font-weight:600;font-family:'Geist Mono'}
.hitem .hstatus.ok{color:var(--green)} .hitem .hstatus.warn{color:var(--red)}

/* ── Skeletons: placeholders com shimmer enquanto os dados chegam ── */
.skel{position:relative;overflow:hidden;background:var(--card2);border-radius:8px}
.skel::after{content:'';position:absolute;inset:0;transform:translateX(-100%);
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.05),transparent);
  animation:skelShimmer 1.4s ease-in-out infinite}
@keyframes skelShimmer{to{transform:translateX(100%)}}
.skel-kpi{height:118px;border:1px solid var(--border);border-radius:14px;background:var(--card)}
.skel-row{height:44px;margin-bottom:8px}
.skel-line{height:12px;width:60%}
@media(prefers-reduced-motion:reduce){.skel::after{animation:none}}

/* ── Foco visível para navegação por teclado ─��� */
button:focus-visible,a:focus-visible,input:focus-visible,[tabindex]:focus-visible{
  outline:2px solid var(--ring);outline-offset:2px;border-radius:6px}
.inp:focus-visible{outline-offset:0}

/* ── Responsivo ── */
@media(max-width:960px){
  .geo-grid,.ab-grid{grid-template-columns:1fr}
  .kpis{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
  .hh-inner{padding:10px 16px}
  .hh-status{width:100%;margin-left:0}
  .nav.dock{padding:8px 12px 12px}
  .nav.dock button{padding:9px 13px;font-size:13px}
  .nav.dock button .d-lbl{display:none}
  .nav.dock button.active .d-lbl{display:inline}
}
/* telefones: 2 colunas de KPIs (evita pilha alta), conteúdo e gráfico compactos */
@media(max-width:560px){
  .content{padding:16px 14px 90px}
  .kpis{grid-template-columns:1fr 1fr;gap:10px}
  .kpis-xl .kpi{padding:14px}
  .kpis-xl .kpi .k-val{font-size:24px}
  .ministats{grid-template-columns:1fr 1fr;gap:10px}
  .chart-wrap{height:200px}
  #live-globe{height:340px}
  .settings-col{gap:28px}
  .tracking-tabs{overflow-x:auto;scrollbar-width:none}
  .tracking-tabs::-webkit-scrollbar{display:none}
  .tracking-tabs button{white-space:nowrap}
  /* card Conversão: funil mini apertado — rótulos curtos e fonte menor */
  .k-funnel .kf-lbl{font-size:11px;width:52px}
  .k-funnel .kf-pct{font-size:10.5px}
  /* seletor de período: rola horizontal em vez de quebrar linha */
  .tb-right{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
  .tb-right::-webkit-scrollbar{display:none}
  .segment#period{flex-shrink:0}
  .segment#period button{white-space:nowrap;padding:6px 10px;font-size:12px}
  .topbar{padding:10px 14px;gap:10px}
  .topbar h2{font-size:18px}
  .topbar .sub{display:none} /* subtítulo dispensável em telas pequenas */
  .hh-status{display:none} /* o strip de presença já informa o "ao vivo" */
}
#menuToggle{display:none!important}

/* ═══════════════ PERSONALIDADE · EFEITOS · MOVIMENTO ═══════════════ */
html{scroll-behavior:smooth}
::selection{background:rgba(47,125,255,.28);color:#fff}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--cyan);outline-offset:2px;border-radius:8px}

.app{position:relative;z-index:1}

/* ── Efeito ÚNICO de card ──
   Todos os cards interativos compartilham o mesmo hover: lift de 3px,
   borda acesa e glow na cor de identidade (--glow). Nada de efeitos
   diferentes por família — uma linguagem só em toda a dash. */
.card{transition:border-color var(--dur) var(--ease),transform var(--dur-slow) var(--spring),box-shadow var(--dur-slow) var(--ease),background var(--dur) var(--ease)}
.card:hover{background:var(--card2);transform:translateY(-3px);
  box-shadow:0 16px 36px rgba(0,0,0,.65), 0 0 15px rgba(37,244,238,.14), inset 0 1px 1px rgba(255,255,255,.12);
  border-color:rgba(37,244,238,.42)}
.kpi,.mstat,.cfg-card,.gs-stat,.hitem{transition:border-color var(--dur) var(--ease),transform var(--dur-slow) var(--spring),box-shadow var(--dur-slow) var(--ease)}
.kpi:hover,.mstat:hover,.cfg-card:hover,.gs-stat:hover,.hitem:hover{
  transform:translateY(-3px);
  border-color:rgba(37,244,238,.38);
  box-shadow:0 14px 28px rgba(0,0,0,.6), 0 0 12px rgba(37,244,238,.12);
}
/* micro-interação única do ícone (mesma em todos) */
.kpi:hover .k-ico,.mstat:hover .ms-ico,.cfg-card:hover .cfg-ico{transform:scale(1.08)}

/* ── KPI card canônico: plano, número grande é o herói ── */
 .kpis-xl .kpi{border-radius:14px;padding:20px}
 /* card-herói: Receita é o 1º KPI — borda com o degradê da marca (ciano→rosa) */
 .kpis-xl .kpi:first-child{
   background:linear-gradient(var(--card2),var(--card2)) padding-box,var(--brand-grad) border-box;
   border:1px solid transparent}
 .kpis-xl .kpi:first-child .k-val{font-size:36px}
.kpis-xl .kpi.tint-cyan{--kg1:var(--cyan)}
.kpis-xl .kpi.tint-pink{--kg1:var(--red)}
.kpis-xl .kpi.tint-blue{--kg1:var(--cyan)}
.kpis-xl .kpi.tint-green{--kg1:var(--green)}
.kpis-xl .kpi.tint-amber{--kg1:var(--amber)}
/* ícone discreto na identidade semântica do card */
.kpis-xl .kpi .k-ico{background:color-mix(in srgb,var(--kg1,var(--accent)) 12%,transparent);color:var(--kg1,var(--accent));box-shadow:none}
.kpis-xl .k-ico{transition:transform var(--dur) var(--ease)}
/* label pequeno, uppercase discreto; número grande e pesado */
.kpis-xl .kpi .k-top{font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:600;color:var(--muted)}
.kpis-xl .kpi .k-val{font-size:32px;font-weight:700}
.kpis-xl .kpi{animation:kpiIn .55s var(--ease) backwards}
.kpis-xl .kpi:nth-child(1){animation-delay:.02s}.kpis-xl .kpi:nth-child(2){animation-delay:.09s}
.kpis-xl .kpi:nth-child(3){animation-delay:.16s}.kpis-xl .kpi:nth-child(4){animation-delay:.23s}
@keyframes kpiIn{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}

/* ── Ministats (substitui os chips) ── */
.ministats{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;margin:16px 0 6px}
.mstat{position:relative;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px 14px 19px;overflow:hidden;transition:border-color var(--dur) var(--ease),transform var(--dur) var(--ease),box-shadow var(--dur) var(--ease);animation:kpiIn .5s var(--ease) backwards;--mc:var(--accent)}
.mstat::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:3px 0 0 3px;background:var(--mc);opacity:.6}
.mstat:nth-child(1){animation-delay:.05s}.mstat:nth-child(2){animation-delay:.11s}.mstat:nth-child(3){animation-delay:.17s}
.mstat:nth-child(4){animation-delay:.23s}.mstat:nth-child(5){animation-delay:.29s}

.mstat .ms-top{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.08em}
.mstat .ms-ico{width:26px;height:26px;border-radius:7px;display:grid;place-items:center;flex-shrink:0;transition:transform var(--dur) var(--ease)}
.mstat .ms-ico svg{width:13px;height:13px}
.mstat .ms-val{font-family:'Geist Mono',monospace;font-size:21px;font-weight:600;margin-top:9px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.mstat .ms-sub{font-size:11.5px;color:var(--muted2);margin-top:3px}
.mstat .ms-bar{height:4px;border-radius:3px;background:var(--card2);margin-top:10px;overflow:hidden;position:relative}
.mstat .ms-fill{height:100%;border-radius:3px;width:0;transition:width 1.1s cubic-bezier(.2,.7,.3,1) .35s;position:relative;overflow:hidden}
/* micro-barras (distribuição por bucket) — usado em KPIs e ministats */
.k-bars{display:flex;align-items:flex-end;gap:2px;height:34px}
.k-bars i{flex:1;min-width:2px;border-radius:2px 2px 0 0;height:var(--bh,8%);animation:barUp .6s cubic-bezier(.2,.8,.3,1) backwards}
@keyframes barUp{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.k-bars i{transform-origin:bottom}
.mstat .k-bars{height:26px;margin-top:10px}
.mstat .k-spark{margin-top:10px}
/* funil compacto no card Conversão */
.k-funnel{display:flex;flex-direction:column;gap:6px;margin-top:11px}
.kf-row{display:flex;align-items:center;gap:8px;font-size:10.5px}
.kf-lbl{width:56px;color:var(--muted2);letter-spacing:.02em;flex-shrink:0}
.kf-track{flex:1;height:8px;border-radius:4px;background:var(--card2);overflow:hidden}
.kf-track i{display:block;height:100%;border-radius:4px;width:0;transition:width 1s cubic-bezier(.2,.7,.3,1)}
.kf-pct{width:42px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;flex-shrink:0}
/* mini-tabela de países (bandeira + volume) */
.ms-geo{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.msg-row{display:flex;align-items:center;gap:6px;font-size:10.5px}
.msg-flag{font-size:12px;line-height:1;flex-shrink:0}
.msg-code{width:22px;color:var(--muted);font-weight:600;flex-shrink:0}
.msg-track{flex:1;height:5px;border-radius:3px;background:var(--card2);overflow:hidden}
.msg-track i{display:block;height:100%;border-radius:3px;background:var(--mc,#06b6d4);width:0;transition:width .9s cubic-bezier(.2,.7,.3,1)}
.msg-n{min-width:20px;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums;flex-shrink:0}
/* ��─ Visão Geral: cabeçalho de bloco leve (título + contexto, divisor sutil) ── */
/* sem bolinha no overview: remove também o recuo (senão o título fica "flutuando") */
 #view-overview .section-title span:first-child{padding-left:0}
 #view-overview .section-title span:first-child::before{display:none}
#view-overview .section-title .line{background:linear-gradient(90deg,var(--border2),var(--border) 40%,transparent)}

/* ── Visão Geral: meta de receita — plana, sem brilho ambiente ── */
#view-overview .goal-card{position:relative;overflow:hidden;border-radius:14px}

/* ── Visão Geral: card de tendência — plano ── */
#view-overview .card:has(.chart-wrap){position:relative;border-radius:14px;overflow:hidden}

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
/* cards com scroll-in não entram na cascata (evita animação dupla) */
.view.entering .reveal{animation:none}

/* Nav — indicador ativo é o sublinhado do dock */
.nav button{position:relative;transition:background .15s,color .15s;z-index:1}
.nav button svg{transition:color .2s}
.nav button:active{transform:scale(.97)}
/* gota líquida deslizante: elemento posicionado por JS, estica no meio do caminho */
#nav-gota{position:absolute;top:0;left:0;height:100%;border-radius:10px;pointer-events:none;z-index:0;
  background:rgba(37,244,238,.07);
  box-shadow:0 8px 32px rgba(0,0,0,.45), inset 0 1px 1px rgba(255,255,255,.12);
  border:1px solid rgba(37,244,238,.35);
  transition:transform var(--dur-slow) var(--spring),width var(--dur-slow) var(--spring);
  will-change:transform}
/* a gota vira lente de verdade: refrata os botões que passam por baixo dela */
html[data-liquid-glass] #nav-gota{
  -webkit-backdrop-filter:blur(2px) saturate(160%) url(#lg-lens);
  backdrop-filter:blur(2px) saturate(160%) url(#lg-lens)}
@media(prefers-reduced-motion:reduce){#nav-gota{transition:none}}

/* Ponto ao vivo — anel pulsante */
.dot{position:relative}
.dot::after{content:'';position:absolute;inset:-4px;border-radius:50%;border:1px solid var(--green);opacity:.6;animation:ping 1.9s cubic-bezier(0,0,.2,1) infinite}
.dot.off::after{border-color:var(--red)}
@keyframes ping{0%{transform:scale(.7);opacity:.7}80%,100%{transform:scale(2);opacity:0}}

/* Badge de alerta — estático (sem loop; o número já comunica) */

/* Botões — clique tátil discreto */
.btn{transition:background .15s,transform .1s,box-shadow .18s,filter .15s}
.btn:active,.btn-icon:active,.segment button:active{transform:scale(.95)}
.btn.primary:hover{box-shadow:0 4px 14px -6px rgba(37,244,238,.35)}
.btn-icon{transition:color .15s,border-color .15s,background .15s,transform .1s}
#refresh-btn.spinning svg{animation:spin .8s linear infinite}

/* Segmento de período — hover discreto */
.segment button{transition:background .18s,color .18s}
.segment button:not(.active):hover{color:var(--text)}

/* Switch — brilho ao ligar */
input:checked+.slider{box-shadow:0 0 0 1px rgba(47,125,255,.4),0 0 12px -2px rgba(47,125,255,.5)}
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
  --blue:#2f7dff; --violet:#7ab8ff; --teal:#2f7dff;
  --grad-cool:#2f7dff;
  --grad-warm:#d97706;
  --grad-mint:#22c55e;
}
.card.tint-blue{background:var(--card)}
.k-ico.ic-blue{background:rgba(47,125,255,.14);color:var(--blue)}
.blu{color:var(--blue)}

.kpi{position:relative;overflow:hidden}

/* Delta chip (comparação de período) */
.k-delta{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;margin-top:9px;letter-spacing:.01em}
.k-delta svg{width:11px;height:11px}
.k-delta.up{color:var(--green);background:rgba(34,197,94,.13)}
.k-delta.down{color:var(--red);background:rgba(220,38,38,.13)}
.k-delta.flat{color:var(--muted2);background:var(--card2)}
.k-delta.up.inv{color:var(--red);background:rgba(220,38,38,.13)}
.k-delta.down.inv{color:var(--green);background:rgba(34,197,94,.13)}

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
.cmdk{width:min(560px,94vw);background:rgba(12,16,30,0.88);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid var(--border2);border-radius:18px;box-shadow:0 24px 64px rgba(0,0,0,0.7),inset 0 1px 1px var(--lg-rim-top);overflow:hidden;transform:translateY(-10px) scale(.98);transition:.25s var(--spring)}
.cmdk-bg.open .cmdk{transform:none}
.cmdk-top{display:flex;align-items:center;gap:12px;padding:15px 18px;border-bottom:1px solid var(--border)}
.cmdk-top svg{width:18px;height:18px;color:var(--muted2);flex-shrink:0}
.cmdk-top input{flex:1;background:transparent;border:0;outline:0;color:var(--text);font-family:inherit;font-size:15px}
.cmdk-top kbd{font-size:11px;color:var(--muted2);border:1px solid var(--border);border-radius:6px;padding:2px 6px;font-family:inherit}
.cmdk-list{max-height:52vh;overflow-y:auto;padding:8px}
.cmdk-grp{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted2);padding:12px 12px 5px;font-weight:700}
.cmdk-item{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:10px;cursor:pointer;color:var(--muted);font-size:14px;font-weight:500}
.cmdk-item svg{width:17px;height:17px;flex-shrink:0}
.cmdk-item .ci-hint{margin-left:auto;font-size:11px;color:var(--muted2)}
.cmdk-item.sel,.cmdk-item:hover{background:var(--hover);color:var(--text)}
.cmdk-item.sel svg,.cmdk-item:hover svg{color:var(--cyan)}
.cmdk-empty{padding:30px;text-align:center;color:var(--muted2);font-size:13px}
.kbd-hint{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--muted2)}
.kbd-hint kbd{border:1px solid var(--border);border-radius:5px;padding:1px 6px;font-family:inherit;font-size:11px}

/* Botão de exportar */
.btn-export{display:inline-flex;align-items:center;gap:6px}
.btn-export svg{width:14px;height:14px}

/* Valor KPI com brilho ao mudar */
.k-val.flash{animation:valFlash .6s var(--ease)}
@keyframes valFlash{0%{color:var(--accent)}100%{}}

/* Título de seção: o recuo do ponto é definido na regra base (padding-left:16px) */

/* Acessibilidade — respeita preferência por menos movimento */
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}
}
</style>
</head>
<body>

<!-- Filtros SVG do Liquid Glass (tier 2 wobble + tier 3 lente) -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <filter id="lg-wobble" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.008 0.008" numOctaves="2" seed="4" result="noise"/>
    <feGaussianBlur in="noise" stdDeviation="2" result="blurred"/>
    <feDisplacementMap in="SourceGraphic" in2="blurred" scale="24" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="lg-lens" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.012 0.012" numOctaves="1" seed="7" result="n2"/>
    <feGaussianBlur in="n2" stdDeviation="3" result="b2"/>
    <feDisplacementMap in="SourceGraphic" in2="b2" scale="-42" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
</svg>
<script>
/* Gate do Liquid Glass: só Chromium + pointer fino + sem reduced-motion + GPU ok */
(function(){
  try{
    var isChromium=navigator.userAgentData?navigator.userAgentData.brands.some(function(b){return /Chromium/.test(b.brand)}):(!!window.chrome&&/Chrome\\//.test(navigator.userAgent));
    var finePointer=matchMedia('(pointer:fine)').matches;
    var noReduce=!matchMedia('(prefers-reduced-motion:reduce)').matches;
    var gpuOk=(navigator.deviceMemory===undefined||navigator.deviceMemory>=4)&&(navigator.hardwareConcurrency===undefined||navigator.hardwareConcurrency>=4);
    if(isChromium&&finePointer&&noReduce&&gpuOk&&document.getElementById('lg-wobble')){
      enableLG();
    }
    /* exposto para debug/forçar manualmente (ex.: testes automatizados) */
    window.__lgEnable=enableLG;
  }catch(e){}

  function enableLG(){
    document.documentElement.setAttribute('data-liquid-glass','');
    buildLensMap();
    trackSpecular();
    rippleWobble();
  }

  /* ── Ripple + wobble (spec liquid glass): delegação única, sem listeners por botão ── */
  function rippleWobble(){
    var SEL='.btn,.nav button,.gt-btn,.gs-all,.seg-btn,.tab-btn';
    document.addEventListener('pointerdown',function(e){
      var t=e.target&&e.target.closest&&e.target.closest(SEL);
      if(!t) return;
      var r=t.getBoundingClientRect();
      if(!r.width) return;
      var d=Math.max(r.width,r.height)*2.2;
      var s=document.createElement('span');
      s.className='lg-ripple';
      s.style.width=s.style.height=d+'px';
      s.style.left=(e.clientX-r.left)+'px';
      s.style.top=(e.clientY-r.top)+'px';
      if(getComputedStyle(t).position==='static') t.style.position='relative';
      t.style.overflow='hidden';
      t.appendChild(s);
      setTimeout(function(){ s.remove(); },650);
    },{passive:true});
    document.addEventListener('pointerup',function(e){
      var t=e.target&&e.target.closest&&e.target.closest(SEL);
      if(!t) return;
      t.classList.remove('lg-wobbling'); void t.offsetWidth;
      t.classList.add('lg-wobbling');
      setTimeout(function(){ t.classList.remove('lg-wobbling'); },600);
    },{passive:true});
  }

  /* ── Lente de refração REAL (mescla do projeto liquid glass) ──
     Gera um mapa de deslocamento radial via canvas: R codifica o desvio em X,
     G o desvio em Y. Nulo no centro, forte nas bordas = lente convexa que
     curva o fundo como vidro de verdade (substitui o ruído fractal). */
  function buildLensMap(){
    try{
      var S=128, c=document.createElement('canvas'); c.width=c.height=S;
      var x=c.getContext('2d'), im=x.createImageData(S,S);
      for(var j=0;j<S;j++)for(var i=0;i<S;i++){
        var nx=(i/(S-1))*2-1, ny=(j/(S-1))*2-1;
        var r=Math.min(1,Math.sqrt(nx*nx+ny*ny));
        var k=Math.pow(r,3.2); /* curvatura: plana no centro, dobra na borda */
        var p=(j*S+i)*4;
        im.data[p]  =Math.round(128+nx*k*127);
        im.data[p+1]=Math.round(128+ny*k*127);
        im.data[p+2]=128; im.data[p+3]=255;
      }
      x.putImageData(im,0,0);
      var f=document.getElementById('lg-lens');
      if(f) f.innerHTML='<feImage href="'+c.toDataURL()+'" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="lensmap"/>'+
        '<feDisplacementMap in="SourceGraphic" in2="lensmap" scale="52" xChannelSelector="R" yChannelSelector="G"/>';
    }catch(_){}
  }

  /* ── Especular que segue o mouse (rAF-throttled, delegação única) ──
     Atualiza --mx/--my no vidro sob o cursor; o ::before desenha o reflexo. */
  function trackSpecular(){
    var pend=null;
    document.addEventListener('pointermove',function(e){
      if(pend) return;
      pend=requestAnimationFrame(function(){
        pend=null;
        var t=e.target&&e.target.closest&&e.target.closest('.card,.lg,.lg-thick');
        if(!t) return;
        var r=t.getBoundingClientRect();
        if(!r.width||!r.height) return; /* elemento oculto: sem cálculo */
        t.style.setProperty('--mx',Math.round((e.clientX-r.left)/r.width*100)+'%');
        t.style.setProperty('--my',Math.round((e.clientY-r.top)/r.height*100)+'%');
      });
    },{passive:true});
  }
})();
</script>

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
          <img src="/assets/roi-nados-logo.jpg" alt="Logo" />
        </div>
      </div>
      <nav class="nav dock" id="nav" aria-label="Navega&ccedil;&atilde;o principal">
      <button data-view="overview" class="active"><span class="d-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/></svg></span><span class="d-lbl">Visão Geral</span></button>
      <button data-view="live"><span class="d-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 010 8.49M7.76 16.24a6 6 0 010-8.49M19.07 4.93a10 10 0 010 14.14M4.93 19.07a10 10 0 010-14.14"/></svg></span><span class="d-lbl">Ao Vivo</span><span class="badge live-badge" id="nav-live-badge" style="display:none">0</span></button>
      <button data-view="tracking"><span class="d-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="7"/></svg></span><span class="d-lbl">Rastreamento</span><span class="badge" id="nav-px-badge" style="display:none">0</span></button>
      <button data-view="config"><span class="d-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06.06a1.65 1.65 0 00.33-1.82V8a1.65 1.65 0 001.51-1H22a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></span><span class="d-lbl">Configurações</span></button>
      </nav>
      <div class="hh-status">
        <div class="hh-live"><span class="dot" id="live-dot"></span>Ao vivo &middot; <span id="foot-updated">—</span></div>
      </div>
    </div>
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

      <!-- ─���� Ao Vivo ── -->
      <section class="view" id="view-live">
        <div class="section-title" style="margin-top:0"><span>Atividade global ao vivo</span><span class="line"></span><span class="muted" style="font-size:11.5px" id="ov-globe-sub">pessoas online navegando agora</span></div>
        <div class="globe-wrap">
          <div class="card globe-card" style="padding:0; height:520px; overflow:hidden; position:relative" id="globe-card">
            <div id="live-globe" style="height:100%"></div>
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
            <div class="card gs-leads" style="padding:0; overflow:hidden; display:flex; flex-direction:column; height:396px">
              <div class="gs-head"><span class="live-dot-anim"></span>Leads navegando em tempo real<button class="gs-all" id="gs-all">Ver todos</button></div>
              <div class="gs-list" id="ov-live-list" aria-busy="true" style="flex:1; overflow-y:auto"><div style="padding:12px"><div class="skel skel-row"></div><div class="skel skel-row"></div><div class="skel skel-row"></div></div></div>
            </div>
          </aside>
        </div>
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
        <!-- Setup guiado: só aparece com pendências; some quando 100% -->
        <div id="ov-setup" hidden></div>
        <div class="grid kpis kpis-xl" id="ov-kpis" aria-busy="true"><div class="skel skel-kpi"></div><div class="skel skel-kpi"></div><div class="skel skel-kpi"></div><div class="skel skel-kpi"></div></div>
        <div class="ministats" id="ov-chips" aria-busy="true"><div class="skel" style="height:96px"></div><div class="skel" style="height:96px"></div><div class="skel" style="height:96px"></div><div class="skel" style="height:96px"></div><div class="skel" style="height:96px"></div></div>
        <div class="card traffic-card reveal" id="traffic-pulse"></div>
        <div id="ov-goal-sec" hidden>
          <div class="section-title"><span>Meta de receita</span><span class="line"></span><span class="muted" style="font-size:11.5px">sugerida automaticamente</span></div>
          <div class="card goal-card reveal" id="ov-goal"></div>
        </div>
        <div class="section-title"><span>Tendência</span><span class="line"></span>
          <button class="note-add" id="note-add" title="Anotar um dia (ex.: subi criativo novo)">+ Nota</button>
          <div class="segment" id="chart-mode" style="padding:2px">
            <button data-m="revenue" class="active">Receita</button>
            <button data-m="sales">Vendas</button>
            <button data-m="leads">Leads</button>
          </div>
        </div>
        <div class="card reveal" style="position:relative">
          <div class="chart-wrap" id="chart"></div>
          <div class="chart-tip" id="chart-tip" hidden></div>
          <div class="chart-legend" id="chart-legend">
            <span><span class="leg-dot" style="background:var(--cyan)"></span>Convers&otilde;es via gateway</span>
          </div>
          <div class="chart-notes" id="chart-notes" hidden></div>
        </div>
        <div id="ov-pages-sec" hidden>
          <div class="section-title"><span>Como o funil converte</span><span class="line"></span><span class="muted" style="font-size:11.5px">jornada p&aacute;gina a p&aacute;gina &middot; portas de entrada</span></div>
          <div class="grid ov-pages" style="grid-template-columns:1fr 1fr">
            <div class="card reveal" id="ov-pagefunnel"></div>
            <div class="card reveal" id="ov-entries" style="padding:10px 14px"></div>
          </div>
        </div>
        <div id="ov-heat-sec" hidden>
          <div class="section-title"><span>Horários</span><span class="line"></span>
            <div class="segment" id="heat-mode" style="padding:2px">
              <button data-h="sales" class="active">Vendas</button>
              <button data-h="leads">Leads</button>
            </div>
          </div>
          <div class="card reveal" id="ov-heatmap"></div>
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
          </select>
          <button class="btn btn-sm btn-export" id="export-leads"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>CSV</button>
          <span class="tbl-count" id="leads-count"></span>
        </div>
        <div class="tbl-wrap"><table id="leads-table">
          <thead><tr><th>Lead</th><th>Etapa</th><th>Checkout</th><th>País</th><th>Origem</th><th>Valor</th><th>Quando</th></tr></thead>
          <tbody id="leads-body"></tbody>
        </table></div>
      </section>

      <!-- ── Países ─��� -->
      <section class="view" id="view-geo">
        <div class="block-head"><span class="bh-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20 15 15 0 010-20z"/></svg></span><div><h2>Países</h2><p>De onde vêm seus leads</p></div></div>
        <div class="grid kpis" id="geo-kpis"></div>
        <div class="section-title"><span>Ranking por país</span><span class="line"></span><span class="muted" style="font-size:11.5px">leads e compras &middot; o globo 3D fica na Vis&atilde;o Geral</span></div>
        <div class="card"><div class="clist" id="country-list"></div></div>
      </section>

      <!-- ── Rastreamento: sub-abas (Links / Pixel / Bots) ��─ -->
      <div class="segment tracking-tabs" id="tracking-tabs" hidden>
        <button data-t="links" class="active">Links de Checkout</button>
        <button data-t="pixels">Pixel TikTok</button>
        <button data-t="gateways">Gateways</button>
        <button data-t="cloak">Filtro de Bots</button>
      </div>

      <!-- ── Links de Checkout ── -->
      <section class="view" id="view-links">
        <div class="card" style="margin-bottom:20px;padding:16px 24px">
          <div style="display:flex;align-items:center;gap:20px;width:100%;flex-wrap:wrap;justify-content:space-between">
            <!-- Step 1 -->
            <div style="display:flex;align-items:center;gap:12px;min-width:180px;flex:1">
              <div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--accent) 0%,var(--accent-dark) 100%);color:#fff;font-size:13px;font-weight:800;box-shadow:0 0 12px rgba(37,244,238,0.35);flex-shrink:0">1</div>
              <div>
                <div style="font-weight:700;font-size:13px;color:#fff">Crie o Link</div>
                <div style="font-size:11.5px;color:var(--text-muted)">Cadastre seu checkout</div>
              </div>
            </div>
            
            <!-- Arrow / Line 1 -->
            <div style="height:2px;background:linear-gradient(90deg,var(--border2),transparent);flex:1;min-width:20px;max-width:100px" class="step-line"></div>
            
            <!-- Step 2 -->
            <div style="display:flex;align-items:center;gap:12px;min-width:210px;flex:1.2">
              <div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--success) 0%,var(--accent) 100%);color:#fff;font-size:13px;font-weight:800;box-shadow:0 0 12px rgba(16,185,129,0.3);flex-shrink:0">2</div>
              <div>
                <div style="font-weight:700;font-size:13px;color:#fff">Divulgue o Link</div>
                <div style="font-size:11.5px;color:var(--text-muted)">Use a URL <code>/go/&lt;slug&gt;</code></div>
              </div>
            </div>
            
            <!-- Arrow / Line 2 -->
            <div style="height:2px;background:linear-gradient(90deg,var(--border2),transparent);flex:1;min-width:20px;max-width:100px" class="step-line"></div>
            
            <!-- Step 3 -->
            <div style="display:flex;align-items:center;gap:12px;min-width:180px;flex:1">
              <div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--warning) 0%,var(--success) 100%);color:#fff;font-size:13px;font-weight:800;box-shadow:0 0 12px rgba(245,158,11,0.3);flex-shrink:0">3</div>
              <div>
                <div style="font-weight:700;font-size:13px;color:#fff">Rastreie Tudo</div>
                <div style="font-size:11.5px;color:var(--text-muted)">Monitore convers&otilde;es ao vivo</div>
              </div>
            </div>
          </div>
        </div>
        <div class="grid dynamic-grid" id="lk-grid">
          <div class="card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
              <h3 style="font-size:16px">Meus links</h3>
              <button class="btn btn-sm primary" id="lk-new">+ Criar link</button>
            </div>
            <div id="lk-list"></div>
          </div>
          <div class="card" id="lk-form-card" style="display:none">
            <h3 style="font-size:16px;margin-bottom:14px" id="lk-form-title">Novo link</h3>
            <div class="form-row">
              <label>Nome</label>
              <input class="inp" id="lk-name" placeholder="Oferta Espanha" style="width:100%">
            </div>
            <div class="form-row">
              <label>URL do checkout <span class="hint">— a p&aacute;gina de destino do seu an&uacute;ncio</span></label>
              <input class="inp" id="lk-url" placeholder="https://pay.gateway.com/oferta" style="width:100%;font-family:'Geist Mono',monospace;font-size:12.5px">
              <p class="hint" style="margin-top:6px;line-height:1.7">Este link j&aacute; passa pelo <b>filtro de bots</b> e dispara o <b>pixel</b> configurado. Use a URL <code>/go/&hellip;</code> como destino no TikTok Ads.</p>
            </div>
            <details class="ck-adv" id="lk-ab-wrap" style="margin-top:4px;margin-bottom:14px">
              <summary>Teste A/B de checkout externo <span class="hint" style="font-weight:400">&mdash; opcional: divide o tr&aacute;fego com outro checkout</span><svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></summary>
              <div class="ck-adv-body">
                <p class="hint" style="margin:0 0 12px;line-height:1.7">Um segundo checkout que <b>compartilha o mesmo pixel e o mesmo filtro de bots</b>. O tr&aacute;fego v&aacute;lido &eacute; dividido entre os dois para voc&ecirc; comparar convers&atilde;o.</p>
                <div class="form-row" style="margin-bottom:10px">
                  <label>URL do checkout B</label>
                  <input class="inp" id="lk-url-b" placeholder="https://outro-checkout.com/oferta" style="width:100%;font-family:'Geist Mono',monospace;font-size:12.5px">
                </div>
                <div class="form-row" style="margin-bottom:0">
                  <label>Divis&atilde;o do tr&aacute;fego <span class="hint">— % que vai para o checkout B</span></label>
                  <div style="display:flex;align-items:center;gap:10px">
                    <input type="range" id="lk-ab-split" min="10" max="90" step="5" value="50" style="flex:1">
                    <span id="lk-ab-split-val" style="font-variant-numeric:tabular-nums;font-size:12.5px;color:var(--muted2);min-width:96px;text-align:right">A 50% / B 50%</span>
                  </div>
                </div>
              </div>
            </details>
            <details class="ck-adv" style="margin-top:4px;margin-bottom:14px">
              <summary>Op&ccedil;&otilde;es avan&ccedil;adas<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></summary>
              <div class="ck-adv-body">
                <p class="hint" style="margin:0 0 12px;line-height:1.7">Formato completo da linha (tudo opcional al&eacute;m da URL):<br><code>nome | URL | peso % | URL celular</code><br>Com a URL celular preenchida, computador vai para a principal e celular vai para a alternativa.</p>
                <div class="form-row" style="margin-bottom:0">
                  <label>Dom&iacute;nio do link</label>
                  <select class="inp" id="lk-domain" style="width:100%;font-family:'Geist Mono',monospace"></select>
                  <p class="hint" id="lk-domain-status" style="margin-top:8px"></p>
                  <p class="hint" style="margin-top:4px;line-height:1.6">Só aparecem dom&iacute;nios <b>verificados</b>. Cadastre e verifique em <b>Dom&iacute;nio personalizado</b> (abaixo) para us&aacute;-lo aqui.</p>
                </div>
              </div>
            </details>
            <div class="form-row">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="lk-active" checked> Link ativo</label>
            </div>
            <div style="display:flex;gap:10px;margin-top:6px">
              <button class="btn primary" id="lk-save">Salvar link</button>
              <button class="btn" id="lk-cancel">Cancelar</button>
            </div>
            <input type="hidden" id="lk-slug" value="">
          </div>
        </div>
        <!-- domínio próprio: recolhido por padrão, é opcional -->
        <details class="ck-adv" style="margin-top:20px">
          <summary>Dom&iacute;nio personalizado <span class="hint" style="font-weight:400">&mdash; opcional: use o SEU dom&iacute;nio nos an&uacute;ncios</span><svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></summary>
          <div class="ck-adv-body">
            <div style="display:flex;gap:8px;align-items:center;margin:4px 0 14px">
              <input class="inp" id="dm-host" placeholder="link.seudominio.com" style="flex:1;max-width:340px;font-family:'Geist Mono',monospace">
              <button class="btn btn-sm primary" id="dm-add">+ Adicionar</button>
            </div>
            <div id="dm-list" style="margin-bottom:14px"></div>
            
            <div class="domain-tut-container" style="margin-top: 16px; display: flex; flex-direction: column; gap: 16px; margin-bottom: 20px">
              <div style="font-weight: 600; color: var(--text); font-size: 13.5px; display: flex; align-items: center; gap: 8px">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:16px;height:16px;color:var(--accent)"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                Configura&ccedil;&atilde;o DNS R&aacute;pida:
              </div>
              
              <!-- Passo 1 -->
              <div class="tut-step" style="border-left: 4px solid var(--pink); margin-bottom: 0">
                <span class="tut-n">1</span>
                <div class="tut-txt">
                  <b>Crie um registro CNAME</b>
                  <p>No painel do seu dom&iacute;nio (Cloudflare, Hostgator, Godaddy&hellip;), v&aacute; em <b>Configura&ccedil;&atilde;o de DNS</b>.</p>
                </div>
              </div>

              <!-- Passo 2 -->
              <div class="tut-step" style="border-left: 4px solid var(--accent); margin-bottom: 0">
                <span class="tut-n">2</span>
                <div class="tut-txt">
                  <b>Preencha com estas informa&ccedil;&otilde;es</b>
                  <p>Adicione o novo registro do tipo <b>CNAME</b> usando os dados abaixo:</p>
                  
                  <div class="mock-container" style="margin-top: 10px">
                    <div class="mock-header">
                      <span class="mock-dot"></span><span class="mock-dot"></span><span class="mock-dot"></span>
                      <span class="mock-title">📋 Tabela de DNS (Copiar e Colar)</span>
                    </div>
                    <div class="mock-body" style="background: #090c15; padding: 12px">
                      <div style="display: grid; grid-template-columns: 80px 110px 1fr; gap: 8px; font-weight: 600; font-size: 11px; text-transform: uppercase; color: var(--text-muted); border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px; margin-bottom: 8px">
                        <div>Tipo</div>
                        <div>Nome / Host</div>
                        <div>Destino / Valor</div>
                      </div>
                      <div style="display: grid; grid-template-columns: 80px 110px 1fr; gap: 8px; font-family: 'Geist Mono', monospace; font-size: 11.5px; align-items: center">
                        <div style="color: var(--pink); font-weight: bold">CNAME</div>
                        <div style="color: #fff">link <span style="font-size:11px; opacity:0.5">(ou o seu)</span></div>
                        <div style="display: flex; align-items: center; gap: 6px; overflow: hidden">
                          <span class="dm-apphost" style="color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap">carregando...</span>
                          <button class="btn btn-xs" style="padding: 2px 8px; font-size: 11px; background: rgba(37,244,238,0.15); border-color: rgba(37,244,238,0.3); color: var(--accent); font-family: inherit; margin-left: auto" onclick="navigator.clipboard.writeText(DM_APPHOST).then(function(){toast('Destino copiado!')}).catch(function(){toast('Erro ao copiar',false)})">Copiar</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Passo 3 -->
              <div class="tut-step" style="border-left: 4px solid var(--success); margin-bottom: 0">
                <span class="tut-n">3</span>
                <div class="tut-txt">
                  <b>Pronto \u2014 verificamos sozinhos</b>
                  <p>Assim que o DNS propagar, o dom&iacute;nio &eacute; verificado automaticamente e todos os seus links passam a usar o seu endere&ccedil;o.</p>
                </div>
              </div>
            </div>
          </div>
        </details>
        <div class="section-title"><span>Desempenho A/B por link</span><span class="line"></span><span class="muted" style="font-size:11.5px">cliques &#8594; convers&otilde;es por variante</span></div>
        <div id="lk-perf"></div>
        <div class="section-title"><span>Convers&atilde;o por p&aacute;gina</span><span class="line"></span><span class="muted" style="font-size:11.5px">onde o lead entra &times; quanto converte</span></div>
        <div class="card" style="padding:0">
          <div class="tbl-wrap" style="border:0">
            <table>
              <thead><tr><th>P&aacute;gina</th><th>Leads</th><th>Foram ao checkout</th><th>Compras</th><th>Convers&atilde;o</th></tr></thead>
              <tbody id="pg-conv"></tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ��─ Filtro de Bots / Revisores TikTok (cloaking) ── -->
      <section class="view" id="view-cloak">
        <div class="block-head"><span class="bh-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span><div><h2>Filtro de Bots</h2><p>Crie links de cloaking &mdash; cada um com sua pr&oacute;pria prote&ccedil;&atilde;o, offer e white page</p></div></div>

        <div class="card" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:16px">
          <div style="flex:1;min-width:180px">
            <h3 style="font-size:15px;margin:0">Seus links de cloaking</h3>
            <p class="hint" style="margin:3px 0 0">Cada link gera uma URL <code>/c/&lt;slug&gt;</code>. Bots e revisores v&atilde;o para a white page; pessoas reais seguem para a offer.</p>
          </div>
          <button class="btn primary" id="ck-new" type="button">+ Criar link de cloaking</button>
        </div>

        <div class="card" style="margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div style="flex:1;min-width:220px">
              <h3 style="font-size:15px;margin:0">P&aacute;gina segura padr&atilde;o <span class="hint">(fail-safe)</span></h3>
              <p class="hint" style="margin:3px 0 0">Destino dos bots quando um link n&atilde;o tem white page pr&oacute;pria. Se vazio, usamos uma p&aacute;gina neutra embutida (<code>/_safe</code>). Bots <b>nunca</b> chegam &agrave; offer.</p>
            </div>
            <div id="ck-agg" style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;align-items:center"></div>
            <button class="btn btn-sm" id="ck-stats-refresh" type="button">Atualizar m&eacute;tricas</button>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
            <input class="inp" id="ck-global-white" type="url" placeholder="https://seu-site.com/pagina-neutra" style="flex:1;min-width:220px">
            <button class="btn" id="ck-global-white-save" type="button">Salvar</button>
          </div>
        </div>

        <div id="ck-list"></div>
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
            <option value="lead">Cliques em links</option>
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
        <div class="grid dynamic-grid" id="px-grid">
          <div class="card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
              <h3 style="font-size:16px">Pixels configurados</h3>
              <button class="btn btn-sm primary" id="px-new">+ Adicionar pixel</button>
            </div>
            <div id="px-list"></div>
          </div>
          <div class="card" id="px-form-card" style="display:none">
            <h3 style="font-size:16px;margin-bottom:4px" id="px-form-title">Novo pixel</h3>
            <p class="hint" style="margin-bottom:14px">Cada pixel fica guardado separadamente e continua funcionando sozinho, mesmo com esta tela fechada.</p>
            <div class="form-row">
              <label>Nome <span class="hint">— só para você identificar (ex.: a campanha)</span></label>
              <input class="inp" id="px-name" placeholder="Campanha Espanha" style="width:100%">
            </div>
            <div class="form-row">
              <label>ID do Pixel <span class="hint">— copie do TikTok, em Events Manager &rarr; seu pixel</span></label>
              <input class="inp" id="px-code" placeholder="C0ABC1DE2FGH3IJKLM" style="width:100%;font-family:'Geist Mono',monospace">
            </div>
            <div class="form-row">
              <label>Token de acesso <span class="hint">— copie do TikTok (opcional, mas recomendado)</span></label>
              <input class="inp" id="px-token" placeholder="cole aqui o token do TikTok" style="width:100%;font-family:'Geist Mono',monospace" autocomplete="off">
            </div>
            <div class="form-row">
              <label>Eventos enviados direto ao TikTok <span class="hint">— pelo servidor, mais confiável</span></label>
              <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="px-ev-vc" checked> ViewContent</label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="px-ev-ic" checked> InitiateCheckout</label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="px-ev-cp" checked> CompletePayment</label>
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
        <div class="section-title"><span>Sa&uacute;de dos disparos</span><span class="line"></span><button class="btn-icon" id="ph-refresh">Atualizar</button></div>
        <div class="card">
          <div class="ph-kpis">
            <div class="ph-k"><span class="ph-v" id="ph-rate">--</span><span class="ph-l">Taxa de sucesso</span></div>
            <div class="ph-k"><span class="ph-v" id="ph-emq">--</span><span class="ph-l">Qualidade de match</span></div>
            <div class="ph-k"><span class="ph-v" id="ph-queue">--</span><span class="ph-l">Na fila de retry</span></div>
            <div class="ph-k"><span class="ph-v" id="ph-total">--</span><span class="ph-l">Disparos analisados</span></div>
          </div>
          <div id="ph-events" class="hint" style="margin-top:12px"></div>
          <div id="ph-errors" style="margin-top:6px"></div>
        </div>
        <div class="section-title"><span>Tend&ecirc;ncia de qualidade (EMQ)</span><span class="line"></span><span class="muted" style="font-size:11.5px">m&eacute;dia di&aacute;ria por pixel</span></div>
        <div class="card">
          <div class="hint" style="margin-bottom:10px">O <b>Event Match Quality</b> (0&ndash;10) mede quanto sinal de identidade casa com o TikTok. Quando cai, a otimiza&ccedil;&atilde;o piora em sil&ecirc;ncio &mdash; fique de olho nos alertas.</div>
          <div id="emq-trend"><div class="muted" style="font-size:12.5px">Carregando&hellip;</div></div>
        </div>
        <!-- Guia de instalação: só aparece quando existe pelo menos 1 pixel
             (o script é único por domínio e injeta todos os pixels ativos) -->
        <div id="tk-guide" style="display:none">
        <div class="section-title"><span>Como ativar o rastreamento</span><span class="line"></span><span class="muted" style="font-size:11.5px">um s&oacute; script para todos os pixels</span></div>
        <div class="card">
          <div class="tut-step" style="border-left:3px solid var(--pink)">
            <span class="tut-n">1</span>
            <div class="tut-txt">
              <b>Copie o c&oacute;digo</b>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
                <input class="inp" id="tk-snippet" readonly value="" style="flex:1;min-width:260px;font-family:'Geist Mono',monospace;font-size:12.5px;background:var(--bg2)">
                <button class="btn btn-sm primary" id="tk-copy">Copiar C&oacute;digo</button>
              </div>
            </div>
          </div>
          <div class="tut-step" style="border-left:3px solid var(--accent)">
            <span class="tut-n">2</span>
            <div class="tut-txt">
              <b>Cole no seu criador de p&aacute;ginas</b>
              <p>No campo de <b>scripts personalizados / cabe&ccedil;alho (head)</b> do Elementor, Wix, WordPress, GreatPages, etc.</p>
            </div>
          </div>
          <div class="tut-step" style="border-left:3px solid var(--success);margin-bottom:0">
            <span class="tut-n">3</span>
            <div class="tut-txt">
              <b>Salve e publique</b>
              <p>Pronto \u2014 visitas e compras passam a aparecer aqui em tempo real. Com dom&iacute;nio pr&oacute;prio verificado, o c&oacute;digo usa o seu endere&ccedil;o automaticamente.</p>
            </div>
          </div>
        </div>
        </div>
        <div class="section-title"><span>Integração Automática com Plataforma de Vendas (Webhook)</span><span class="line"></span></div>
        <div class="card">
          <div class="steps">
            <span class="step"><b>1</b> Copie o link abaixo</span>
            <span class="step"><b>2</b> Cole no painel da sua plataforma (Kiwify, Hotmart, PerfectPay, Monetizze, Appmax...)</span>
            <span class="step"><b>3</b> Pronto! Toda venda cai automática aqui e envia para o TikTok</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input class="inp" id="cw-url" readonly value="" style="flex:1;min-width:260px;font-family:'Geist Mono',monospace;font-size:12.5px">
            <button class="btn btn-sm" id="cw-reveal" title="Mostrar/ocultar segredo">Revelar</button>
            <button class="btn btn-sm primary" id="cw-copy">Copiar URL</button>
            <button class="btn btn-sm" id="cw-test" title="Envia um disparo de teste e mostra o resultado">Testar</button>
          </div>
          <div class="mini-feats">
            <span>Toda venda vira evento no pixel</span>
            <span>PIX gerado marca o lead como checkout</span>
            <span>Sem duplicar (dedup por pedido)</span>
          </div>
          <p class="hint" id="cw-status" style="margin-top:10px"></p>
        </div>
        <div class="section-title"><span>Webhooks recebidos</span><span class="line"></span><select class="select" id="cw-gw-filter" style="width:auto;min-width:140px;padding:5px 10px;font-size:12px"><option value="">Todos os gateways</option></select><button class="btn-icon" id="cw-log-refresh">Atualizar</button></div>
        <div class="card" style="padding:0">
          <div class="tbl-wrap" style="border:0">
            <table>
              <thead><tr><th>Quando</th><th>Gateway</th><th>Evento</th><th>Valor</th><th>Match</th><th>Status CAPI</th></tr></thead>
              <tbody id="cw-log"></tbody>
            </table>
          </div>
        </div>
        <div class="section-title"><span>Disparos server-side recentes</span><span class="line"></span><button class="btn-icon" id="px-log-refresh">Atualizar</button></div>
        <div class="card" style="padding:0">
          <div class="tbl-wrap" style="border:0">
            <table>
              <thead><tr><th>Quando</th><th>Pixel</th><th>Evento</th><th>Lead</th><th>Qualidade</th><th>Status</th><th>Resposta</th></tr></thead>
              <tbody id="px-log"></tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ── Gateways de pagamento (webhook dedicado por gateway) ─�� -->
      <section class="view" id="view-gateways">
        <div class="alert info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><div><b>Um webhook exclusivo para cada gateway</b><p>Cadastre seu gateway (Kiwify, Hotmart, Stripe&hellip;) e receba uma URL &uacute;nica e secreta. Cole a URL no painel do gateway e as vendas caem aqui automaticamente &mdash; cada conta enxerga s&oacute; os pr&oacute;prios webhooks.</p></div></div>
        <div class="grid dynamic-grid" id="gw-grid">
          <div class="card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
              <h3 style="font-size:16px">Meus gateways</h3>
              <button class="btn btn-sm primary" id="gw-new">+ Adicionar gateway</button>
            </div>
            <div id="gw-list"></div>
          </div>
          <div class="card" id="gw-form-card" style="display:none">
            <h3 style="font-size:16px;margin-bottom:6px" id="gw-form-title">Novo gateway</h3>
            <p class="hint" style="margin:0 0 14px;line-height:1.7">Escolha a plataforma e d&ecirc; um nome. Ao salvar, voc&ecirc; recebe uma URL de notifica&ccedil;&atilde;o &mdash; cole-a no painel do seu checkout e as vendas entram sozinhas aqui.</p>
            <input type="hidden" id="gw-id" value="">
            <div class="form-row">
              <label>Plataforma</label>
              <select class="inp" id="gw-provider" style="width:100%"></select>
              <p class="hint" id="gw-provider-docs" style="margin-top:6px;line-height:1.7"></p>
            </div>
            <div class="form-row">
              <label>Nome <span class="hint">&mdash; s&oacute; para voc&ecirc; identificar</span></label>
              <input class="inp" id="gw-name" placeholder="Loja Espanha" style="width:100%">
            </div>
            <div class="form-row" id="gw-secret-row">
              <label id="gw-secret-label">Segredo (opcional)</label>
              <input class="inp" id="gw-secret" placeholder="cole aqui o segredo do gateway" style="width:100%;font-family:'Geist Mono',monospace;font-size:12.5px">
              <p class="hint" style="margin-top:6px;line-height:1.7">Sem segredo, o token secreto da URL j&aacute; autentica os webhooks.</p>
            </div>
            <div style="display:flex;gap:8px;margin-top:14px">
              <button class="btn btn-sm primary" id="gw-save">Salvar gateway</button>
              <button class="btn btn-sm" id="gw-cancel">Cancelar</button>
            </div>
          </div>
        </div>
      </section>

      <!-- ── Configurações: coluna única, leitura de cima para baixo ── -->
      <section class="view" id="view-config">
        <div class="settings-col">

        <!-- 1. Setup guiado -->
        <div class="set-sec">
          <div class="set-sec-head"><h3>Configura&ccedil;&atilde;o do sistema</h3><p>Integra&ccedil;&otilde;es e vari&aacute;veis deste servidor &mdash; complete as pendentes</p></div>
          <div class="card"><div class="health-grid" id="health-grid" aria-busy="true"><div class="skel skel-row"></div><div class="skel skel-row"></div><div class="skel skel-row"></div></div></div>
        </div>

        <!-- 2. Notificações: toggles com auto-save -->
        <div class="set-sec">
          <div class="set-sec-head"><h3>Notifica&ccedil;&otilde;es Pushcut</h3><p>Push no celular a cada evento do gateway &mdash; salva automaticamente ao alternar</p></div>
          <div class="card">
            <div class="form-row">
              <label>Webhook do Pushcut <span class="hint">— copie do app: Notifica&ccedil;&atilde;o &#8594; Webhook</span></label>
              <div style="display:flex;gap:8px;align-items:center">
                <input class="inp" id="pc-url" placeholder="https://api.pushcut.io/.../notifications/Aprovada" style="flex:1;font-family:'Geist Mono',monospace;font-size:12.5px" autocomplete="off" />
                <button class="btn btn-sm" id="pc-test">Enviar teste</button>
              </div>
            </div>
            <div class="tgl-list">
              <label class="tgl-row"><div class="tgl-txt"><b>Venda aprovada</b><span>toda compra confirmada pelo gateway</span></div><span class="switch"><input type="checkbox" id="pc-ev-sale" checked><span class="slider"></span></span></label>
              <label class="tgl-row"><div class="tgl-txt"><b>Recusada</b><span>tentativa de pagamento que falhou</span></div><span class="switch"><input type="checkbox" id="pc-ev-failed" checked><span class="slider"></span></span></label>
              <label class="tgl-row"><div class="tgl-txt"><b>Reembolso</b><span>cliente pediu o dinheiro de volta</span></div><span class="switch"><input type="checkbox" id="pc-ev-refund" checked><span class="slider"></span></span></label>
              <label class="tgl-row"><div class="tgl-txt"><b>Disputa</b><span>chargeback aberto &mdash; exige resposta</span></div><span class="switch"><input type="checkbox" id="pc-ev-dispute" checked><span class="slider"></span></span></label>
              <label class="tgl-row"><div class="tgl-txt"><b>Checkout iniciado</b><span>lead chegou &agrave; p&aacute;gina de pagamento</span></div><span class="switch"><input type="checkbox" id="pc-ev-checkout"><span class="slider"></span></span></label>
              <label class="tgl-row"><div class="tgl-txt"><b>Resumo di&aacute;rio</b><span>vendas e receita na virada do dia</span></div><span class="switch"><input type="checkbox" id="pc-ev-daily"><span class="slider"></span></span></label>
            </div>
            <p class="hint" id="pc-status" style="margin-top:10px"></p>
          </div>
        </div>

        <!-- 3. Avançado recolhido: ferramentas usadas raramente ficam fora do caminho -->
        <details class="ck-adv" style="margin-top:0">
          <summary>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;color:var(--muted)"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 010-4h.09A1.65 1.65 0 003.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H8a1.65 1.65 0 001-1.51V2a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V8a1.65 1.65 0 001.51 1H22a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
            Avan&ccedil;ado &mdash; links curtos e API p&uacute;blica
            <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M6 9l6 6 6-6"/></svg>
          </summary>
          <div class="ck-adv-body">
            <div class="grid cfg-grid" style="grid-template-columns:1fr 1fr">
              <div class="card cfg-card" style="--cc:var(--cyan)">
                <div class="cfg-head">
                  <span class="cfg-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg></span>
                  <div><h3>Links curtos rastre&aacute;veis</h3><p>O clique vira lead e o funil come&ccedil;a no an&uacute;ncio</p></div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <input class="inp" id="sl-slug" placeholder="slug (ex: promo-eua)" style="flex:1;min-width:120px;font-family:'Geist Mono',monospace;font-size:12.5px" autocomplete="off" />
                  <input class="inp" id="sl-url" placeholder="https://destino.com/pagina" style="flex:2;min-width:180px;font-family:'Geist Mono',monospace;font-size:12.5px" autocomplete="off" />
                  <button class="btn primary" id="sl-add">Criar</button>
                </div>
                <div id="sl-list" style="margin-top:12px"></div>
              </div>
              <div class="card cfg-card" style="--cc:var(--amber,#f5a524)">
                <div class="cfg-head">
                  <span class="cfg-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg></span>
                  <div><h3>API p&uacute;blica (somente leitura)</h3><p>M&eacute;tricas por token &mdash; planilhas, widgets ou BI</p></div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                  <input class="inp" id="api-url" readonly placeholder="Clique em Gerar para criar o endpoint" style="flex:1;min-width:220px;font-family:'Geist Mono',monospace;font-size:11.5px" />
                  <button class="btn" id="api-gen">Gerar</button>
                  <button class="btn" id="api-copy" hidden>Copiar</button>
                </div>
                <details style="margin-top:10px"><summary class="hint" style="cursor:pointer">Como funciona</summary><p class="hint" style="margin-top:6px">Retorna JSON com leads, vendas, receita e convers&atilde;o (hoje, 7 dias e total). No Google Sheets: <span style="font-family:'Geist Mono',monospace">=IMPORTDATA(url)</span></p></details>
              </div>
            </div>
          </div>
        </details>
        <!-- 4. Zona de perigo -->
        <div class="set-sec">
          <div class="set-sec-head"><h3 style="color:var(--red)">Zona de perigo</h3><p>A&ccedil;&otilde;es irrevers&iacute;veis &mdash; use com cuidado</p></div>
          <div class="card danger-card">
            <span class="cfg-ico" style="--cc:var(--red)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6"/></svg></span>
            <div style="flex:1;min-width:200px"><b style="font-size:13.5px">Zerar todas as estatísticas</b><p style="color:var(--muted2);margin:3px 0 0;font-size:12px">Apaga leads, eventos e contadores. Não afeta configurações ou chaves.</p></div>
            <button class="btn danger" id="reset-btn">Zerar estatísticas</button>
          </div>
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

<!-- Popup genérico (confirmações e boas-vindas) — substitui os confirm() nativos -->
<div class="pop-bg" id="pop-bg" role="presentation">
  <div class="pop" role="dialog" aria-modal="true" aria-labelledby="pop-title">
    <div class="pop-ico" id="pop-ico"></div>
    <h3 id="pop-title"></h3>
    <p id="pop-msg"></p>
    <div class="pop-actions">
      <button class="btn ghost" id="pop-cancel">Cancelar</button>
      <button class="btn" id="pop-ok">Confirmar</button>
    </div>
  </div>
</div>

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

var DATA=null, HEALTH=null, period='7d', chartMode='revenue', evFilter='', autoTimer=null, currentView='overview', currentLeadId=null;
// preferência do usuário por menos movimento — desliga animações não essenciais no JS
var REDUCED=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var NOTES=[]; // anotações do gráfico (carregadas de /api/notes)
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
  // Gateways são dinâmicos: qualquer nome que chegue pelo webhook universal
  // ou pelos links /go/ ("link:slug") vira uma entrada própria.
  var gw={};
  lp.forEach(function(l){
    if(!l.gateway) return;
    if(!gw[l.gateway]) gw[l.gateway]={checkout:0,purchased:0};
    if(l.stage==='checkout'||l.stage==='purchased') gw[l.gateway].checkout++;
    if(l.stage==='purchased') gw[l.gateway].purchased++;
  });
  var rev={}, sales=0, failed=0, refunds=0, disputes=0;
  events.forEach(function(e){
    if(!inPeriod(e.at)) return;
    if(e.type==='sale'){
      sales++;
      var c=(e.currency||'EUR').toUpperCase();
      rev[c]=(rev[c]||0)+(e.amount||0);
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
    rev:rev, sales:sales, failed:failed, refunds:refunds, disputes:disputes,
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
  else if(kind==='refunds'||kind==='disputes'){ var tp=kind==='refunds'?'refund':'dispute'; (DATA.events||[]).forEach(function(e){ if(e.type!==tp)return; put(new Date(e.at).getTime(),1); }); }
  else if(kind==='ticket'){ var rv=[],ct=[]; for(var j2=0;j2<n;j2++){rv.push(0);ct.push(0);} (DATA.events||[]).forEach(function(e){ if(e.type!=='sale')return; var t2=new Date(e.at).getTime(); if(t2<from||t2>to)return; var i2=Math.min(n-1,Math.floor((t2-from)/step)); rv[i2]+=e.amount||0; ct[i2]++; }); for(var k2=0;k2<n;k2++){ arr[k2]=ct[k2]?rv[k2]/ct[k2]:0; } }
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
// Micro-gráfico de barras (distribuição por bucket) — mesmo footprint do spark
function sparkBars(values,color){
  if(!values||!values.length) return '';
  var max=Math.max.apply(null,values); if(max<=0) return '';
  return '<div class="k-spark k-bars">'+values.map(function(v,i){
    var h=Math.max(6,Math.round(v/max*100));
    return '<i style="--bh:'+h+'%;background:'+color+';animation-delay:'+(i*45)+'ms;opacity:'+(v>0?1:.25)+'"></i>';
  }).join('')+'</div>';
}
// Funil compacto (Visita → Checkout → Compra) para o card Conversão
function funnelMini(m){
  var rows=[
    ['Visita',100,'#25f4ee'],
    ['Checkout',m.v2c,'#06b6d4'],
    ['Compra',m.overall,'#22c55e']
  ];
  return '<div class="k-funnel">'+rows.map(function(r,i){
    return '<div class="kf-row"><span class="kf-lbl">'+r[0]+'</span>'+
      '<span class="kf-track"><i data-w="'+Math.max(2,Math.min(100,r[1]))+'" style="background:'+r[2]+';transition-delay:'+(0.15+i*0.12)+'s"></i></span>'+
      '<span class="kf-pct" style="color:'+r[2]+'">'+r[1]+'%</span></div>';
  }).join('')+'</div>';
}
// Mini-tabela top-5 países (bandeira + barra de volume + contagem)
function geoMini(countries){
  var top=(countries||[]).slice(0,5); if(!top.length) return '';
  var max=top[0].count||1;
  return '<div class="ms-geo">'+top.map(function(c,i){
    return '<div class="msg-row"><span class="msg-flag">'+flag(c.code)+'</span><span class="msg-code">'+esc(c.code)+'</span>'+
      '<span class="msg-track"><i data-w="'+Math.max(4,Math.round(c.count/max*100))+'" style="transition-delay:'+(0.2+i*0.09)+'s"></i></span>'+
      '<span class="msg-n">'+c.count+'</span></div>';
  }).join('')+'</div>';
}

/* ── Visão Geral ── */
// Contagem animada: anima do valor anterior at�� o novo (não pisca 0→N
// em cada atualização); se o valor não mudou, apenas fixa o texto.
// suffix pode ser string ('%') OU função formatadora (v => texto).
// dec = casas decimais (para percentuais tipo 3.4%).
var CU_LAST={};
function countUp(el,target,suffix,dur,dec){
  if(!el||isNaN(target)) return;
  var key=el.id||'anon';
  var fmt=typeof suffix==='function'?suffix:function(v){ return (dec?v.toFixed(dec):Math.round(v))+(suffix||''); };
  var from=CU_LAST[key]!=null?CU_LAST[key]:0;
  CU_LAST[key]=target;
  // reduced-motion: fixa direto, sem tween
  if(REDUCED||from===target){ el.textContent=fmt(target); return; }
  var start=null; dur=dur||900;
  function frame(ts){
    if(!start)start=ts;
    var p=Math.min(1,(ts-start)/dur);
    var eased=1-Math.pow(1-p,3);
    el.textContent=fmt(from+(target-from)*eased);
    if(p<1)requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
function mstat(icoColor,icoBg,ico,label,val,sub,barPct,barColor,valId,extra){
  return '<div class="mstat" style="--mc:'+icoColor+'">'+
    '<div class="ms-top"><span class="ms-ico" style="background:'+icoBg+';color:'+icoColor+'">'+ico+'</span>'+esc(label)+'</div>'+
    '<div class="ms-val"'+(valId?' id="'+valId+'"':'')+' style="color:'+icoColor+'">'+val+'</div>'+
    '<div class="ms-sub">'+(sub||'')+'</div>'+
    (barPct!=null?'<div class="ms-bar"><div class="ms-fill" data-w="'+Math.min(100,Math.max(0,barPct))+'" style="background:'+(barColor||icoColor)+'"></div></div>':'')+
    (extra||'')+
  '</div>';
}
function renderOverview(m){
  var w=prevWindow();
  var cur=w?aggregate(w.curFrom,w.curTo):null, prev=w?aggregate(w.prevFrom,w.prevTo):null;
  function dc(k,inv){ return (cur&&prev)?deltaChip(cur[k],prev[k],inv):''; }

  // cores semânticas: receita/aprovação = verde (dinheiro bom), leads = ciano, conversão = dinâmica
  // receita: tween com formatador de moeda quando há UMA moeda (caso comum);
  // multi-moeda cai no texto estático "X € + Y £"
  var revCurs=Object.keys(m.rev||{}).filter(function(c){return (m.rev[c]||0)>0;});
  var singleCur=revCurs.length<=1;
  // zeros neutros: valor zerado usa cinza — cor semântica só quando há sinal real
  function zc(v,cls){ return v>0?cls:'mut'; }
  var hasRev=revCurs.length>0&&(m.rev[revCurs[0]]||0)>0;
  var revHtml=singleCur?'<span class="'+(hasRev?'pos':'mut')+'" id="ov-cu-rev">'+money(0,revCurs[0]||'EUR')+'</span>':'<span class="pos">'+revObj(m.rev)+'</span>';
  document.getElementById('ov-kpis').removeAttribute('aria-busy');
  document.getElementById('ov-chips').removeAttribute('aria-busy');
  document.getElementById('ov-kpis').innerHTML=
    kpi(I.money,'tint-green','Receita total',revHtml,'no período selecionado', dc('rev')+spark(seriesFor('revenue'),'#22c55e'))+
    kpi(I.check,'tint-green','Vendas aprovadas','<span class="'+zc(m.sales,'pos')+'" id="ov-cu-sales">0</span>',(m.failed>0?'<span class="neg">'+m.failed+'</span>':'<span class="mut">0</span>')+' recusadas', dc('sales')+sparkBars(seriesFor('sales'),'#22c55e'))+
    kpi(I.users,'tint-cyan','Novos leads','<span class="'+zc(m.visits,'cyn')+'" id="ov-cu-visits">0</span>','entraram no funil', dc('visits')+spark(seriesFor('visits'),'#25f4ee'))+
    kpi(I.pct,'tint-amber','Conversão','<span class="'+(m.overall>0?pctColor(m.overall):'mut')+'" id="ov-cu-conv">0%</span>','visita &#8594; compra', dc('overall')+funnelMini(m));

  // ministats: aprovação verde quando saud��vel (ou sem tentativas), alertas âmbar/vermelho só quando existem
  var hasAttempts=(m.sales+m.failed)>0;
  // sem tentativas = neutro (cinza), não verde — zero não é sucesso nem falha
  var apColor=!hasAttempts?'#6b7183':m.approval>=70?'#22c55e':m.approval>=40?'#d97706':'#dc2626';
  var apBg=!hasAttempts?'rgba(107,113,131,.10)':m.approval>=70?'rgba(34,197,94,.12)':m.approval>=40?'rgba(217,119,6,.12)':'rgba(220,38,38,.12)';
  var refColor=m.refunds?'#d97706':'#6b7183', dispColor=m.disputes?'#dc2626':'#6b7183';
  // micro-gráficos: aprovação em barras, ticket/reembolsos/disputas em trendline,
  // países com mini-tabela de bandeiras + volume (só quando há dados no período)
  var hasSales=m.sales>0, hasGeo=m.countries.length>0;
  document.getElementById('ov-chips').innerHTML=
    mstat(apColor,apBg,I.check,'Aprovação',m.approval+'%',m.sales+' aprovadas de '+(m.sales+m.failed)+' tentativas',m.approval,apColor,'ov-cu-appr',((cur&&prev)?deltaChip(cur.approval,prev.approval):'')+(hasAttempts?sparkBars(seriesFor('approval'),apColor):''))+
    mstat(hasSales?'#22c55e':'#6b7183',hasSales?'rgba(34,197,94,.12)':'rgba(107,113,131,.10)',I.money,'Ticket médio',money(m.avgTicket,m.mainCur),'por venda aprovada',null,null,null,((cur&&prev&&prev.bought>0)?deltaChip(cur.bought?cur.rev/cur.bought:0,prev.rev/prev.bought):'')+(hasSales?spark(seriesFor('ticket'),'#22c55e'):''))+
    mstat(hasGeo?'#06b6d4':'#6b7183',hasGeo?'rgba(6,182,212,.1)':'rgba(107,113,131,.10)',I.globe,'Países ativos',m.countries.length,(hasGeo?'':'aguardando leads'),null,null,'ov-cu-geo',geoMini(m.countries))+
    mstat(refColor,m.refunds?'rgba(217,119,6,.12)':'rgba(34,197,94,.1)',I.refund,'Reembolsos',m.refunds,m.refunds?'exige aten\u00e7\u00e3o':'nenhum no per\u00edodo',null,null,'ov-cu-ref',m.refunds?spark(seriesFor('refunds'),refColor):'')+
    mstat(dispColor,m.disputes?'rgba(220,38,38,.12)':'rgba(34,197,94,.1)',I.dispute,'Disputas',m.disputes,m.disputes?'responda o quanto antes':'nenhuma aberta',null,null,'ov-cu-disp',m.disputes?spark(seriesFor('disputes'),dispColor):'');

  // dispara contagens e barras animadas (todos os números sobem animados)
  if(singleCur) countUp(document.getElementById('ov-cu-rev'),m.rev[revCurs[0]]||0,function(v){return money(Math.round(v),revCurs[0]||'EUR');},900);
  countUp(document.getElementById('ov-cu-sales'),m.sales);
  countUp(document.getElementById('ov-cu-visits'),m.visits);
  countUp(document.getElementById('ov-cu-conv'),parseFloat(m.overall)||0,'%',900,(''+m.overall).indexOf('.')>=0?1:0);
  countUp(document.getElementById('ov-cu-appr'),parseFloat(m.approval)||0,'%',900,(''+m.approval).indexOf('.')>=0?1:0);
  countUp(document.getElementById('ov-cu-geo'),m.countries.length);
  countUp(document.getElementById('ov-cu-ref'),m.refunds);
  countUp(document.getElementById('ov-cu-disp'),m.disputes);
  // renderizar globo hero na Visão Geral (se dados de países disponíveis)
  renderGlobeHero(m);
  
  requestAnimationFrame(function(){
    // todas as barras (progresso, funil e geo) crescem animadas de 0 → valor
    document.querySelectorAll('#ov-chips .ms-fill, #ov-kpis .kf-track i, #ov-chips .msg-track i').forEach(function(f){ f.style.width=f.getAttribute('data-w')+'%'; });
  });

  // render condicional: blocos sem dados não ocupam espaço (nem o título)
  var hasLeadsPeriod=m.visits>0, hasSalesPeriod=m.sales>0;
  var goalSec=document.getElementById('ov-goal-sec'); if(goalSec) goalSec.hidden=!hasSalesPeriod;
  var pagesSec=document.getElementById('ov-pages-sec'); if(pagesSec) pagesSec.hidden=!hasLeadsPeriod;
  var heatSec=document.getElementById('ov-heat-sec'); if(heatSec) heatSec.hidden=!(hasSalesPeriod||hasLeadsPeriod);
  if(hasSalesPeriod) renderGoal(m,prev);
  renderChart(m);
  if(hasLeadsPeriod){ renderPageFunnel(); renderEntries(m); }
  if(hasSalesPeriod||hasLeadsPeriod) renderHeatmap();
  renderNotesList();
  renderSetupCard();
}

/* ── Comparador de páginas de entrada: qual porta converte melhor ── */
function renderEntries(m){
  var el=document.getElementById('ov-entries'); if(!el) return;
  var lp=(DATA.leads||[]).filter(function(l){ return !l.orphan&&inPeriod(l.at); });
  var map={};
  lp.forEach(function(l){
    var p=l.landing||'—';
    if(!map[p]) map[p]={p:p,leads:0,ck:0,buy:0,rev:0};
    map[p].leads++;
    if(l.stage==='checkout'||l.stage==='purchased') map[p].ck++;
    if(l.stage==='purchased'){ map[p].buy++; map[p].rev+=(l.reportedAmount||l.expectedAmount||0); }
  });
  var rows=Object.keys(map).map(function(k){ return map[k]; });
  if(!rows.length){ el.innerHTML='<div class="empty">Sem leads no per&iacute;odo.</div>'; return; }
  rows.sort(function(a,b){ return b.rev-a.rev||b.buy-a.buy||b.leads-a.leads; });
  rows=rows.slice(0,8);
  // melhor conversão entre entradas com volume mínimo (evita coroar 1/1=100%)
  var best=null;
  rows.forEach(function(r){ if(r.leads>=5&&r.buy>0){ var c=r.buy/r.leads; if(!best||c>best.c) best={p:r.p,c:c}; } });
  var html='<table class="en-tbl"><thead><tr><th>Entrada</th><th class="num">Leads</th><th class="num">Checkout</th><th class="num">Compra</th><th class="num">Receita</th></tr></thead><tbody>';
  rows.forEach(function(r){
    var ckPct=r.leads?Math.round(r.ck/r.leads*100):0;
    var buyPct=r.leads?Math.round(r.buy/r.leads*1000)/10:0;
    var isBest=best&&best.p===r.p;
    html+='<tr'+(isBest?' class="en-best"':'')+'><td class="en-p" title="'+esc(r.p)+'">'+esc(r.p)+(isBest?'<span class="en-badge">melhor</span>':'')+'</td>'+
      '<td class="num">'+r.leads+'</td>'+
      '<td class="num">'+r.ck+' <span class="muted" style="font-size:10.5px">('+ckPct+'%)</span></td>'+
      '<td class="num">'+r.buy+' <span class="muted" style="font-size:10.5px">('+buyPct+'%)</span></td>'+
      '<td class="num">'+(r.rev?money(r.rev,m.mainCur):'—')+'</td></tr>';
  });
  el.innerHTML=html+'</tbody></table>';
}

/* ── Heatmap dia-da-semana × hora: quando o público age ── */
var heatMode='sales';
function renderHeatmap(){
  var el=document.getElementById('ov-heatmap'); if(!el) return;
  var grid=[]; for(var d=0;d<7;d++){ grid.push(new Array(24).fill(0)); }
  var total=0;
  if(heatMode==='sales'){
    (DATA.events||[]).forEach(function(e){
      if(e.type!=='sale'||!inPeriod(e.at)) return;
      var dt=new Date(e.at); grid[dt.getDay()][dt.getHours()]++; total++;
    });
  } else {
    (DATA.leads||[]).forEach(function(l){
      if(l.orphan||!inPeriod(l.at)) return;
      var dt=new Date(l.at); grid[dt.getDay()][dt.getHours()]++; total++;
    });
  }
  if(!total){ el.innerHTML='<div class="empty">Sem '+(heatMode==='sales'?'vendas':'leads')+' no per&iacute;odo.</div>'; return; }
  var max=0; grid.forEach(function(row){ row.forEach(function(v){ if(v>max)max=v; }); });
  var DIAS=['Dom','Seg','Ter','Qua','Qui','Sex','S&aacute;b'];
  var col=heatMode==='sales'?'34,197,94':'37,244,238';
  var html='<div class="hm-grid"><span></span>';
  for(var h=0;h<24;h++){ html+='<span class="hm-top">'+(h%3===0?h:'')+'</span>'; }
  for(var dd=0;dd<7;dd++){
    html+='<span class="hm-lbl">'+DIAS[dd]+'</span>';
    for(var hh=0;hh<24;hh++){
      var v=grid[dd][hh];
      var op=v?0.15+0.85*(v/max):0;
      html+='<span class="hm-cell" title="'+DIAS[dd].replace('&aacute;','á')+' '+hh+'h: '+v+'"'+(v?' style="background:rgba('+col+','+op.toFixed(2)+')"':'')+'></span>';
    }
  }
  html+='</div><div class="hm-foot">menos <i style="background:rgba('+col+',.15)"></i><i style="background:rgba('+col+',.45)"></i><i style="background:rgba('+col+',.8)"></i> mais</div>';
  el.innerHTML=html;
}

/* ── Funil por página: etapas reais da jornada dos leads ──
   Ordena as páginas pela posição média em que aparecem no trajeto
   (1ª página do funil primeiro) e mostra a perda entre cada etapa. */
function renderPageFunnel(){
  var el=document.getElementById('ov-pagefunnel'); if(!el) return;
  var lp=(DATA.leads||[]).filter(function(l){ return !l.orphan&&inPeriod(l.at); });
  var pages={}; // p -> {count, idxSum}
  var withJourney=0;
  lp.forEach(function(l){
    if(!l.journey||!l.journey.length) return;
    withJourney++;
    var seen={};
    l.journey.forEach(function(s,i){
      var p=s.p||'';
      if(!p||p.indexOf('go:')===0||p==='compra') return; // marcos não são páginas
      if(seen[p]) return; // 1ª passagem do lead conta a posição
      seen[p]=true;
      if(!pages[p]) pages[p]={p:p,count:0,idxSum:0};
      pages[p].count++; pages[p].idxSum+=i;
    });
  });
  var list=Object.keys(pages).map(function(k){ return pages[k]; });
  if(!withJourney||!list.length){
    el.innerHTML='<div class="empty">Assim que os leads navegarem pelas suas p&aacute;ginas (script instalado), o funil aparece aqui etapa por etapa.</div>';
    return;
  }
  // ordena pela posição média no trajeto; empate = maior volume primeiro
  list.sort(function(a,b){ var pa=a.idxSum/a.count, pb=b.idxSum/b.count; return pa===pb?(b.count-a.count):(pa-pb); });
  list=list.slice(0,5);
  var reached=lp.filter(function(l){ return l.stage==='checkout'||l.stage==='purchased'; }).length;
  var bought=lp.filter(function(l){ return l.stage==='purchased'; }).length;
  var steps=list.map(function(pg){ return {l:pg.p,v:pg.count,c:'#2f7dff'}; });
  steps.push({l:'Checkout',v:reached,c:'#06b6d4'});
  steps.push({l:'Compra',v:bought,c:'#22c55e'});
  var max=Math.max(steps[0].v,1);
  var html='';
  var DROP='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
  steps.forEach(function(st,i){
    var pct=Math.round(st.v/max*100);
    html+='<div class="pf-row"><span class="pf-lbl" title="'+esc(st.l)+'">'+esc(st.l)+'</span>'+
      '<span class="pf-track"><i data-w="'+Math.max(3,pct)+'" style="background:'+st.c+';transition-delay:'+(i*0.09)+'s"><span class="pf-n">'+st.v+'</span></i></span>'+
      '<span class="pf-pct" style="color:'+st.c+'">'+pct+'%</span></div>';
    // perda entre esta etapa e a próxima (só quando há queda real)
    if(i<steps.length-1&&st.v>0&&steps[i+1].v<st.v){
      var loss=Math.round((1-steps[i+1].v/st.v)*100);
      if(loss>=1) html+='<div class="pf-drop">'+DROP+loss+'% saem aqui</div>';
    }
  });
  el.innerHTML=html;
  requestAnimationFrame(function(){
    el.querySelectorAll('.pf-track i').forEach(function(f){ f.style.width=f.getAttribute('data-w')+'%'; });
  });
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
  var color=pct>=100?'#22c55e':pct>=60?'#2f7dff':pct>=30?'#d97706':'#dc2626';
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

/* ─��� Gráfico de tendência ── */
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
  if(chartMode==='leads'){
    // série de leads: cada lead novo (não-órfão) do período conta 1 no bucket
    (DATA.leads||[]).forEach(function(l){
      if(l.orphan||!inPeriod(l.at)) return;
      var j=idx(new Date(l.at).getTime());
      if(j>=0) buckets[j].sc+=1;
    });
  } else {
    events.forEach(function(e){
      var j=idx(new Date(e.at).getTime());
      if(j<0) return;
      var val=chartMode==='revenue'?(e.amount||0):100; // 100 cents = 1 unidade para escala
      buckets[j].sc+=val; // série única — gateways são todos externos agora
    });
  }
  var maxV=0;
  buckets.forEach(function(b){ maxV=Math.max(maxV,b.sc+b.cc); });
  if(!maxV) maxV=1;
  var hasData=buckets.some(function(b){return b.sc+b.cc>0;});
  var legend=document.getElementById('chart-legend');
  if(legend){
    legend.innerHTML=chartMode==='leads'
      ? '<span><span class="leg-dot" style="background:#06b6d4"></span>Novos leads no per&iacute;odo</span>'
      : '<span><span class="leg-dot" style="background:var(--cyan)"></span>Convers&otilde;es via gateway</span>';
  }
  if(!hasData){ el.innerHTML='<div class="empty" style="min-height:180px;display:flex;align-items:center;justify-content:center">'+(chartMode==='leads'?'Sem leads no per&iacute;odo.':'Sem vendas no per&iacute;odo.')+'</div>'; return; }
  var W=Math.max(520,el.clientWidth||520), H=200, padL=8, padR=8, padT=12, padB=24;
  var chartH=H-padT-padB;
  var bw=(W-padL-padR)/buckets.length;
  var barColor=chartMode==='leads'?'#06b6d4':'#2f7dff';
  var svg='<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="100%" preserveAspectRatio="none">';
  // gridlines
  for(var g=0;g<=4;g++){
    var gy=padT+chartH*(1-g/4);
    svg+='<line x1="'+padL+'" y1="'+gy+'" x2="'+(W-padR)+'" y2="'+gy+'" stroke="rgba(120,140,165,.18)" stroke-dasharray="3,3"/>';
  }
  // barras + zonas de hover (uma coluna invisível por bucket alimenta o tooltip)
  buckets.forEach(function(b,k){
    var x=padL+k*bw+bw*0.18; var w=bw*0.64;
    var baseY=padT+chartH;
    var scH=(chartH)*b.sc/maxV, ccH=(chartH)*b.cc/maxV;
    if(scH>0){ svg+='<rect x="'+x.toFixed(1)+'" y="'+(baseY-scH).toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+scH.toFixed(1)+'" rx="3" fill="'+barColor+'" opacity=".9"/>'; }
    if(ccH>0){ svg+='<rect x="'+x.toFixed(1)+'" y="'+(baseY-scH-ccH).toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+ccH.toFixed(1)+'" rx="3" fill="#dc2626" opacity=".9"/>'; }
  var dt=new Date(b.t);
  var lbl=isHour?(dt.getHours()+'h'):(dt.getDate()+'/'+(dt.getMonth()+1));
  svg+='<text x="'+(x+w/2).toFixed(1)+'" y="'+(padT+chartH+16)+'" fill="#6c6c80" font-size="9.5" text-anchor="middle" font-family="Inter,sans-serif">'+lbl+'</text>';
  // marcador de anotação: losango âmbar acima do dia anotado
  if(!isHour){
    var dayKey=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
    var note=NOTES.find(function(nn){ return nn.d===dayKey; });
    if(note){
      svg+='<rect class="note-dot" x="'+(x+w/2-3.5).toFixed(1)+'" y="'+(padT-6)+'" width="7" height="7" rx="1.5" fill="#f5a524" transform="rotate(45 '+(x+w/2).toFixed(1)+' '+(padT-2.5)+')"><title>'+note.d.split('-').reverse().join('/')+': '+note.text.replace(/</g,'&lt;')+'</title></rect>';
    }
  }
    // valor legível para o tooltip
    var tipVal=chartMode==='revenue'?money(b.sc,(m&&m.mainCur)||'EUR'):(chartMode==='sales'?Math.round(b.sc/100)+(Math.round(b.sc/100)===1?' venda':' vendas'):b.sc+(b.sc===1?' lead':' leads'));
    svg+='<rect class="ch-hz" data-lbl="'+lbl+'" data-val="'+tipVal.replace(/"/g,'&quot;')+'" data-cx="'+((k+0.5)/buckets.length*100).toFixed(2)+'" x="'+(padL+k*bw).toFixed(1)+'" y="0" width="'+bw.toFixed(1)+'" height="'+H+'" fill="transparent"/>';
  });
  svg+='</svg>';
  el.innerHTML=svg;
}
/* ── Anotações do gráfico: carregar, listar, criar e apagar ── */
function loadNotes(){
  fetch('/api/notes',{cache:'no-store'}).then(function(r){return r.json();}).then(function(j){
    NOTES=j.notes||[];
    renderNotesList();
    if(DATA) renderChart(metrics()); // redesenha para os marcadores aparecerem
  }).catch(function(){});
}
function renderNotesList(){
  var box=document.getElementById('chart-notes'); if(!box) return;
  // só notas dentro do período visível — compara o DIA inteiro da nota
  // (meio-dia fixo falhava de manhã: a nota de hoje ficava "no futuro")
  var r=periodRange();
  var vis=NOTES.filter(function(n){
    var d0=new Date(n.d+'T00:00:00').getTime(), d1=d0+864e5-1;
    return d1>=r.from&&d0<=r.to;
  });
  if(!vis.length){ box.hidden=true; box.innerHTML=''; return; }
  box.hidden=false;
  box.innerHTML=vis.map(function(n){
    return '<span class="cn-item"><b>'+n.d.split('-').reverse().slice(0,2).join('/')+'</b>'+esc(n.text)+
      '<button class="cn-x" data-d="'+n.d+'" title="Apagar nota" aria-label="Apagar nota">&times;</button></span>';
  }).join('');
}
function bindNotes(){
  var btn=document.getElementById('note-add');
  if(btn) btn.addEventListener('click',function(){
    var today=new Date(); var def=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
    var d=prompt('Dia da nota (AAAA-MM-DD):',def); if(!d) return;
    d=d.trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){ toast('Data inv\u00e1lida \u2014 use AAAA-MM-DD'); return; }
    var text=prompt('Nota (ex.: subi criativo novo, aumentei budget):',''); if(!text||!text.trim()) return;
    fetch('/api/notes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({d:d,text:text.trim()})})
      .then(function(r){return r.json();})
      .then(function(j){ if(j.ok){ toast('Nota salva'); loadNotes(); } else toast(j.error||'Erro ao salvar'); })
      .catch(function(){ toast('Erro ao salvar nota'); });
  });
  var box=document.getElementById('chart-notes');
  if(box) box.addEventListener('click',function(e){
    var x=e.target.closest?e.target.closest('.cn-x'):null; if(!x) return;
    fetch('/api/notes/'+x.getAttribute('data-d'),{method:'DELETE'})
      .then(function(){ toast('Nota apagada'); loadNotes(); }).catch(function(){});
  });
}

// Tooltip do gráfico: delegação única — sobrevive a re-renders do innerHTML
function bindChartTip(){
  var wrap=document.getElementById('chart'), tip=document.getElementById('chart-tip');
  if(!wrap||!tip) return;
  wrap.addEventListener('mousemove',function(e){
    var hz=e.target.closest?e.target.closest('.ch-hz'):null;
    if(!hz){ tip.hidden=true; return; }
    tip.innerHTML='<b>'+hz.getAttribute('data-val')+'</b><span>'+hz.getAttribute('data-lbl')+'</span>';
    tip.hidden=false;
    var card=wrap.parentElement, cr=card.getBoundingClientRect();
    var cx=parseFloat(hz.getAttribute('data-cx'))/100*wrap.clientWidth+wrap.offsetLeft;
    var left=Math.max(6,Math.min(cr.width-tip.offsetWidth-6,cx-tip.offsetWidth/2));
    tip.style.left=left+'px';
    tip.style.top=(wrap.offsetTop+6)+'px';
  });
  wrap.addEventListener('mouseleave',function(){ tip.hidden=true; });
}

/* ── Funil ── */
function renderFunnel(m){
  var max=Math.max(m.visits,1);
  var steps=[
    {l:'Visitaram',s:'topo do funil',v:m.visits,c:'#2f7dff',r:'100%'},
    {l:'Chegaram ao checkout',s:'iniciaram pagamento',v:m.reached,c:'#7ab8ff',r:m.v2c+'%'},
    {l:'Compraram',s:'pagamento aprovado',v:m.bought,c:'#22c55e',r:m.overall+'%'}
  ];
  document.getElementById('funnel-bars').innerHTML=steps.map(function(st){
    var w=Math.max(5,(st.v/max)*100);
    return '<div class="fstep">'+
      '<div class="flabel"><b>'+esc(st.l)+'</b><span>'+esc(st.s)+'</span></div>'+
      '<div class="fbar-track"><div class="fbar" style="width:'+w+'%;background:'+st.c+'">'+st.v+'</div></div>'+
      '<div class="frate">'+st.r+'</div></div>';
  }).join('');
  // Cards por gateway — dinâmico, um card para cada origem de checkout vista
  var gwNames=Object.keys(m.gw);
  var palette=['#2f7dff','#dc2626','#22c55e','#d97706','#06b6d4','#b98aff'];
  document.getElementById('fn-gateways').innerHTML=gwNames.length
    ? gwNames.map(function(name,i){ return gwCard(esc(gwLabel(name)),'checkout',m.gw[name],palette[i%palette.length]); }).join('')
    : '<div class="card"><div class="empty">Nenhum checkout registrado neste per&iacute;odo.</div></div>';
  renderLeadsTable();
}
// Rótulo amigável do gateway: "link:oferta-es" → "Link oferta-es"
function gwLabel(g){
  if(!g) return '—';
  if(g.indexOf('link:')===0) return 'Link '+g.slice(5);
  return g.charAt(0).toUpperCase()+g.slice(1);
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
  // popula o filtro de gateway dinamicamente com os gateways vistos nos leads
  var gwSel=document.getElementById('lead-gw');
  var gwf=gwSel.value;
  var seen={};
  (DATA.leads||[]).forEach(function(l){ if(l.gateway) seen[l.gateway]=true; });
  var opts='<option value="">Todos gateways</option>'+Object.keys(seen).sort().map(function(g){
    return '<option value="'+esc(g)+'"'+(g===gwf?' selected':'')+'>'+esc(gwLabel(g))+'</option>';
  }).join('');
  if(gwSel.dataset.opts!==opts){ gwSel.innerHTML=opts; gwSel.dataset.opts=opts; }
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
  body.innerHTML=leads.slice(0,200).map(function(l){
    var names={visit:'Visita',checkout:'Checkout',purchased:'Comprou'};
    var stageTag='<span class="tag '+l.stage+'">'+(names[l.stage]||l.stage)+'</span>';
    var gwTag=l.gateway?'<span class="tag checkout">'+esc(gwLabel(l.gateway))+'</span>':'<span class="muted">—</span>';
    var path=(l.checkoutHits&&l.checkoutHits.length)?l.checkoutHits.length+'x':'—';
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
// ── Lazy load da lib globe.gl (three.js ~1MB): só baixa quando um globo
// vai realmente ser desenhado, tirando o peso do carregamento inicial ──
var GLOBE_LIB_LOADING=false, GLOBE_LIB_WAITERS=[];
function ensureGlobeLib(cb){
  if(typeof Globe!=='undefined'){ cb(true); return; }
  GLOBE_LIB_WAITERS.push(cb);
  if(GLOBE_LIB_LOADING) return;
  GLOBE_LIB_LOADING=true;
  var s=document.createElement('script');
  s.src='https://unpkg.com/globe.gl';
  s.onload=function(){
    GLOBE_LIB_WAITERS.forEach(function(w){ try{w(true);}catch(_){}});
    GLOBE_LIB_WAITERS=[];
  };
  s.onerror=function(){
    GLOBE_LIB_LOADING=false;
    GLOBE_LIB_WAITERS.forEach(function(w){ try{w(false);}catch(_){}});
    GLOBE_LIB_WAITERS=[];
  };
  document.head.appendChild(s);
}
// ── GeoJSON de países (cache compartilhado entre os dois globos) ──
var WORLD_GEOJSON=null, WORLD_GEOJSON_LOADING=false, WORLD_GEOJSON_WAITERS=[];
function loadWorldPolys(cb){
  if(WORLD_GEOJSON){ cb(WORLD_GEOJSON); return; }
  WORLD_GEOJSON_WAITERS.push(cb);
  if(WORLD_GEOJSON_LOADING) return;
  WORLD_GEOJSON_LOADING=true;
  // servido localmente (cache de 7d em /assets) — sem depender do GitHub
  fetch('/assets/countries.geojson')
    .then(function(r){return r.json();})
    .then(function(j){
      WORLD_GEOJSON=j.features||[];
      WORLD_GEOJSON_WAITERS.forEach(function(w){ try{w(WORLD_GEOJSON);}catch(_){}});
      WORLD_GEOJSON_WAITERS=[];
    }).catch(function(){ WORLD_GEOJSON_LOADING=false; });
}
// Aplica as bordas dos países sobre a textura realista do globo
function applyLightPolys(g){
  loadWorldPolys(function(feats){
    try{
      g.polygonsData(feats)
        .polygonCapColor(function(){return 'rgba(37,244,238,0.08)';})
        .polygonSideColor(function(){return 'rgba(0,0,0,0)';})
        .polygonStrokeColor(function(){return 'rgba(147,197,253,0.22)';})
        .polygonAltitude(0.005);
    }catch(_){}
  });
}
// Construtor de globo DARK (realista) — usado pelo hero da Visão Geral.
function makeGlobe(el,height){
  el.innerHTML=''; // limpa canvas/contexto WebGL residual antes de recriar
  var g=Globe()(el)
    .globeImageUrl('/assets/earth-blue-marble.jpg')
    .backgroundColor('rgba(0,0,0,0)')
    .showGraticules(false)
    .showAtmosphere(true).atmosphereColor('#25f4ee').atmosphereAltitude(0.15)
    .pointLat('lat').pointLng('lng')
    .ringLat('lat').ringLng('lng');
  // Ajuste do material para que a textura brilhe corretamente
  function paintOcean(){
    try{
      var mat=g.globeMaterial();
      if(mat.color&&mat.color.set) mat.color.set('#ffffff');
      if(mat.emissive&&mat.emissive.set){ mat.emissive.set('#000000'); mat.emissiveIntensity=0.0; }
      mat.shininess=30;
    }catch(_){}
  }
  setTimeout(paintOcean,150); setTimeout(paintOcean,900);
  try{
    // Ajustar as luzes default do globe.gl para cena dark/realistic
    var lights=g.lights&&g.lights();
    if(lights&&lights.length){
      lights.forEach(function(l){
        if(l.isAmbientLight){ l.intensity=2.2; if(l.color&&l.color.set)l.color.set('#ffffff'); }
        if(l.isDirectionalLight){ l.intensity=1.8; if(l.color&&l.color.set)l.color.set('#ffffff'); }
      });
    }
  }catch(_){}
  // Retina/HiDPI: limita o pixel ratio a 1.5 — DPR 2 renderiza 4x mais pixels
  // por frame com diferença visual mínima num globo em rotação. Grande economia de GPU no Mac.
  try{ var rnd=g.renderer&&g.renderer(); if(rnd&&rnd.setPixelRatio) rnd.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5)); }catch(_){}
  applyLightPolys(g);
  globeEntrance(g); // entrada cinematográfica: giro + aproximação
  var ctrl=g.controls();
  if(ctrl){
    ctrl.autoRotate=true;ctrl.autoRotateSpeed=0.42;
    ctrl.enableZoom=true;ctrl.zoomSpeed=0.6;
    ctrl.minDistance=140;ctrl.maxDistance=520; // limites de zoom confortáveis
  }
  setTimeout(function(){ try{g.width(el.clientWidth).height(height);}catch(e){} },80);
  return g;
}
// ── Entrada cinematográfica do globo ──
// Começa afastado e rotacionado a oeste; o easing interno do globe.gl faz o
// giro + zoom-in até o enquadramento padrão. Usada na criação e ao reentrar na aba.
function globeEntrance(g){
  if(!g) return;
  try{
    if(matchMedia('(prefers-reduced-motion:reduce)').matches){
      g.pointOfView({lat:24,lng:-12,altitude:1.95},0); return;
    }
    g.pointOfView({lat:8,lng:-115,altitude:3.3},0);
    setTimeout(function(){ g.pointOfView({lat:24,lng:-12,altitude:1.95},1350); },90);
  }catch(_){}
}
// Cor da marcação conforme intensidade (paleta light): frio (ciano) → médio (azul) → quente (rosa marca)
function heatColor(sz){
  if(sz>=.75) return '#fe2c55';
  if(sz>=.45) return '#2f7dff';
  return '#06b6d4';
}
function heatRGBA(sz,a){
  if(sz>=.75) return 'rgba(254,44,85,'+a+')';
  if(sz>=.45) return 'rgba(47,125,255,'+a+')';
  return 'rgba(6,182,212,'+a+')';
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
    updateLiveStrip(); // strip compacto da Visão Geral
    if(currentView==='live'){ renderLive(); renderLiveGlobe(); } // globo mora no Ao Vivo
    if(currentView==='overview'){ renderGlobeHero(); } // globo hero da Visão Geral usa os mesmos dados
  }).catch(function(){liveLoading=false;});
}
function updateLiveBadge(){
  var n=(LIVE.summary&&LIVE.summary.online)||0;
  var b=document.getElementById('nav-live-badge');
  if(b){ b.textContent=n; b.style.display=n>0?'':'none'; }
}
// mantém o pulso de tráfego da Visão Geral em dia (a faixa de presença foi removida)
function updateLiveStrip(){
  if(currentView==='overview') renderTrafficPulse();
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
    // toast global: venda aparece em QUALQUER aba, sem precisar estar no Ao Vivo
    if(notifBooted&&e.type==='sale'){
      var geo=[e.city,e.countryName||e.country].filter(Boolean).join(', ');
      toast('Venda aprovada'+(e.amount!=null?' \u00b7 '+money(e.amount,e.currency||'EUR'):'')+(geo?' \u00b7 '+geo:''));
    }
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
  var ck=LIVE.checkout||{externalEst:0};
  var inCk=ck.externalEst||0;
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
      '<span class="tfs"><i class="tfd" style="background:var(--pink)"></i>No checkout: <b>'+inCk+'</b> <span class="tfm">(estimativa &middot; checkouts externos)</span></span>'+
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
    var funnel=(v.pageviews||1)>1?'<span class="lfun" title="p\u00e1ginas vistas nesta sess\u00e3o">'+v.pageviews+' p\u00e1gs</span>':'';
    return '<div class="lrow'+(idle?' idle':'')+(inCk?' hot':'')+'">'+
      '<span class="ldot"></span>'+
      '<span class="lflag">'+flag(v.country)+'</span>'+
      '<div class="lmain"><b>'+esc(v.countryName||v.country||'Local desconhecido')+(v.city?' &middot; '+esc(v.city):'')+'</b>'+
        '<span class="lpage">'+esc(pageLabel(v.page))+'</span></div>'+
      '<div class="lmeta">'+
        (inCk?'<span class="lck">'+I.cart+'no checkout</span>':'')+
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
  var el=document.getElementById('live-globe');
  var cs=(LIVE.summary&&LIVE.summary.countries)||[];
  // lib ainda não baixada? pede sob demanda e re-renderiza quando chegar
  if(el && typeof Globe==='undefined'){
    ensureGlobeLib(function(ok){ if(ok) renderLiveGlobe(); else el.innerHTML='<div class="empty" style="height:100%;display:flex;align-items:center;justify-content:center">Globo indispon&iacute;vel.</div>'; });
    return;
  }
  if(el && typeof Globe!=='undefined'){
    var top=cs[0]?cs[0].count:1;
    var pts=cs.filter(function(c){return GEO[c.code];}).map(function(c){
      var g=GEO[c.code]; var sz=Math.max(.25,Math.min(1,c.count/top));
      return {lat:g[0],lng:g[1],size:sz,count:c.count,name:c.name,code:c.code};
    });
    try{
      if(!liveGlobe){
        liveGlobe=makeGlobe(el,520);
        liveGlobe.pointAltitude(function(d){return 0.01+d.size*0.08;})
          .pointRadius(function(d){return 0.22+d.size*0.35;})
          .pointColor(function(d){return heatColor(d.size);})
          .pointLabel(function(d){
            var c=heatColor(d.size);
            return '<div style="background:rgba(8,10,18,0.92);border:1px solid rgba(255,255,255,0.09);padding:10px 14px;border-radius:12px;'+
              'font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 12px 36px rgba(0,0,0,0.7),inset 0 1px 0 rgba(255,255,255,0.1);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)">'+
              '<div style="font-size:13px;color:#fff;font-weight:700;display:flex;align-items:center;gap:8px">'+
                '<span style="font-size:16px">'+flag(d.code)+'</span>'+d.name+'</div>'+
              '<div style="font-size:11px;color:#a1a1aa;margin-top:5px;display:flex;align-items:center;gap:6px">'+
                '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:'+c+';box-shadow:0 0 8px '+c+'"></span>'+
                '<span style="color:#d4d4d8"><b style="color:'+c+';font-size:12.5px">'+d.count+'</b>&nbsp;online agora</span></div>'+
            '</div>';
          })
          .ringColor(function(d){return function(t){return heatRGBA(d.size,(1-t)*0.75);};})
          .ringMaxRadius(function(d){return 1.8+d.size*3.2;})
          .ringPropagationSpeed(1.6)
          .ringRepeatPeriod(function(d){return 1200-d.size*400;});
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
  } else if(el) {
    el.innerHTML='<div class="empty" style="height:100%;display:flex;align-items:center;justify-content:center">Globo indispon&iacute;vel.</div>';
  }
  // subtítulo com presença atual
  var n=(LIVE.summary&&LIVE.summary.online)||0;
  var sub=document.getElementById('ov-globe-sub');
  if(sub)sub.textContent=n>0?(n+' pessoa'+(n>1?'s':'')+' online \u00b7 '+cs.length+' pa\u00eds'+(cs.length>1?'es':'')):'aguardando visitantes';
  renderGlobeSide();
  renderTrafficPulse(); // pulso de tráfego vive junto do globo
}
// Globo hero na Visão Geral: mundo em vidro com pontos de presença por país.
// Usa os mesmos dados do Ao Vivo (LIVE.summary.countries + GEO) — sem fetch extra.
function renderGlobeHero(){
  var el=document.getElementById('globe-hero'), skel=document.getElementById('ov-globe-skel');
  if(!el) return;
  // lib ainda não baixada? pede sob demanda e re-renderiza quando chegar
  if(typeof Globe==='undefined'){ ensureGlobeLib(function(ok){ if(ok) renderGlobeHero(); }); return; }
  var cs=(LIVE.summary&&LIVE.summary.countries)||[];
  var top=cs[0]?cs[0].count:1;
  var pts=cs.filter(function(c){return GEO[c.code];}).map(function(c){
    var g=GEO[c.code]; var sz=Math.max(.25,Math.min(1,c.count/top));
    return {lat:g[0],lng:g[1],size:sz,count:c.count,name:c.name,code:c.code};
  });
  try{
    if(!globoHero){
      if(skel)skel.hidden=true; el.hidden=false;
      globoHero=makeGlobe(el,560);
      globoHero.pointAltitude(function(d){return 0.01+d.size*0.08;})
        .pointRadius(function(d){return 0.22+d.size*0.35;})
        .pointColor(function(d){return heatColor(d.size);})
        .ringColor(function(d){return function(t){return heatRGBA(d.size,(1-t)*0.75);};})
        .ringMaxRadius(function(d){return 1.8+d.size*3.2;})
        .ringPropagationSpeed(1.6)
        .ringRepeatPeriod(function(d){return 1200-d.size*400;});
      // redimensiona junto com o container (o globo memoriza o width da criação)
      window.addEventListener('resize',function(){
        try{ if(!el.hidden&&globoHero) globoHero.width(el.clientWidth).height(560); }catch(_){}
      });
    }
    // corrige width se o container mudou desde a criação (ex.: troca de viewport)
    try{ if(globoHero.width()!==el.clientWidth) globoHero.width(el.clientWidth).height(560); }catch(_){}
    globoHero.pointsData(pts);
    globoHero.ringsData(pts);
  }catch(e){ if(skel)skel.hidden=false; el.hidden=true; }
}
var globoHero=null;
// Painel lateral do globo: stats compactos + até 5 leads rastreados
function renderGlobeSide(){
  var vs=(LIVE.visitors||[]);
  var seen={}; vs=vs.filter(function(v){ var id=v.id||JSON.stringify([v.country,v.page,v.durationMs]); if(seen[id])return false; seen[id]=1; return true; });
  var ck=LIVE.checkout||{};
  var totalCk=ck.externalEst!=null?ck.externalEst:vs.filter(isCheckoutLead).length;
  countUp(document.getElementById('gs-online'),(LIVE.summary&&LIVE.summary.online)||0,'',600);
  countUp(document.getElementById('gs-ck'),totalCk,'',600);
  var list=document.getElementById('ov-live-list'); if(!list) return;
  list.removeAttribute('aria-busy');
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

/* ── Links de Checkout ────��───────────────────────────────────────── */
var LK_LIST=[];
function loadLinks(){
  fetch('/api/links',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
    LK_LIST=d.links||[];
    renderLinks();
  }).catch(function(){});
}
function renderLinks(){
  var el=document.getElementById('lk-list'); if(!el) return;
  if(!LK_LIST.length){
    el.innerHTML='<div class="live-empty">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:40px;height:40px"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>' +
      '<div><b>Nenhum link ativo ainda</b><p style="margin:6px 0 0;color:var(--text-muted);font-size:12px;line-height:1.6">Clique em <b>+ Criar link</b> no canto superior para registrar o seu primeiro redirecionamento e começar a rastrear cliques.</p></div>' +
    '</div>';
  } else {
    el.innerHTML=LK_LIST.map(function(l){
      var nv=(l.variantes||[]).length;
      var clicks=(l.variantes||[]).reduce(function(a,v){return a+(v.clicks||0);},0);
      var convs=(l.variantes||[]).reduce(function(a,v){return a+(v.conversions||0);},0);
      return '<div class="lrow" style="cursor:default">'+
        '<span class="ldot" style="background:'+(l.ativo?'var(--green)':'var(--muted2)')+';box-shadow:none"></span>'+
        '<div class="lmain">'+
  '<b>'+esc(l.nome)+' <span class="hint" style="font-weight:400">/go/'+esc(l.slug)+'</span>'+(l.urlWhitePage?'&nbsp;<span class="tag" style="font-size:11px;background:rgba(0,200,255,.12);color:var(--cyn,#00c2ff);border:1px solid rgba(0,200,255,.25);padding:1px 6px;border-radius:4px;font-weight:600">CLOAK</span>':'')+'</b>'+
  '<span>'+(nv>1?'<span class="cyn">teste A/B ('+nv+' checkouts)</span>':'checkout &uacute;nico')+' &middot; '+clicks+' clique'+(clicks!==1?'s':'')+' &middot; '+convs+(convs===1?' convers&atilde;o':' convers&otilde;es')+'</span>'+
  '<span>'+(!l.dominio
      ?'<span class="badge-ok" style="background:rgba(120,130,150,.14);color:var(--text-muted);border-color:rgba(120,130,150,.25)">Dom&iacute;nio padr&atilde;o do app</span>'
      :(l.dominioValidado
        ?'<span class="badge-ok">Dom&iacute;nio validado &middot; '+esc(l.dominio)+'</span>'
        :'<span class="badge-warn">'+esc(l.dominio)+' &mdash; n&atilde;o verificado</span>'))+'</span>'+
        '</div>'+
        '<div class="lmeta" style="flex-direction:row;gap:6px;align-items:center">'+
          '<button class="btn-icon" onclick="copyLink(\\''+esc(l.slug)+'\\')">Copiar URL</button>'+
          '<button class="btn-icon" onclick="editLink(\\''+esc(l.slug)+'\\')">Editar</button>'+
          '<button class="btn-icon" style="color:var(--red)" onclick="delLink(\\''+esc(l.slug)+'\\')">Excluir</button>'+
        '</div>'+
      '</div>';
    }).join('');
  }
  renderLinkPerf();
  renderPageConv();
}
// Conversão por página: agrega a jornada dos leads — onde entram, quantos
// chegam ao checkout e quantos compram. Mostra onde o funil vaza.
function renderPageConv(){
  var el=document.getElementById('pg-conv'); if(!el||!DATA) return;
  var agg={};
  (DATA.leads||[]).forEach(function(l){
    if(l.orphan) return;
    // páginas ��nicas que o lead visitou (journey; fallback: landing)
    var pages={};
    (l.journey||[]).forEach(function(s){
      var p=String(s.p||'');
      if(p==='compra'||p.indexOf('go:')===0) return;   // marcos não são páginas
      pages[p]=1;
    });
    if(!Object.keys(pages).length&&l.landing) pages[l.landing]=1;
    var went=l.stage==='checkout'||l.stage==='purchased';
    var bought=l.stage==='purchased';
    Object.keys(pages).forEach(function(p){
      if(!agg[p]) agg[p]={leads:0,ck:0,buy:0};
      agg[p].leads++;
      if(went) agg[p].ck++;
      if(bought) agg[p].buy++;
    });
  });
  var rows=Object.keys(agg).map(function(p){
    var a=agg[p];
    return {p:p,leads:a.leads,ck:a.ck,buy:a.buy,rate:a.leads?a.buy/a.leads*100:0};
  }).sort(function(a,b){return b.leads-a.leads;}).slice(0,20);
  if(!rows.length){
    el.innerHTML='<tr><td colspan="5"><div class="empty">Sem dados ainda. Instale o script (aba Pixel) nas suas p&aacute;ginas para ver a convers&atilde;o de cada uma.</div></td></tr>';
    return;
  }
  el.innerHTML=rows.map(function(r){
    var rt=r.rate.toFixed(1);
    var cls=r.rate>=3?'pos':(r.rate>=1?'amb':'');
    return '<tr>'+
      '<td><span style="font-family:\\'Geist Mono\\',monospace;font-size:12px">'+esc(r.p)+'</span></td>'+
      '<td>'+r.leads+'</td>'+
      '<td>'+r.ck+' <span class="hint">('+(r.leads?Math.round(r.ck/r.leads*100):0)+'%)</span></td>'+
      '<td>'+r.buy+'</td>'+
      '<td><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;max-width:90px;height:5px;border-radius:3px;background:var(--line,rgba(255,255,255,.08));overflow:hidden"><div style="height:100%;border-radius:3px;background:var(--green,#2fbf71);width:'+Math.min(100,Math.round(r.rate*10))+'%"></div></div><span class="'+cls+'">'+rt+'%</span></div></td>'+
    '</tr>';
  }).join('');
}
// Desempenho A/B: barras de cliques/conversões por variante de cada link
function renderLinkPerf(){
  var el=document.getElementById('lk-perf'); if(!el) return;
  var withData=LK_LIST.filter(function(l){return (l.variantes||[]).length;});
  if(!withData.length){ el.innerHTML='<div class="card"><div class="empty">Crie um link para acompanhar o desempenho A/B aqui.</div></div>'; return; }
  el.innerHTML=withData.map(function(l){
    var maxC=Math.max.apply(null,l.variantes.map(function(v){return v.clicks||0;}).concat([1]));
    var best=null;
    l.variantes.forEach(function(v){
      var rate=(v.clicks||0)?(v.conversions||0)/(v.clicks||1):0;
      if(!best||rate>best.rate) best={id:v.id,rate:rate};
    });
    return '<div class="card" style="margin-bottom:14px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'+
      '<h3 style="font-size:14.5px">'+esc(l.nome)+' <span class="hint" style="font-weight:400">/go/'+esc(l.slug)+'</span></h3>'+
      ((l.variantes.length>1&&best&&best.rate>0)?'<span class="tag purchased">L&iacute;der: '+esc((l.variantes.filter(function(v){return v.id===best.id;})[0]||{}).nome||'')+'</span>':'')+
      '</div>'+
      l.variantes.map(function(v,i){
        var rate=(v.clicks||0)?((v.conversions||0)/(v.clicks||1)*100).toFixed(1):'0.0';
        var w=Math.max(2,Math.round((v.clicks||0)/maxC*100));
        return '<div class="abrow"><div class="abr-top"><span class="lbl">'+esc(v.nome)+' <span class="hint">peso '+(v.peso||0)+'%</span></span>'+
          '<span class="va cyn">'+(v.clicks||0)+' cliques</span>'+
          '<span class="vb pnk">'+(v.conversions||0)+' conv &middot; '+rate+'% &middot; '+revObj(v.revenue)+'</span></div>'+
          '<div class="abr-bars"><div class="b s" style="width:'+w+'%"></div>'+
          '<div class="b c" style="width:'+Math.max(2,Math.round((v.conversions||0)/maxC*100))+'%"></div></div></div>';
      }).join('')+
    '</div>';
  }).join('');
}
function showLinkForm(l){
  var g=document.getElementById('lk-grid'); if(g) g.classList.add('form-open');
  document.getElementById('lk-form-card').style.display='';
  document.getElementById('lk-form-title').textContent=l?('Editar: '+l.nome):'Novo link';
  document.getElementById('lk-slug').value=l?l.slug:'';
  document.getElementById('lk-name').value=l?l.nome:'';
  // checkout principal = 1ª variante; A/B = 2ª variante (se existir)
  var vs=l?(l.variantes||[]):[];
  document.getElementById('lk-url').value=vs[0]?vs[0].url:'';
  document.getElementById('lk-url-b').value=vs[1]?vs[1].url:'';
  var abWrap=document.getElementById('lk-ab-wrap');
  if(abWrap) abWrap.open=!!vs[1];
  var splitB=vs[1]?(vs[1].peso||50):50;
  var sp=document.getElementById('lk-ab-split'); if(sp) sp.value=splitB;
  updateAbSplitLabel(splitB);
  fillLinkDomainSelect(l?(l.dominio||''):'');
  updateLinkDomainStatus();
  document.getElementById('lk-active').checked=l?!!l.ativo:true;
  document.getElementById('lk-name').focus();
}
function editLink(slug){
  var l=LK_LIST.filter(function(x){return x.slug===slug;})[0];
  if(l) showLinkForm(l);
}
function delLink(slug){
  uiConfirm({title:'Excluir este link?',msg:'A URL /go/'+slug+' deixa de funcionar na hora. Esta ação não pode ser desfeita.',okLabel:'Excluir',danger:true},function(){
    fetch('/api/links/'+encodeURIComponent(slug),{method:'DELETE'})
      .then(function(r){return r.json();})
      .then(function(d){ if(d.ok){ toast('Link removido'); loadLinks(); } else toast(d.error||'Erro',false); })
      .catch(function(){ toast('Erro ao remover',false); });
  });
}
function linkOrigin(){
  // usa automaticamente o primeiro domínio verificado (sem seletor manual)
  var v=(DM_LIST||[]).filter(function(d){return d.verificado;})[0];
  return v?('https://'+v.host):location.origin;
}
function copyLink(slug){
  navigator.clipboard.writeText(linkOrigin()+'/go/'+slug)
    .then(function(){ toast('URL copiada ('+linkOrigin().replace('https://','')+')'); })
    .catch(function(){ toast('Erro ao copiar',false); });
}
// Monta as variantes a partir dos campos: checkout principal (A) + A/B opcional (B).
// Mantem o formato variantes[] que o backend ja entende (retrocompativel).
function parseVariantLines(){
  var urlA=(document.getElementById('lk-url').value||'').trim();
  var urlB=(document.getElementById('lk-url-b').value||'').trim();
  var out=[];
  var isUrl=function(u){ var low=u.toLowerCase(); return low.indexOf('http:')===0||low.indexOf('https:')===0; };
  if(!isUrl(urlA)) return out;
  var abOpen=document.getElementById('lk-ab-wrap');
  var hasAB=abOpen&&abOpen.open&&isUrl(urlB);
  if(hasAB){
    var splitB=+document.getElementById('lk-ab-split').value||50;
    out.push({nome:'Checkout A',url:urlA,peso:100-splitB});
    out.push({nome:'Checkout B',url:urlB,peso:splitB});
  } else {
    out.push({nome:'Checkout A',url:urlA,peso:100});
  }
  return out;
}
function updateAbSplitLabel(splitB){
  splitB=+splitB||50;
  var el=document.getElementById('lk-ab-split-val');
  if(el) el.textContent='A '+(100-splitB)+'% / B '+splitB+'%';
}

/* ── Domínios personalizados ─────────────────────────────────���───────── */
var DM_LIST=[],DM_APPHOST='';
function loadDomains(){
  fetch('/api/domains',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
    DM_LIST=d.domains||[]; DM_APPHOST=d.appHost||location.host;
    renderDomains();
  }).catch(function(){});
}
function renderDomains(){
  var el=document.getElementById('dm-list'); if(!el) return;
  // alvo do CNAME nas instruções
  Array.prototype.forEach.call(document.querySelectorAll('.dm-apphost'),function(n){ n.textContent=DM_APPHOST; });
  if(!DM_LIST.length){
    el.innerHTML='<div class="live-empty">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:40px;height:40px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
      '<div><b>Nenhum domínio personalizado</b><p style="margin:6px 0 0;color:var(--text-muted);font-size:12px;line-height:1.6">Insira o seu domínio no campo acima para ocultar a URL padrão e aumentar a conversão dos anúncios.</p></div>' +
    '</div>';
  } else {
    el.innerHTML=DM_LIST.map(function(d){
      return '<div class="lrow" style="cursor:default">'+
        '<span class="ldot" style="background:'+(d.verificado?'var(--green)':'var(--amber,#e8a33d)')+';box-shadow:none"></span>'+
        '<div class="lmain">'+
          '<b style="font-family:\\'Geist Mono\\',monospace;font-size:13px">'+esc(d.host)+'</b>'+
          '<span>'+(d.verificado
            ?'<span class="badge-ok">Verificado'+(d.verificadoEm?' &middot; '+new Date(d.verificadoEm).toLocaleDateString('pt-BR'):'')+'</span>'
            :'<span class="badge-warn">Aguardando DNS &mdash; verificamos automaticamente</span>')+'</span>'+
        '</div>'+
        '<div class="lmeta" style="flex-direction:row;gap:6px;align-items:center">'+
          '<button class="btn-icon" style="color:var(--red)" onclick="delDomain(\\''+esc(d.host)+'\\')">Remover</button>'+
        '</div>'+
      '</div>';
    }).join('');
  }
  // se o formulário de link está aberto, mantém o select de domínio em dia
  var lkCard=document.getElementById('lk-form-card');
  if(lkCard&&lkCard.style.display!=='none'){
    var sel=document.getElementById('lk-domain');
    fillLinkDomainSelect(sel?sel.value:'');
    updateLinkDomainStatus();
  }
  // verificação automática: enquanto houver domínio pendente, tenta a cada 30s
  scheduleDomainAutoVerify();
}
/* Verificação automática de domínios: sem botão — o painel tenta sozinho.
   Silenciosa nas falhas (DNS ainda propagando); avisa só quando verifica. */
var DM_POLL=null;
function scheduleDomainAutoVerify(){
  var pending=(DM_LIST||[]).filter(function(d){return !d.verificado;});
  if(!pending.length){ if(DM_POLL){clearInterval(DM_POLL);DM_POLL=null;} return; }
  if(DM_POLL) return; // já agendado
  DM_POLL=setInterval(function(){
    var pend=(DM_LIST||[]).filter(function(d){return !d.verificado;});
    if(!pend.length){ clearInterval(DM_POLL); DM_POLL=null; return; }
    if(document.hidden) return; // não gasta rede com a aba em segundo plano
    pend.forEach(function(d){ silentVerifyDomain(d.host); });
  },30000);
}
function silentVerifyDomain(host){
  fetch('/api/domains/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({host:host})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.ok){ toast('Dom\u00ednio verificado: '+host); loadDomains(); }
    }).catch(function(){});
}
function addDomain(){
  var inp=document.getElementById('dm-host');
  var host=(inp.value||'').trim();
  if(!host){ toast('Informe o dom\u00ednio (ex.: link.seudominio.com)',false); return; }
  fetch('/api/domains',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({host:host})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.ok){
        inp.value='';
        toast('Dom\u00ednio adicionado \u2014 aponte o CNAME; verificamos automaticamente');
        loadDomains();
        silentVerifyDomain(host); // 1ª tentativa imediata (DNS pode já estar pronto)
      }
      else toast(d.error||'Erro',false);
    }).catch(function(){ toast('Erro ao adicionar',false); });
}
function delDomain(host){
  uiConfirm({title:'Remover este dom\u00ednio?',msg:'"'+host+'" deixa de ser recomendado nas URLs (o DNS continua seu).',okLabel:'Remover',danger:true},function(){
    fetch('/api/domains/'+encodeURIComponent(host),{method:'DELETE'})
      .then(function(r){return r.json();})
      .then(function(d){ if(d.ok){ toast('Dom\u00ednio removido'); loadDomains(); } else toast(d.error||'Erro',false); })
      .catch(function(){ toast('Erro ao remover',false); });
  });
}
function saveLink(){
  var editSlug=document.getElementById('lk-slug').value||undefined;
  // white page é configurada no Filtro de Bots; aqui só preservamos o valor existente
  var existing=editSlug?LK_LIST.filter(function(x){return x.slug===editSlug;})[0]:null;
  var body={
  slug:editSlug,
  nome:document.getElementById('lk-name').value,
  variantes:parseVariantLines(),
  urlWhitePage:existing?existing.urlWhitePage:undefined,
  dominio:document.getElementById('lk-domain').value.trim(),
  ativo:document.getElementById('lk-active').checked
  };
  if(!body.nome){ toast('D\u00ea um nome ao link',false); return; }
  if(!body.variantes.length){ toast('Informe a URL do checkout (come\u00e7ando com https://)',false); return; }
  fetch('/api/links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.ok){ toast('Link salvo'); document.getElementById('lk-form-card').style.display='none'; var g=document.getElementById('lk-grid'); if(g) g.classList.remove('form-open'); loadLinks(); }
      else toast(d.error||'Erro ao salvar',false);
    }).catch(function(){ toast('Erro ao salvar',false); });
}
// Popula o <select> do link com os domínios VERIFICADOS + a opção padrão.
// Se o link já tinha um domínio que não está mais verificado, ainda o mostra
// (marcado como não verificado) para não perder a seleção silenciosamente.
function fillLinkDomainSelect(selected){
  var sel=document.getElementById('lk-domain'); if(!sel) return;
  var verified=(DM_LIST||[]).filter(function(d){return d.verificado;});
  var opts='<option value="">Dom\u00ednio padr\u00e3o do app'+(DM_APPHOST?(' ('+esc(DM_APPHOST)+')'):'')+'</option>';
  verified.forEach(function(d){ opts+='<option value="'+esc(d.host)+'">'+esc(d.host)+' \u2014 verificado</option>'; });
  if(selected && !verified.some(function(d){return d.host===selected;})){
    opts+='<option value="'+esc(selected)+'">'+esc(selected)+' \u2014 n\u00e3o verificado</option>';
  }
  sel.innerHTML=opts;
  sel.value=selected||'';
}
// Mostra o estado do domínio escolhido logo abaixo do select.
function updateLinkDomainStatus(){
  var sel=document.getElementById('lk-domain'); var st=document.getElementById('lk-domain-status');
  if(!sel||!st) return;
  var host=sel.value;
  if(!host){ st.innerHTML='<span class="hint">Usando o dom\u00ednio padr\u00e3o do app.</span>'; return; }
  var ok=(DM_LIST||[]).some(function(x){return x.verificado&&x.host===host;});
  st.innerHTML=ok
    ? '<span class="pos">Verificado &middot; '+esc(host)+'</span>'
    : '<span class="amb">'+esc(host)+' ainda n\u00e3o verificado &mdash; verifique em Dom\u00ednio personalizado</span>';
}

/* ── Heatmap de vendas (hora × dia da semana) ── */
function renderHeat(){
  var el=document.getElementById('act-heat'); if(!el) return;
  var cells=[],max=0,tot=0; for(var d=0;d<7;d++){cells.push([]);for(var h=0;h<24;h++)cells[d].push(0);}
  (DATA.events||[]).forEach(function(e){ if(e.type!=='sale'||!e.at)return; var dt=new Date(e.at); var dd=(dt.getDay()+6)%7; var hh=dt.getHours(); cells[dd][hh]++; tot++; if(cells[dd][hh]>max)max=cells[dd][hh]; });
  if(!max){ el.innerHTML='<div class="empty" style="padding:30px">Sem vendas suficientes para o mapa de calor ainda.</div>'; return; }
  var days=['Seg','Ter','Qua','Qui','Sex','S&aacute;b','Dom'];
  function col(v){ if(!v)return 'var(--card2)'; var t=v/max; if(t<.25)return 'rgba(47,125,255,.30)'; if(t<.5)return 'rgba(47,125,255,.55)'; if(t<.75)return 'rgba(47,125,255,.75)'; return '#dc2626'; }
  var html='<div class="heat">';
  for(var d2=0;d2<7;d2++){ html+='<div class="hh">'+days[d2]+'</div>'; for(var h2=0;h2<24;h2++){ var v=cells[d2][h2]; html+='<div class="hc" style="background:'+col(v)+'" title="'+days[d2].replace('&aacute;','á')+' '+h2+'h: '+v+' venda(s)"></div>'; } }
  html+='</div><div class="heat-x"><span class="hx-pad"></span>';
  for(var hx=0;hx<24;hx++){ html+='<span>'+(hx%3===0?hx:'')+'</span>'; }
  html+='</div><div class="heat-legend">Menos<span class="hl-scale"><i style="background:var(--card2)"></i><i style="background:rgba(47,125,255,.30)"></i><i style="background:rgba(47,125,255,.55)"></i><i style="background:rgba(47,125,255,.75)"></i><i style="background:#dc2626"></i></span>Mais &middot; pico de <b style="color:var(--text)">'+max+'</b> venda(s)/hora &middot; '+tot+' vendas mapeadas</div>';
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
    if(e.gateway) meta.push('<span style="opacity:.75">'+esc(gwLabel(e.gateway))+'</span>');
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

/* ── Config: notificações Pushcut ── */
var PC_LOADED=false;
function loadPushcutConfig(){
  fetch('/api/pushcut-config',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
    PC_LOADED=true;
    document.getElementById('pc-url').value=d.url||'';
    document.getElementById('pc-url').placeholder=d.hasUrl?'(configurado — cole outra URL para trocar)':'https://api.pushcut.io/.../notifications/Aprovada';
    var ev=d.events||{};
    document.getElementById('pc-ev-sale').checked=ev.sale!==false;
    document.getElementById('pc-ev-failed').checked=ev.failed!==false;
    document.getElementById('pc-ev-refund').checked=ev.refund!==false;
    document.getElementById('pc-ev-dispute').checked=ev.dispute!==false;
    document.getElementById('pc-ev-checkout').checked=ev.checkout===true;
    document.getElementById('pc-ev-daily').checked=ev.daily===true;
    document.getElementById('pc-status').innerHTML=d.hasUrl?'<span class="pos">Webhook configurado</span>':'<span class="amb">Sem webhook — notifica&ccedil;&otilde;es desligadas</span>';
  }).catch(function(){});
}
function savePushcutConfig(){
  var body={
    url:document.getElementById('pc-url').value.trim(),
    events:{
      sale:document.getElementById('pc-ev-sale').checked,
      failed:document.getElementById('pc-ev-failed').checked,
      refund:document.getElementById('pc-ev-refund').checked,
      dispute:document.getElementById('pc-ev-dispute').checked,
      checkout:document.getElementById('pc-ev-checkout').checked,
      daily:document.getElementById('pc-ev-daily').checked
    }
  };
  fetch('/api/pushcut-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.ok){ toast('Notifica\u00e7\u00f5es salvas'); loadPushcutConfig(); }
      else toast(d.error||'Erro ao salvar',false);
    }).catch(function(){ toast('Erro ao salvar',false); });
}
function testPushcut(){
  toast('Enviando teste...');
  fetch('/api/pushcut/test',{method:'POST'})
    .then(function(r){return r.json();})
    .then(function(d){ toast(d.ok?'Push enviado — confira o celular':'Falhou — confira a URL do webhook',d.ok); })
    .catch(function(){ toast('Erro no teste',false); });
}

/* ── Filtro de Bots / Links de cloaking (entidade /c/:slug) ── */
 var CK_ENTRIES=[];     // links de cloaking, cada um com config própria
 var CK_BASE='';        // base URL para montar /c/<slug>
 var CK_OPEN=null;      // slug em edição, ou '__new__' para o formulário de criação
 var CK_STATS={};       // decisões por link: chave 'tipo/slug' → {offer,white,total,blockRate,reasons}
 var CK_AGG=null;       // agregado geral da conta (offer/white/total/blockRate/reasons)
var CK_LAYERS=[
  ['blockDatacenter','Servidores e rede do TikTok','Bloqueia acessos que vêm de servidores (data centers) e da própria rede do TikTok — é de lá que saem os revisores de anúncios.'],
  ['blockHeadless','Robôs automatizados','Detecta navegadores controlados por robô, sem tela, usados para varrer páginas automaticamente.'],
  ['checkHeaders','Assinatura de navegador real','Confere se o acesso tem a "identidade" que todo navegador de verdade envia. Programas simples não têm.'],
  ['requireJsChallenge','Teste de navegador real','Faz um pequeno teste invisível que só um navegador de verdade consegue responder. Robôs falham.'],
  ['checkWebgl','Placa de vídeo de verdade','Verifica se o aparelho tem uma placa de vídeo real. Robôs costumam usar uma simulada (falsa).'],
  ['checkTimezone','Horário x país do acesso','Compara o horário do aparelho com o país de onde o acesso vem. Se não bate, é suspeito.'],
  ['checkBehavior','Comportamento humano','Mede sinais de gente real: movimento do mouse, rolagem, toque na tela e tempo na página.'],
  ['blockZhLang','Aparelho em idioma suspeito','Sinaliza aparelhos configurados em chinês fora da China — padrão comum nas contas de revisão.']
];
var CK_SENS_DESC={
  strict:'Agressivo: barra o m\u00e1ximo de bots (pode reter alguns usu\u00e1rios leg\u00edtimos)',
  balanced:'Equilibrado: a melhor propor\u00e7\u00e3o de seguran\u00e7a e convers\u00e3o \u2014 recomendado',
  loose:'Conservador: libera quase todos os acessos (alguns bots avan\u00e7ados podem passar)',
  custom:'Manual: voc\u00ea define o rigor da filtragem usando o controle abaixo'
};
function loadCloakConfig(){
  fetch('/api/cloak/entries',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
    CK_ENTRIES=(d&&d.entries)||[]; CK_BASE=(d&&d.baseUrl)||location.origin; renderCloakList();
  }).catch(function(){});
  loadCloakStats();
}
/* Busca as métricas de decisão (offer/white) e re-renderiza a lista. */
function loadCloakStats(){
  fetch('/api/cloak/stats',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
    if(!d||!d.ok) return;
    CK_AGG=d.aggregate||null;
    var map={};
    (d.links||[]).forEach(function(it){ map[it.tipo+'/'+it.slug]=it; });
    CK_STATS=map;
    renderCloakList();
    renderCloakAgg();
  }).catch(function(){});
}
/* Lê as métricas de um link específico do cache CK_STATS. */
function ckStatFor(tipo,slug){ return CK_STATS[tipo+'/'+slug]||null; }
/* Preenche o resumo agregado da conta (se o container existir). */
function renderCloakAgg(){
  var host=document.getElementById('ck-agg'); if(!host) return;
  if(!CK_AGG||!CK_AGG.total){ host.innerHTML=''; return; }
  var pct=Math.round((CK_AGG.blockRate||0)*100);
  host.innerHTML='<span style="color:var(--green,#39d98a)">Offer <b>'+CK_AGG.offer+'</b></span>'+
    '<span style="color:var(--muted2)">White <b>'+CK_AGG.white+'</b></span>'+
    '<span>Bloqueio geral <b>'+pct+'%</b> <span class="hint">('+CK_AGG.total+' visitas)</span></span>';
}
function ckUrl(l){
  // aceita objeto (usa domínio personalizado) ou string de slug (compat)
  if(typeof l==='string') return (CK_BASE||location.origin)+'/c/'+l;
  var base=l.dominio ? ('https://'+l.dominio) : (CK_BASE||location.origin);
  return base+'/c/'+l.slug;
}
/* Card colapsado (resumo) de um link de cloaking */
function ckCard(l){
  // FAIL-SAFE: mesmo sem white page própria, bots caem numa página segura
  // (white global ou /_safe embutida) — nunca na offer. Então "protegido"
  // depende só do interruptor do link.
  var on=l.enabled!==false;
  var url=ckUrl(l);
  var statusTxt = (l.enabled===false) ? 'Proteção desligada — tudo vai à offer'
    : ('Protegido — modo '+({strict:'agressivo',balanced:'equilibrado',loose:'conservador',custom:'manual'}[l.sensitivity]||'equilibrado')+(!l.whitePageUrl?' · usando página segura padrão':''));
  return '<div class="card ck-card" data-slug="'+esc(l.slug)+'" style="margin-bottom:12px">'+
    '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'+
      '<span class="ck-dot'+(on?' on':'')+'" title="'+esc(statusTxt)+'"></span>'+
      '<div style="flex:1;min-width:160px">'+
        '<b style="font-size:14px">'+esc(l.nome||l.slug)+'</b>'+
        '<div style="display:flex;align-items:center;gap:8px;margin-top:3px">'+
          '<code style="font-size:12px;color:var(--muted2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(url)+'</code>'+
        '</div>'+
        '<span class="hint" style="display:block;margin-top:2px">'+esc(statusTxt)+'</span>'+
      '</div>'+
      '<button class="btn btn-sm" data-ck-copy="'+esc(url)+'" type="button">Copiar link</button>'+
      '<button class="btn btn-sm" data-ck-edit="'+esc(l.slug)+'" type="button">Configurar</button>'+
      '<button class="cn-x" data-ck-del="'+esc(l.slug)+'" title="Apagar" aria-label="Apagar link de cloaking">&times;</button>'+
    '</div>'+
    ckStatsRow('cloak',l.slug)+
    (CK_OPEN===l.slug?('<div class="ck-editor-wrap" style="margin-top:16px;border-top:1px solid var(--line,rgba(255,255,255,.06));padding-top:16px">'+renderCloakEditor(l,false)+'</div>'):'')+
  '</div>';
}
/* Mini-painel de decisões (→ Offer / → White / % bloqueio) de um link. */
function ckStatsRow(tipo,slug){
  var st=ckStatFor(tipo,slug);
  if(!st||!st.total){
    return '<div class="ck-stats" style="margin-top:10px;font-size:12px;color:var(--muted2)">Sem tráfego registrado ainda.</div>';
  }
  var pct=Math.round((st.blockRate||0)*100);
  var reasons=st.reasons||{};
  var rlabel={'bot-ua':'bot','pais':'país','idioma':'idioma','score':'score','rate-limit':'rajada','mobile':'não-celular','anuncio':'sem anúncio'};
  var chips=Object.keys(reasons).sort(function(a,b){return reasons[b]-reasons[a];}).slice(0,4).map(function(r){
    return '<span class="ck-chip" style="display:inline-block;padding:1px 7px;border-radius:10px;background:var(--line,rgba(255,255,255,.06));margin:2px 4px 0 0;font-size:11px">'+esc(rlabel[r]||r)+': '+reasons[r]+'</span>';
  }).join('');
  return '<div class="ck-stats" style="margin-top:10px;display:flex;flex-wrap:wrap;align-items:center;gap:14px;font-size:12px;border-top:1px dashed var(--line,rgba(255,255,255,.06));padding-top:10px">'+
    '<span style="color:var(--green,#39d98a)">&rarr; Offer <b>'+st.offer+'</b></span>'+
    '<span style="color:var(--muted2)">&rarr; White <b>'+st.white+'</b></span>'+
    '<span>Bloqueio <b>'+pct+'%</b> <span class="hint">('+st.total+' visitas)</span></span>'+
    (chips?'<span style="flex-basis:100%;margin-top:2px">'+chips+'</span>':'')+
  '</div>';
}
function renderCloakList(){
  var host=document.getElementById('ck-list'); if(!host) return;
  var html='';
  if(CK_OPEN==='__new__'){
    html+='<div class="card ck-card" data-slug="__new__" style="margin-bottom:12px;border-color:var(--cyan)">'+
      renderCloakEditor({},true)+'</div>';
  }
  if(!CK_ENTRIES.length && CK_OPEN!=='__new__'){
    html+='<div class="card" style="text-align:center;padding:34px 16px"><p class="hint" style="margin:0">Nenhum link de cloaking ainda. Clique em <b>+ Criar link de cloaking</b> para começar.</p></div>';
  } else {
    html+=CK_ENTRIES.map(ckCard).join('');
  }
  host.innerHTML=html;
  if(CK_OPEN) bindCloakEditor();
}
/* Editor completo (usado tanto na criação quanto na edição de um link) */
function renderCloakEditor(l,isNew){
  l=l||{};
  var sens=l.sensitivity||'balanced';
  // Nome (identifica o link no painel) + domínio personalizado (opcional).
  // A slug é sempre aleatória — o nome NÃO vira mais a URL.
  var slugHint=isNew
    ? '<span class="hint">— a URL /c/&lt;slug&gt; é gerada automaticamente</span>'
    : '<span class="hint">— URL: /c/'+esc(l.slug||'')+'</span>';
  var nameField=
    '<div class="ck-field full"><label>Nome do link '+slugHint+'</label>'+
      '<input class="inp" id="cke-nome" type="text" placeholder="ex.: Campanha Espanha - Julho" value="'+esc(l.nome||'')+'" style="width:100%"></div>'+
    '<div class="ck-field full"><label>Domínio personalizado <span class="hint">— opcional; precisa apontar para este app</span></label>'+
      '<input class="inp" id="cke-dominio" type="text" placeholder="ex.: seu-dominio.com (vazio = domínio padrão)" value="'+esc(l.dominio||'')+'" style="width:100%"></div>';
  var layers=CK_LAYERS.map(function(x){
    var lon=l[x[0]]!==false;
    return '<div class="ck-layer'+(lon?' on':'')+'" data-layer="'+x[0]+'">'+
      '<div class="ck-l-body"><b>'+esc(x[1])+'</b><span>'+esc(x[2])+'</span></div>'+
      '<label class="switch"><input type="checkbox" data-ck="'+x[0]+'"'+(lon?' checked':'')+'><span class="slider"></span></label>'+
    '</div>';
  }).join('');
  var enabled=l.enabled!==false;
  return ''+
    nameField+
    '<div class="cfg-head" style="margin-bottom:10px">'+
      '<span class="cfg-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>'+
      '<div><h3 style="margin:0">Proteção de cloaking</h3><p class="hint" id="cke-status-line" style="margin:2px 0 0">'+(enabled?'Bots e revisores vão para a white page; pessoas reais seguem para a offer.':'Desligado — todos os cliques vão direto para a offer.')+'</p></div>'+
      '<label class="switch" style="margin-left:auto"><input type="checkbox" id="cke-enabled"'+(enabled?' checked':'')+'><span class="slider"></span></label>'+
    '</div>'+
    '<div class="seg" id="cke-sens" style="margin-top:4px">'+
      '<button data-s="strict" type="button"'+(sens==='strict'?' class="on"':'')+'>Agressivo</button>'+
      '<button data-s="balanced" type="button"'+(sens==='balanced'?' class="on"':'')+'>Equilibrado</button>'+
      '<button data-s="loose" type="button"'+(sens==='loose'?' class="on"':'')+'>Conservador</button>'+
      '<button data-s="custom" type="button"'+(sens==='custom'?' class="on"':'')+'>Manual</button>'+
    '</div>'+
    '<p class="hint" id="cke-sens-desc" style="margin:10px 0 0">'+esc(CK_SENS_DESC[sens]||'')+'</p>'+
    '<div id="cke-threshold-wrap" style="margin-top:12px;display:'+(sens==='custom'?'block':'none')+'">'+
      '<label class="hint">Rigor da filtragem: <b id="cke-threshold-val">'+(l.threshold||40)+'</b> — quanto menor, mais acessos são barrados</label>'+
      '<input type="range" id="cke-threshold" min="10" max="90" value="'+(l.threshold||40)+'" style="width:100%">'+
    '</div>'+
    // Gates de intenção: quem realmente pode chegar à offer
    '<div class="ck-gates" style="margin-top:16px;display:flex;flex-direction:column;gap:10px">'+
      '<div class="ck-layer'+(l.mobileOnly!==false?' on':'')+'">'+
        '<div class="ck-l-body"><b>Apenas celulares</b><span>Desktop e notebook vão para a white page. Só mobile chega à offer.</span></div>'+
        '<label class="switch"><input type="checkbox" id="cke-mobileonly"'+(l.mobileOnly!==false?' checked':'')+'><span class="slider"></span></label>'+
      '</div>'+
      '<div class="ck-layer'+(l.requireAdClick!==false?' on':'')+'">'+
        '<div class="ck-l-body"><b>Exigir clique no anúncio do TikTok</b><span>Só quem clicou no anúncio (webview do app ou ttclid) vai à offer. Copiar/colar o link no navegador cai na white.</span></div>'+
        '<label class="switch"><input type="checkbox" id="cke-adclick"'+(l.requireAdClick!==false?' checked':'')+'><span class="slider"></span></label>'+
      '</div>'+
    '</div>'+
    '<div class="ck-rule" style="margin-top:16px">'+
      '<div class="ck-field"><label>Offer page <span class="hint">— pessoas reais</span></label>'+
        '<input class="inp" id="cke-offer" type="url" placeholder="https://sua-offer.com" value="'+esc(l.offerUrl||'')+'" style="width:100%"></div>'+
      '<div class="ck-field"><label>White page <span class="hint">— bots e revisores</span></label>'+
        '<input class="inp" id="cke-white" type="url" placeholder="https://pagina-neutra.com" value="'+esc(l.whitePageUrl||'')+'" style="width:100%"></div>'+
      '<details class="ck-field full geo-collapse"><summary><b>Países liberados para a offer</b> <span class="hint" id="ck-pais-count">'+ckPaisSummary(l)+'</span></summary>'+
        '<p class="hint" style="margin:8px 0 10px">Escolha um preset. Quem estiver fora dos países liberados vai para a white page.</p>'+
        renderPaisPresets(l)+
        '<div id="cke-pais-custom" style="margin-top:12px;display:'+(ckPaisPreset(l)==='custom'?'block':'none')+'">'+renderPaisGrid(l)+'</div>'+
      '</details>'+
      '<details class="ck-field full geo-collapse"><summary><b>Idiomas liberados para a offer</b> <span class="hint" id="ck-idioma-count">'+ckIdiomaSummary(l)+'</span></summary>'+
        '<p class="hint" style="margin:8px 0 10px">Nada marcado = todos os idiomas. Idioma do navegador fora da lista vai para a white page.</p>'+
        renderIdiomaGrid(l)+'</details>'+
    '</div>'+
    '<details class="ck-adv" style="margin-top:16px"><summary style="cursor:pointer;font-size:13px;color:var(--muted2)">Camadas de detecção — ligue/desligue cada sinal</summary>'+
      '<div class="ck-layers" id="cke-layers" style="margin-top:12px">'+layers+'</div>'+
    '</details>'+
    '<div style="display:flex;gap:10px;margin-top:16px;align-items:center">'+
      '<button class="btn primary" id="cke-save" data-new="'+(isNew?'1':'')+'">'+(isNew?'Criar link':'Salvar alterações')+'</button>'+
      '<button class="btn btn-sm" id="cke-cancel" type="button">Cancelar</button>'+
      '<p class="hint" id="cke-status" style="margin:0"></p>'+
    '</div>';
}
/* Catálogo de países por bloco (código ISO-2, nome, bandeira) */
var CK_COUNTRY_BLOCKS=[
  {block:'Américas',items:[['BR','Brasil','🇧🇷'],['MX','México','🇲🇽'],['US','Estados Unidos','🇺🇸'],['CA','Canadá','🇨🇦'],['CO','Colômbia','🇨🇴'],['CL','Chile','🇨🇱'],['AR','Argentina','🇦🇷'],['PE','Peru','🇵🇪'],['UY','Uruguai','🇺🇾'],['PY','Paraguai','🇵🇾'],['EC','Equador','🇪🇨']]},
  {block:'Europa Sul',items:[['PT','Portugal','🇵🇹'],['ES','Espanha','🇪🇸'],['IT','Itália','🇮🇹'],['FR','França','🇫🇷']]},
  {block:'Europa Norte/Central',items:[['DE','Alemanha','🇩🇪'],['NL','Países Baixos','🇳🇱'],['BE','Bélgica','🇧🇪'],['AT','Áustria','🇦🇹'],['CH','Suíça','🇨🇭'],['IE','Irlanda','🇮🇪'],['GB','Reino Unido','🇬🇧']]},
  {block:'Outros',items:[['AU','Austrália','🇦🇺'],['AE','Emirados Árabes','🇦🇪'],['SA','Arábia Saudita','🇸🇦'],['PL','Polônia','🇵🇱'],['RO','Romênia','🇷🇴']]}
];
/* Presets de país prontos — configuração fácil sem marcar caixa por caixa.
   [] = todos os países liberados. 'custom' abre a grade detalhada. */
var CK_PAIS_PRESETS={
  all:[],
  br:['BR'],
  latam:['BR','MX','CO','CL','AR','PE','UY','PY','EC'],
  eu:['PT','ES','IT','FR','DE','NL','BE','AT','CH','IE','GB']
};
var CK_PAIS_PRESET_LABELS=[['all','Todos os países'],['br','Só Brasil'],['latam','Brasil + LATAM'],['eu','Europa (Tier 1)'],['custom','Personalizado']];
var CK_LANGS=[['pt','Português','🇵🇹'],['es','Espanhol','🇪🇸'],['en','Inglês','🇬🇧'],['it','Italiano','🇮🇹'],['fr','Francês','🇫🇷'],['de','Alemão','🇩🇪']];
/* Descobre qual preset corresponde à allowlist salva (ou 'custom'). */
function ckPaisPreset(l){
  if(l && l.paisPreset) return l.paisPreset;
  var a=(l&&l.paises)?l.paises.slice().sort():[];
  if(!a.length) return 'all';
  var keys=['br','latam','eu'];
  for(var i=0;i<keys.length;i++){
    var p=CK_PAIS_PRESETS[keys[i]].slice().sort();
    if(p.length===a.length && p.every(function(c,idx){return c===a[idx];})) return keys[i];
  }
  return 'custom';
}
/* Renderiza o seletor de presets (segmento de botões). */
function renderPaisPresets(l){
  var cur=ckPaisPreset(l);
  return '<div class="seg ck-pais-preset" id="cke-pais-preset" style="flex-wrap:wrap">'+
    CK_PAIS_PRESET_LABELS.map(function(x){
      return '<button type="button" data-p="'+x[0]+'"'+(cur===x[0]?' class="on"':'')+'>'+esc(x[1])+'</button>';
    }).join('')+
  '</div>';
}

function geoChk(scope,code,name,flag,on){
  return '<label class="geo-chk'+(on?' on':'')+'">'+
    '<input type="checkbox" data-'+scope+'="'+esc(code)+'"'+(on?' checked':'')+'>'+
    '<span class="flag" aria-hidden="true">'+flag+'</span>'+
    '<span class="nm">'+esc(name)+'</span></label>';
}
var CK_PAIS_PRESET_SUMMARY={all:'todos os países',br:'só Brasil',latam:'Brasil + LATAM',eu:'Europa (Tier 1)'};
function ckPaisSummary(l){
  var p=ckPaisPreset(l);
  if(CK_PAIS_PRESET_SUMMARY[p]) return '— '+CK_PAIS_PRESET_SUMMARY[p];
  var n=(l.paises&&l.paises.length)||0;
  return '— '+n+(n===1?' país liberado':' países liberados');
}
function ckIdiomaSummary(l){
  var n=(l.idiomas&&l.idiomas.length)||0;
  return n?('— '+n+(n===1?' idioma liberado':' idiomas liberados')):'— todos os idiomas';
}
// Atualiza o texto de resumo no <summary> conforme o usuário marca/desmarca
function refreshGeoSummaries(){
  var pc=document.getElementById('ck-pais-count');
  if(pc){
    var pb=document.querySelector('#cke-pais-preset button.on');
    var p=pb?pb.getAttribute('data-p'):'custom';
    if(CK_PAIS_PRESET_SUMMARY[p]){ pc.textContent='— '+CK_PAIS_PRESET_SUMMARY[p]; }
    else { var n=currentPaises().length; pc.textContent='— '+n+(n===1?' país liberado':' países liberados'); }
  }
  var ic=document.getElementById('ck-idioma-count');
  if(ic){ var m=currentIdiomas().length; ic.textContent=m?('— '+m+(m===1?' idioma liberado':' idiomas liberados')):'— todos os idiomas'; }
}
function renderPaisGrid(l){
  var sel=(l.paises&&l.paises.length)?l.paises.slice():[];
  var blocks=CK_COUNTRY_BLOCKS.map(function(b){
    var codes=b.items.map(function(it){return it[0];});
    var allOn=codes.every(function(c){return sel.indexOf(c)>=0;});
    return '<div class="geo-block">'+
      '<div class="geo-block-head"><b>'+esc(b.block)+'</b>'+
        '<button type="button" data-blocktoggle="pais" data-codes="'+esc(codes.join(','))+'">'+(allOn?'Desmarcar':'Marcar todos')+'</button></div>'+
      '<div class="geo-grid">'+b.items.map(function(it){return geoChk('cc',it[0],it[1],it[2],sel.indexOf(it[0])>=0);}).join('')+'</div>'+
    '</div>';
  }).join('');
  return '<div class="geo-wrap" id="ck-r-paisbox">'+blocks+'</div>';
}
function renderIdiomaGrid(l){
  var sel=(l.idiomas&&l.idiomas.length)?l.idiomas.slice():[];
  return '<div class="geo-wrap" id="ck-r-idiomabox"><div class="geo-grid">'+
    CK_LANGS.map(function(it){return geoChk('lang',it[0],it[1],it[2],sel.indexOf(it[0])>=0);}).join('')+
    '</div></div>';
}
function currentPaises(){
  return Array.prototype.map.call(document.querySelectorAll('#ck-r-paisbox input[data-cc]:checked'),function(c){return c.getAttribute('data-cc');});
}
function currentIdiomas(){
  return Array.prototype.map.call(document.querySelectorAll('#ck-r-idiomabox input[data-lang]:checked'),function(c){return c.getAttribute('data-lang');});
}
function bindCloakEditor(){
  // toggle visual (classe .on) ao marcar/desmarcar qualquer checkbox de geo
  document.querySelectorAll('#ck-r-paisbox,#ck-r-idiomabox').forEach(function(box){
    box.addEventListener('change',function(e){
      var chk=e.target.closest('input[type=checkbox]'); if(!chk) return;
      chk.closest('.geo-chk').classList.toggle('on',chk.checked);
      syncBlockButtons(); refreshGeoSummaries();
    });
    box.addEventListener('click',function(e){
      var b=e.target.closest('button[data-blocktoggle]'); if(!b) return;
      var codes=b.getAttribute('data-codes').split(',');
      var boxes=codes.map(function(c){return box.querySelector('input[data-cc="'+c+'"]');}).filter(Boolean);
      var allOn=boxes.every(function(x){return x.checked;});
      boxes.forEach(function(x){ x.checked=!allOn; x.closest('.geo-chk').classList.toggle('on',x.checked); });
      syncBlockButtons(); refreshGeoSummaries();
    });
  });
  // presets de país (Todos / Só Brasil / LATAM / Europa / Personalizado)
  var pp=document.getElementById('cke-pais-preset');
  if(pp) pp.addEventListener('click',function(e){
    var b=e.target.closest('button[data-p]'); if(!b) return;
    pp.querySelectorAll('button').forEach(function(x){ x.classList.remove('on'); });
    b.classList.add('on');
    applyPaisPreset(b.getAttribute('data-p'));
  });
  // segmento de sensibilidade
  var seg=document.getElementById('cke-sens');
  if(seg) seg.addEventListener('click',function(e){
    var b=e.target.closest('button[data-s]'); if(!b) return;
    seg.querySelectorAll('button').forEach(function(x){ x.classList.remove('on'); });
    b.classList.add('on');
    var s=b.getAttribute('data-s');
    var wrap=document.getElementById('cke-threshold-wrap'); if(wrap) wrap.style.display=(s==='custom')?'block':'none';
    var d=document.getElementById('cke-sens-desc'); if(d) d.textContent=CK_SENS_DESC[s]||'';
  });
  var rng=document.getElementById('cke-threshold');
  if(rng) rng.addEventListener('input',function(){ var tv=document.getElementById('cke-threshold-val'); if(tv) tv.textContent=this.value; });
  // camadas: toggle visual
  var layers=document.getElementById('cke-layers');
  if(layers) layers.addEventListener('change',function(e){
    var chk=e.target.closest('input[data-ck]'); if(!chk) return;
    chk.closest('.ck-layer').classList.toggle('on',chk.checked);
  });
  // interruptor de proteção
  var en=document.getElementById('cke-enabled');
  if(en) en.addEventListener('change',function(){
    var sl=document.getElementById('cke-status-line');
    if(sl) sl.textContent=this.checked?'Bots e revisores vão para a white page; pessoas reais seguem para a offer.':'Desligado — todos os cliques vão direto para a offer.';
  });
  var save=document.getElementById('cke-save'); if(save) save.addEventListener('click',function(){ saveCloakEntry(this.getAttribute('data-new')==='1'); });
  var cancel=document.getElementById('cke-cancel'); if(cancel) cancel.addEventListener('click',function(){ CK_OPEN=null; renderCloakList(); });
}
/* Aplica um preset de país: mostra/esconde a grade e marca as caixas
   correspondentes (para custom, a grade fica editável pelo usuário). */
function applyPaisPreset(preset){
  var custom=document.getElementById('cke-pais-custom');
  if(custom) custom.style.display=(preset==='custom')?'block':'none';
  if(preset!=='custom'){
    var codes=CK_PAIS_PRESETS[preset]||[];
    document.querySelectorAll('#ck-r-paisbox input[data-cc]').forEach(function(chk){
      chk.checked=codes.indexOf(chk.getAttribute('data-cc'))>=0;
      var w=chk.closest('.geo-chk'); if(w) w.classList.toggle('on',chk.checked);
    });
    syncBlockButtons();
  }
  refreshGeoSummaries();
}
function syncBlockButtons(){
  document.querySelectorAll('#ck-r-paisbox button[data-blocktoggle]').forEach(function(b){
    var codes=b.getAttribute('data-codes').split(',');
    var boxes=codes.map(function(c){return document.querySelector('#ck-r-paisbox input[data-cc="'+c+'"]');}).filter(Boolean);
    var allOn=boxes.length&&boxes.every(function(x){return x.checked;});
    b.textContent=allOn?'Desmarcar':'Marcar todos';
  });
}
function saveCloakEntry(isNew){
  var st=document.getElementById('cke-status'); if(st){ st.textContent='Salvando...'; st.style.color='var(--muted2)'; }
  var seg=document.querySelector('#cke-sens button.on');
  // preset de país → allowlist final ([] = todos; 'custom' = grade marcada)
  var pb=document.querySelector('#cke-pais-preset button.on');
  var preset=pb?pb.getAttribute('data-p'):'all';
  var paises=(preset==='custom')?currentPaises():(CK_PAIS_PRESETS[preset]||[]);
  var nome=((document.getElementById('cke-nome')||{}).value||'').trim();
  if(!nome){ if(st){ st.textContent='Dê um nome ao link'; st.style.color='var(--pink,#f31260)'; } return; }
  var body={
    nome:nome,
    dominio:((document.getElementById('cke-dominio')||{}).value||'').trim(),
    enabled:document.getElementById('cke-enabled').checked,
    mobileOnly:(document.getElementById('cke-mobileonly')||{}).checked!==false,
    requireAdClick:(document.getElementById('cke-adclick')||{}).checked!==false,
    sensitivity:seg?seg.getAttribute('data-s'):'balanced',
    threshold:Number((document.getElementById('cke-threshold')||{}).value)||40,
    offerUrl:document.getElementById('cke-offer').value.trim(),
    whitePageUrl:document.getElementById('cke-white').value.trim(),
    paisPreset:preset,
    paises:paises,
    idiomas:currentIdiomas()
  };
  CK_LAYERS.forEach(function(x){ var c=document.querySelector('#cke-layers input[data-ck="'+x[0]+'"]'); body[x[0]]=c?c.checked:true; });
  if(!isNew) body.slug=CK_OPEN;
  fetch('/api/cloak/entries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.ok){
        var slug=d.entry.slug;
        var i=CK_ENTRIES.findIndex(function(x){return x.slug===slug;});
        if(i>=0) CK_ENTRIES[i]=d.entry; else CK_ENTRIES.push(d.entry);
        CK_OPEN=null; renderCloakList();
        toast(isNew?'Link de cloaking criado':'Alterações salvas');
      } else { toast(d.error||'Erro ao salvar',false); if(st){ st.textContent=d.error||'Erro ao salvar'; st.style.color='var(--pink,#f31260)'; } }
    }).catch(function(){ toast('Erro ao salvar',false); if(st){ st.textContent='Erro ao salvar'; st.style.color='var(--pink,#f31260)'; } });
}
function deleteCloakEntry(slug){
  if(!confirm('Apagar este link de cloaking? A URL /c/'+slug+' deixará de funcionar.')) return;
  fetch('/api/cloak/entries/'+encodeURIComponent(slug),{method:'DELETE'})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.ok){ CK_ENTRIES=CK_ENTRIES.filter(function(x){return x.slug!==slug;}); if(CK_OPEN===slug) CK_OPEN=null; renderCloakList(); toast('Link removido'); }
      else toast('Erro ao remover',false);
    }).catch(function(){ toast('Erro ao remover',false); });
}
function bindCloak(){
  var nw=document.getElementById('ck-new');
  if(nw) nw.addEventListener('click',function(){ CK_OPEN=(CK_OPEN==='__new__')?null:'__new__'; renderCloakList(); if(CK_OPEN==='__new__'){ var f=document.getElementById('cke-nome'); if(f) f.focus(); } });
  var list=document.getElementById('ck-list');
  if(list) list.addEventListener('click',function(e){
    var cp=e.target.closest?e.target.closest('[data-ck-copy]'):null;
    if(cp){ navigator.clipboard.writeText(cp.getAttribute('data-ck-copy')).then(function(){ toast('Link copiado'); }); return; }
    var ed=e.target.closest?e.target.closest('[data-ck-edit]'):null;
    if(ed){ var s=ed.getAttribute('data-ck-edit'); CK_OPEN=(CK_OPEN===s)?null:s; renderCloakList(); return; }
    var del=e.target.closest?e.target.closest('[data-ck-del]'):null;
    if(del){ deleteCloakEntry(del.getAttribute('data-ck-del')); return; }
  });
  // White page global de fallback: carrega o valor atual e salva.
  var gw=document.getElementById('ck-global-white');
  if(gw){
    fetch('/api/cloak-config',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
      if(d&&typeof d.defaultWhitePage==='string') gw.value=d.defaultWhitePage;
    }).catch(function(){});
  }
  var gwSave=document.getElementById('ck-global-white-save');
  if(gwSave) gwSave.addEventListener('click',function(){
    var v=(gw&&gw.value||'').trim();
    if(v && v.slice(0,8).toLowerCase()!=='https://'){ toast('A p\u00e1gina segura deve come\u00e7ar com https://',false); return; }
    fetch('/api/cloak-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({defaultWhitePage:v})})
      .then(function(r){return r.json();})
      .then(function(d){ toast(d&&d.ok!==false?'P\u00e1gina segura salva':'Erro ao salvar', d&&d.ok!==false); })
      .catch(function(){ toast('Erro ao salvar',false); });
  });
  // Atualizar métricas de decisão (offer/white).
  var rf=document.getElementById('ck-stats-refresh');
  if(rf) rf.addEventListener('click',function(){ loadCloakStats(); toast('M\u00e9tricas atualizadas'); });
}

/* ─��� Links curtos rastreáveis (/l/:slug) ── */
function loadShortlinks(){
  fetch('/api/shortlinks',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
    var el=document.getElementById('sl-list'); if(!el) return;
    var list=d.shortlinks||[];
    if(!list.length){ el.innerHTML='<p class="hint" style="margin:0">Nenhum link ainda. Crie o primeiro acima.</p>'; return; }
    el.innerHTML=list.map(function(s){
      var short=location.origin+'/l/'+s.slug;
      return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line,rgba(255,255,255,.05));font-size:12.5px">'+
        '<span class="sl-slug">/l/'+esc(s.slug)+'</span>'+
        '<span class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1" title="'+esc(s.url)+'">'+esc(s.url)+'</span>'+
        '<span class="muted" style="flex:none;font-variant-numeric:tabular-nums">'+(s.clicks||0)+(s.clicks===1?' clique':' cliques')+'</span>'+
        '<button class="btn-icon" data-copy="'+esc(short)+'" title="Copiar link">Copiar</button>'+
        '<button class="cn-x" data-del="'+esc(s.slug)+'" title="Apagar" aria-label="Apagar link">&times;</button></div>';
    }).join('');
  }).catch(function(){});
}
function bindShortlinks(){
  var add=document.getElementById('sl-add');
  if(add) add.addEventListener('click',function(){
    var slug=document.getElementById('sl-slug').value.trim();
    var url=document.getElementById('sl-url').value.trim();
    if(!slug||!url){ toast('Preencha slug e URL'); return; }
    fetch('/api/shortlinks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug:slug,nome:slug,url:url})})
      .then(function(r){return r.json();})
      .then(function(d){
        if(d.ok){ toast('Link criado'); document.getElementById('sl-slug').value=''; document.getElementById('sl-url').value=''; loadShortlinks(); }
        else toast(d.error||'Erro ao criar',false);
      }).catch(function(){ toast('Erro ao criar',false); });
  });
  var list=document.getElementById('sl-list');
  if(list) list.addEventListener('click',function(e){
    var cp=e.target.closest?e.target.closest('[data-copy]'):null;
    if(cp){ navigator.clipboard.writeText(cp.getAttribute('data-copy')).then(function(){ toast('Link copiado'); }); return; }
    var del=e.target.closest?e.target.closest('[data-del]'):null;
    if(del){
      var slDel=del.getAttribute('data-del');
      uiConfirm({title:'Apagar este link curto?',msg:'A URL /l/'+slDel+' deixa de funcionar na hora.',okLabel:'Apagar',danger:true},function(){
        fetch('/api/shortlinks/'+slDel,{method:'DELETE'})
          .then(function(){ toast('Link apagado'); loadShortlinks(); }).catch(function(){});
      });
    }
  });
}

/* ── API pública read-only ── */
function bindPublicApi(){
  var gen=document.getElementById('api-gen'), copy=document.getElementById('api-copy'), inp=document.getElementById('api-url');
  if(!gen) return;
  gen.addEventListener('click',function(){
    fetch('/api/public-token').then(function(r){return r.json();}).then(function(d){
      if(!d.token) return toast('Erro ao gerar token',false);
      inp.value=location.origin+'/api/v1/summary?token='+d.token;
      copy.hidden=false;
      toast('Endpoint pronto — copie e use');
    }).catch(function(){ toast('Erro ao gerar token',false); });
  });
  copy.addEventListener('click',function(){
    navigator.clipboard.writeText(inp.value).then(function(){ toast('URL copiada'); });
  });
}
/* ── Pixel TikTok ───────────────────────────────────��─────────────── */
var PX_LIST=[];
function loadPixels(){
  fetch('/api/pixels').then(function(r){return r.json();}).then(function(d){
    PX_LIST=d.pixels||[];
    renderPixels();
    var badge=document.getElementById('nav-px-badge');
    var n=PX_LIST.filter(function(p){return p.active;}).length;
    if(badge){ badge.textContent=n; badge.style.display=n?'':'none'; badge.className='badge live-badge'; }
    // guia de instalação: só faz sentido com pelo menos 1 pixel cadastrado
    var guide=document.getElementById('tk-guide');
    if(guide) guide.style.display=PX_LIST.length?'':'none';
  }).catch(function(){});
  loadPxLog();
  loadConvLog();
  loadCapiHealth();
  loadEmqTrend();
  loadGateways();
}
// Tendência de EMQ por pixel (série diária) + alerta de queda de qualidade.
function loadEmqTrend(){
  var box=document.getElementById('emq-trend'); if(!box) return;
  fetch('/api/pixels/emq-trend').then(function(r){return r.json();}).then(function(d){
    if(!d.ok||!d.pixels||!d.pixels.length){
      box.innerHTML='<div class="muted" style="font-size:12.5px">Sem dados de EMQ ainda \u2014 aparece aqui quando os pixels come\u00e7arem a disparar.</div>';
      return;
    }
    box.innerHTML=d.pixels.map(function(p){
      var trend=p.trend||[];
      // sparkline: uma barra por dia, altura proporcional ao EMQ (0-10)
      var bars=trend.map(function(t){
        var h=Math.max(3,Math.round((t.avg/10)*28));
        var col=t.avg>=6?'var(--success)':(t.avg>=3?'var(--amber,#e6a700)':'var(--pink)');
        return '<span title="'+esc(t.day)+': '+t.avg+'/10 ('+t.count+' disparos)" style="display:inline-block;width:8px;height:'+h+'px;background:'+col+';border-radius:2px;vertical-align:bottom;margin-right:2px"></span>';
      }).join('');
      if(!bars) bars='<span class="muted" style="font-size:11.5px">sem hist\u00f3rico</span>';
      var recent=p.recentAvg!=null?p.recentAvg+'/10':'--';
      var recentCls=p.recentAvg==null?'':(p.recentAvg>=6?'grn':(p.recentAvg>=3?'amb':'neg'));
      var alertChip='';
      if(p.alert==='baixo') alertChip='<span class="chip neg" style="margin-left:8px">EMQ baixo</span>';
      else if(p.alert==='queda') alertChip='<span class="chip amb" style="margin-left:8px">queda de '+((p.baseAvg||0)-(p.recentAvg||0)).toFixed(1)+' pts</span>';
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border,rgba(255,255,255,0.06))">'+
        '<div style="min-width:0"><div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(p.pixel)+alertChip+'</div>'+
        '<div class="muted" style="font-size:11px;margin-top:2px">m\u00e9dia recente <b class="'+recentCls+'">'+recent+'</b>'+(p.baseAvg!=null?' \u00b7 base '+p.baseAvg+'/10':'')+'</div></div>'+
        '<div style="display:flex;align-items:flex-end;height:28px">'+bars+'</div>'+
      '</div>';
    }).join('');
  }).catch(function(){});
}
// Saúde da CAPI: taxa de sucesso, EMQ médio, fila de retry e últimos erros
function loadCapiHealth(){
  fetch('/api/pixels/health').then(function(r){return r.json();}).then(function(d){
    if(!d.ok) return;
    function set(id,val,cls){
      var el=document.getElementById(id); if(!el) return;
      el.textContent=val; el.className='ph-v'+(cls?' '+cls:'');
    }
    if(d.total===0){
      set('ph-rate','--'); set('ph-emq','--'); set('ph-queue',d.retryQueue||0); set('ph-total','0');
      document.getElementById('ph-events').textContent='Nenhum disparo ainda \u2014 os n\u00fameros aparecem aqui assim que o pixel come\u00e7ar a disparar.';
      document.getElementById('ph-errors').innerHTML='';
      return;
    }
    set('ph-rate',d.rate+'%',d.rate>=90?'pos':(d.rate>=70?'amb':'neg'));
    set('ph-emq',d.emq!=null?d.emq+'/10':'--',d.emq>=6?'pos':(d.emq>=3?'amb':'neg'));
    set('ph-queue',String(d.retryQueue||0),d.retryQueue>0?'amb':'pos');
    set('ph-total',String(d.total));
    document.getElementById('ph-events').textContent=(d.events||[]).map(function(e){
      return e.event+' '+e.rate+'%'+(e.emq!=null?' (match '+e.emq+')':'');
    }).join(' \u00b7 ');
    var errs=d.errors||[];
    document.getElementById('ph-errors').innerHTML=errs.length?errs.map(function(e){
      return '<div class="ph-err"><span>'+esc(e.pixel||'?')+' \u00b7 '+esc(e.event||'?')+' \u2014 '+esc(String(e.message||'erro').slice(0,80))+'</span><span class="pe-t">'+timeAgo(e.at)+'</span></div>';
    }).join(''):'';
  }).catch(function(){});
}
function renderPixels(){
  var el=document.getElementById('px-list'); if(!el) return;
  if(!PX_LIST.length){
    el.innerHTML='<div class="live-empty">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:40px;height:40px"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>' +
      '<div><b>Nenhum pixel do TikTok ativo</b><p style="margin:6px 0 0;color:var(--text-muted);font-size:12px;line-height:1.6">Cadastre o ID do seu pixel no botão <b>+ Adicionar pixel</b> para ativar o rastreamento inteligente via API de Conversões.</p></div>' +
    '</div>';
    return;
  }
  el.innerHTML=PX_LIST.map(function(p){
    var evs=Object.keys(p.events||{}).filter(function(k){return p.events[k];}).join(' · ')||'nenhum';
    return '<div class="lrow" style="cursor:default">'+
      '<span class="ldot" style="background:'+(p.active?'var(--green)':'var(--muted2)')+';box-shadow:none"></span>'+
      '<div class="lmain">'+
        '<b>'+esc(p.name)+' <span class="hint" style="font-weight:400">pixels/'+esc(p.slug)+'.json</span></b>'+
        '<span style="font-family:\\'Geist Mono\\',monospace">'+esc(p.pixelCode)+'</span>'+
        '<span>Server-side: '+esc(evs)+(p.hasToken?'':' &middot; <span class="amb">sem token (só navegador)</span>')+'</span>'+
      '</div>'+
      '<div class="lmeta" style="flex-direction:row;gap:6px;align-items:center">'+
        (p.scriptTag?'<button class="btn-icon" onclick="copyPxScript(\\''+esc(p.slug)+'\\')" title="Script exclusivo deste pixel — cole em qualquer página">Copiar script</button>':'')+
        '<button class="btn-icon" onclick="testPixel(\\''+esc(p.slug)+'\\')">Testar</button>'+
        '<button class="btn-icon" onclick="editPixel(\\''+esc(p.slug)+'\\')">Editar</button>'+
        '<button class="btn-icon" style="color:var(--red)" onclick="delPixel(\\''+esc(p.slug)+'\\')">Excluir</button>'+
      '</div>'+
    '</div>';
  }).join('');
}
function showPxForm(px){
  var g=document.getElementById('px-grid'); if(g) g.classList.add('form-open');
  document.getElementById('px-form-card').style.display='';
  document.getElementById('px-form-title').textContent=px?('Editar: '+px.name):'Novo pixel';
  document.getElementById('px-slug').value=px?px.slug:'';
  document.getElementById('px-name').value=px?px.name:'';
  document.getElementById('px-code').value=px?px.pixelCode:'';
  document.getElementById('px-token').value=px?(px.accessToken||''):'';
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
// Copia o <script> exclusivo do pixel (estilo Xtracky): dispara SÓ este pixel
function copyPxScript(slug){
  var px=PX_LIST.filter(function(p){return p.slug===slug;})[0];
  if(!px||!px.scriptTag) return;
  navigator.clipboard.writeText(px.scriptTag).then(function(){ toast('Script do pixel copiado \u2014 cole no head das suas p\u00e1ginas'); });
}
function delPixel(slug){
  uiConfirm({title:'Excluir este pixel?',msg:'"'+slug+'" para de disparar eventos para o TikTok na hora.',okLabel:'Excluir',danger:true},function(){
    fetch('/api/pixels/'+encodeURIComponent(slug),{method:'DELETE'})
      .then(function(r){return r.json();})
      .then(function(d){ if(d.ok){ toast('Pixel removido'); loadPixels(); } else toast(d.error||'Erro',false); })
      .catch(function(){ toast('Erro ao remover',false); });
  });
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
      if(d.ok){ toast('Pixel salvo em pixels/'+d.pixel.slug+'.json'); document.getElementById('px-form-card').style.display='none'; var g=document.getElementById('px-grid'); if(g) g.classList.remove('form-open'); loadPixels(); }
      else toast(d.error||'Erro ao salvar',false);
    })
    .catch(function(){ btn.disabled=false; toast('Erro ao salvar',false); });
}
/* ── Gateways de pagamento (webhook dedicado por gateway) ─────────── */
var GW_LIST=[], GW_PROVIDERS=[];
function loadGateways(){
  fetch('/api/gateways').then(function(r){return r.json();}).then(function(d){
    GW_LIST=d.gateways||[];
    GW_PROVIDERS=d.providers||[];
    renderGateways();
    var sel=document.getElementById('gw-provider');
    if(sel&&!sel.options.length){
      sel.innerHTML=GW_PROVIDERS.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.label)+'</option>';}).join('');
      sel.addEventListener('change',gwProviderHint);
      gwProviderHint();
    }
  }).catch(function(){});
}
function gwProviderHint(){
  var sel=document.getElementById('gw-provider'); if(!sel) return;
  var p=GW_PROVIDERS.filter(function(x){return x.id===sel.value;})[0]||{};
  var lbl=document.getElementById('gw-secret-label');
  if(lbl) lbl.textContent=p.secretLabel||'Segredo (opcional)';
  var docs=document.getElementById('gw-provider-docs');
  if(docs) docs.textContent=p.docs||'';
}
function renderGateways(){
  var el=document.getElementById('gw-list'); if(!el) return;
  if(!GW_LIST.length){
    el.innerHTML='<div class="live-empty">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:40px;height:40px"><path d="M4 7h16M4 12h16M4 17h10"/></svg>' +
      '<div><b>Nenhum gateway cadastrado</b><p style="margin:6px 0 0;color:var(--text-muted);font-size:12px;line-height:1.6">Clique em <b>+ Adicionar gateway</b>, escolha a plataforma e cole a URL gerada no painel dela.</p></div>' +
    '</div>';
    return;
  }
  el.innerHTML=GW_LIST.map(function(g){
    var st=g.lastEventAt?(timeAgo(g.lastEventAt)+' \u00b7 '+(g.lastEventStatus||'')):'nenhum webhook recebido ainda';
    var stOk=g.lastEventStatus&&g.lastEventStatus.indexOf('ok')===0;
    var prov=GW_PROVIDERS.filter(function(x){return x.id===g.provider;})[0];
    return '<div class="lrow" style="cursor:default">'+
      '<span class="ldot" style="background:'+(g.lastEventAt?(stOk?'var(--green)':'var(--red)'):'var(--muted2)')+';box-shadow:none"></span>'+
      '<div class="lmain">'+
        '<b>'+esc(g.name)+' <span class="hint" style="font-weight:400">'+esc(prov?prov.label:g.provider)+'</span></b>'+
        '<span style="font-family:\\'Geist Mono\\',monospace;font-size:11.5px;word-break:break-all">'+esc(g.webhookUrl||'')+'</span>'+
        '<span>'+esc(st)+(g.hasSecret?' &middot; assinatura verificada':'')+'</span>'+
      '</div>'+
      '<div class="lmeta" style="flex-direction:row;gap:6px;align-items:center">'+
        '<button class="btn-icon" onclick="copyGwUrl(\\''+esc(g.id)+'\\')">Copiar URL</button>'+
        '<button class="btn-icon" onclick="editGateway(\\''+esc(g.id)+'\\')">Editar</button>'+
        '<button class="btn-icon" style="color:var(--red)" onclick="delGateway(\\''+esc(g.id)+'\\')">Excluir</button>'+
      '</div>'+
    '</div>';
  }).join('');
}
function copyGwUrl(id){
  var g=GW_LIST.filter(function(x){return x.id===id;})[0];
  if(!g||!g.webhookUrl) return;
  navigator.clipboard.writeText(g.webhookUrl).then(function(){ toast('URL do webhook copiada \u2014 cole no painel do gateway'); });
}
function showGwForm(g){
  var grid=document.getElementById('gw-grid'); if(grid) grid.classList.add('form-open');
  document.getElementById('gw-form-card').style.display='';
  document.getElementById('gw-form-title').textContent=g?('Editar: '+g.name):'Novo gateway';
  document.getElementById('gw-id').value=g?g.id:'';
  document.getElementById('gw-name').value=g?g.name:'';
  document.getElementById('gw-secret').value='';
  var sel=document.getElementById('gw-provider');
  if(sel&&g) sel.value=g.provider;
  gwProviderHint();
  document.getElementById('gw-name').focus();
}
function editGateway(id){
  var g=GW_LIST.filter(function(x){return x.id===id;})[0];
  if(g) showGwForm(g);
}
function delGateway(id){
  var g=GW_LIST.filter(function(x){return x.id===id;})[0];
  uiConfirm({title:'Excluir este gateway?',msg:'"'+(g?g.name:id)+'" para de receber vendas na hora \u2014 a URL de notifica\u00e7\u00e3o deixa de funcionar.',okLabel:'Excluir',danger:true},function(){
    fetch('/api/gateways/'+encodeURIComponent(id),{method:'DELETE'})
      .then(function(r){return r.json();})
      .then(function(d){ if(d.ok){ toast('Gateway removido'); loadGateways(); } else toast(d.error||'Erro',false); })
      .catch(function(){ toast('Erro ao remover',false); });
  });
}
function saveGateway(){
  var body={
    id:document.getElementById('gw-id').value||undefined,
    provider:document.getElementById('gw-provider').value,
    name:document.getElementById('gw-name').value.trim()
  };
  var secret=document.getElementById('gw-secret').value.trim();
  if(secret) body.secret=secret;
  var btn=document.getElementById('gw-save'); btn.disabled=true;
  fetch('/api/gateways',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json();})
    .then(function(d){
      btn.disabled=false;
      if(d.ok){
        document.getElementById('gw-form-card').style.display='none';
        var grid=document.getElementById('gw-grid'); if(grid) grid.classList.remove('form-open');
        loadGateways();
        if(d.gateway&&d.gateway.webhookUrl&&navigator.clipboard){
          navigator.clipboard.writeText(d.gateway.webhookUrl).then(function(){ toast('Gateway salvo \u2014 URL do webhook j\u00e1 copiada'); }).catch(function(){ toast('Gateway salvo \u2014 copie a URL na lista'); });
        } else toast('Gateway salvo');
      }
      else toast(d.error||'Erro ao salvar',false);
    })
    .catch(function(){ btn.disabled=false; toast('Erro ao salvar',false); });
}
function loadPxLog(){
  fetch('/api/pixels/log').then(function(r){return r.json();}).then(function(d){
    var tb=document.getElementById('px-log'); if(!tb) return;
    var log=d.log||[];
    if(!log.length){ tb.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--muted2);padding:26px">Nenhum disparo ainda — os eventos aparecem aqui conforme os leads navegam.</td></tr>'; return; }
    tb.innerHTML=log.map(function(e){
      var ok=e.status==='ok';
      var resp=e.response&&e.response.message?e.response.message:(ok?'aceito':'—');
      // EMQ 0-10: verde >=6, âmbar 3-5, vermelho <3 — sinais no title (hover)
      var emqCell='<span style="color:var(--muted2)">—</span>';
      if(e.emq!=null){
        var cls=e.emq>=6?'grn':(e.emq>=3?'amb':'neg');
        var flds=(e.emqFields||[]).join(', ')||'nenhum sinal';
        emqCell='<span class="'+cls+'" title="Sinais: '+esc(flds)+'" style="font-family:\\'Geist Mono\\',monospace;font-weight:700">'+e.emq+'/10</span>';
      }
      return '<tr style="cursor:default">'+
        '<td>'+timeAgo(e.at)+'</td>'+
        '<td>'+esc(e.pixel||'—')+'</td>'+
        '<td><span class="tag '+(e.event==='CompletePayment'?'purchased':(e.event==='InitiateCheckout'?'checkout':'visit'))+'">'+esc(e.event||'—')+'</span></td>'+
        '<td style="font-family:\\'Geist Mono\\',monospace;font-size:11.5px">'+esc((e.leadId||'��').slice(0,10))+'</td>'+
        '<td>'+emqCell+'</td>'+
        '<td><span class="'+(ok?'grn':'neg')+'">'+(ok?'OK':'erro')+'</span></td>'+
        '<td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;font-size:11.5px;color:var(--muted2)">'+esc(String(resp).slice(0,120))+'</td>'+
      '</tr>';
    }).join('');
  }).catch(function(){});
}
// ── Webhook universal de conversões ──
var CW_SECRET='', CW_REVEALED=false;
// encodeURIComponent: segredos com @, &, + etc. precisam ser escapados na URL
function cwUrl(){ return location.origin+'/api/conversion?secret='+(CW_REVEALED?encodeURIComponent(CW_SECRET):'\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'); }
function loadConvLog(){
  fetch('/api/conversion/log').then(function(r){return r.json();}).then(function(d){
    CW_SECRET=d.secret||'';
    var inp=document.getElementById('cw-url');
    if(inp) inp.value=d.configured?cwUrl():'configure CONVERSION_WEBHOOK_SECRET no servidor';
    var st=document.getElementById('cw-status');
    if(st) st.innerHTML=d.configured?'Segredo configurado. Envie um POST de teste e ele aparece abaixo.':'<span class="neg">Sem segredo configurado — o endpoint responde 503 at\u00e9 voc\u00ea definir CONVERSION_WEBHOOK_SECRET.</span>';
    var tb=document.getElementById('cw-log'); if(!tb) return;
    var log=d.log||[];
    CW_LOG=log;
    // popula o filtro de gateways (mantém a seleção atual)
    var fsel=document.getElementById('cw-gw-filter');
    if(fsel){
      var prev=fsel.value;
      var gws=[]; log.forEach(function(e){ var g=e.gateway||''; if(g&&gws.indexOf(g)<0) gws.push(g); });
      fsel.innerHTML='<option value="">Todos os gateways</option>'+gws.map(function(g){return '<option value="'+esc(g)+'">'+esc(g)+'</option>';}).join('');
      if(prev&&gws.indexOf(prev)>=0) fsel.value=prev;
    }
    renderConvLog();
  }).catch(function(){});
}
/* Tabela leve: filtra pelo gateway escolhido e mostra só os 12 mais recentes */
var CW_LOG=[];
function renderConvLog(){
  var tb=document.getElementById('cw-log'); if(!tb) return;
  var fsel=document.getElementById('cw-gw-filter');
  var gw=fsel?fsel.value:'';
  var log=gw?CW_LOG.filter(function(e){return (e.gateway||'')===gw;}):CW_LOG;
  log=log.slice(0,12);
  if(!log.length){ tb.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--muted2);padding:26px">'+(gw?'Nenhum webhook deste gateway.':'Nenhum webhook recebido ainda \u2014 configure a URL acima no seu gateway.')+'</td></tr>'; return; }
  tb.innerHTML=log.map(function(e){
      var ok=e.status==='ok', dd=e.status==='dedup';
      return '<tr style="cursor:default">'+
        '<td>'+timeAgo(e.at)+'</td>'+
        '<td>'+esc(e.gateway||'\u2014')+'</td>'+
        '<td><span class="tag '+(e.event==='CompletePayment'?'purchased':(e.event==='InitiateCheckout'?'checkout':'visit'))+'">'+esc(e.event||'\u2014')+'</span></td>'+
        '<td>'+(e.amount?money(e.amount,e.currency):'\u2014')+'</td>'+
        '<td>'+(e.match==='\u00f3rf\u00e3'?'<span class="neg">\u00f3rf\u00e3</span>':'<span class="grn">'+esc(e.match||'\u2014')+'</span>')+'</td>'+
        '<td><span class="'+(ok?'grn':(dd?'':'neg'))+'">'+esc(e.status||'\u2014')+'</span></td>'+
      '</tr>';
    }).join('');
}
/* ── Setup guiado ──
   Transforma o antigo grid de "Saúde" num checklist acionável:
   cada item pendente diz O QUE fazer e leva direto à tela certa. */
function setupItems(){
  // SaaS: apenas 3 itens configuráveis pelo usuário (infra é transparente)
  if(!HEALTH) return null;
  var items=[
    {ok:!!HEALTH.conversionWebhook,label:'Receber vendas do checkout',todo:'Copie a URL de notifica\u00e7\u00e3o e cole no painel do seu checkout \u2014 as vendas passam a entrar sozinhas',act:{t:'Configurar',go:'pixels'}},
    {ok:!!HEALTH.tiktok,label:'Pixel TikTok',todo:'Adicione um pixel TikTok com a chave de acesso v\u00e1lida',act:{t:'Adicionar pixel',go:'pixels'}},
    {ok:!!HEALTH.pushcut,label:'Alertas no celular',todo:'Cole a URL do seu app Pushcut para receber alertas de venda em tempo real',act:{t:'Configurar',go:'config'}}
  ];
  return items;
}
function setupChecklistHTML(compact){
  var items=setupItems(); if(!items) return '';
  var done=items.filter(function(i){return i.ok;}).length, total=items.length;
  var pct=Math.round(done/total*100);
  var pend=items.filter(function(i){return !i.ok;});
  // no modo compacto (Visão Geral) o card carrega o título; em Configurações o título vem da seção
  var html='<div class="setup-head">'+
    '<div>'+(compact?'<b class="setup-title">Configura&ccedil;&atilde;o do sistema</b>':'')+
    '<span class="setup-sub">'+done+' de '+total+' conclu\u00eddos</span></div>'+
    '<div class="setup-bar"><i style="width:'+pct+'%"></i></div></div>';
  var list=compact?pend:items;
  html+='<div class="setup-list">'+list.map(function(it){
    return '<div class="setup-item'+(it.ok?' done':'')+'">'+
      '<span class="si-dot">'+(it.ok?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>':'')+'</span>'+
      '<div class="si-txt"><b>'+esc(it.label)+'</b>'+(it.ok?'':'<span>'+it.todo+'</span>')+'</div>'+
      (!it.ok&&it.act?'<button class="btn btn-sm si-go" data-go="'+it.act.go+'">'+it.act.t+'</button>':'')+
    '</div>';
  }).join('')+'</div>';
  return html;
}
// Card na Visão Geral: desativado a pedido do usuário para deixar a aba Visão Geral mais limpa.
function renderSetupCard(){
  var el=document.getElementById('ov-setup'); if(!el) return;
  el.hidden=true;
  el.innerHTML='';
}
// Versão completa em Configurações
function renderHealth(){
  var grid=document.getElementById('health-grid'); if(!grid) return;
  grid.removeAttribute('aria-busy');
  if(!HEALTH){ grid.innerHTML='<div class="muted" style="padding:8px 0;font-size:13px">Indispon&iacute;vel</div>'; return; }
  grid.innerHTML=setupChecklistHTML(false);
}

/* ── Drawer ── */
function openLead(id){
  var l=leadsById[id];
  if(!l) return;
  currentLeadId=id;
  document.getElementById('drawer-title').textContent='Lead '+id.slice(0,18);
  var names={visit:'Visita',checkout:'Checkout',purchased:'Comprou'};
  function grp(t){ return '<div class="dgroup">'+t+'</div>'; }
  function r(k,v){ return '<div class="dl"><span class="dk">'+k+'</span><span class="dv">'+(v==null||v===''?'—':v)+'</span></div>'; }
  var rows='';
  rows+=grp('Funil');
  rows+=r('ID completo','<span style="font-family:monospace;font-size:12px;word-break:break-all">'+esc(l.id)+'</span>');
  rows+=r('Etapa','<span class="tag '+l.stage+'">'+(names[l.stage]||l.stage)+'</span>');
  rows+=r('Gateway',l.gateway?'<span class="tag checkout">'+esc(gwLabel(l.gateway))+'</span>':'—');
  if(l.checkoutHits&&l.checkoutHits.length) rows+=r('Checkouts',l.checkoutHits.map(function(h){return esc(gwLabel(h.gateway));}).join(' &#8594; '));
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
  rows+=r('Landing',esc(l.landing)); rows+=r('Site / funil',esc(l.site)); rows+=r('Referer',esc(l.referer));
  if(l.utm){ rows+=r('UTM source',esc(l.utm.source)); rows+=r('UTM campanha',esc(l.utm.campaign)); rows+=r('UTM m&eacute;dia',esc(l.utm.medium)); }
  rows+=r('ttclid',l.ttclid?'<span style="font-family:monospace;font-size:11px;word-break:break-all">'+esc(l.ttclid)+'</span>':'—');
  if(l.journey&&l.journey.length){
    rows+=grp('Trajeto ('+l.journey.length+(l.journey.length===1?' passo':' passos')+')');
    // tempo entre etapas: revela onde o lead hesita (ex.: 4min parado na VSL)
    function stepDelta(ms){
      if(ms<1000) return '';
      var s=Math.round(ms/1000);
      if(s<60) return '+'+s+'s';
      var mn=Math.round(s/60);
      if(mn<60) return '+'+mn+'min';
      return '+'+Math.round(mn/60)+'h';
    }
    rows+='<div class="jrny">'+l.journey.map(function(s,i){
      var p=String(s.p||'');
      var cls='', label=p;
      if(p==='compra'){ cls=' buy'; label='Compra'; }
      else if(p.indexOf('go:')===0){ cls=' go'; label='Checkout: '+p.slice(3).replace(/^link:/,''); }
      else if(p.indexOf('click:')===0){ cls=' clk'; label='Clique: '+p.slice(6); }
      else if(p.indexOf('l:')===0){ cls=' go'; label='Link curto: /l/'+p.slice(2); }
      var delta='';
      if(i>0){
        var dm=new Date(s.at).getTime()-new Date(l.journey[i-1].at).getTime();
        if(isFinite(dm)&&dm>0) delta=stepDelta(dm);
      }
      return '<div class="jstep'+cls+'"><span class="jdot"></span><span class="jp">'+esc(label)+(delta?' <span class="jdelta">'+delta+'</span>':'')+'</span><span class="jt">'+timeAgo(s.at)+'</span></div>';
    }).join('')+'</div>';
  }
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
// ── Popup de confirmação estilizado (substitui confirm() nativo) ──
// uiConfirm({title, msg, okLabel, danger, icon}, function(){ ...confirmado... })
var POP_CB=null;
function uiConfirm(opts,cb){
  var bg=document.getElementById('pop-bg');
  var ico=document.getElementById('pop-ico');
  document.getElementById('pop-title').textContent=opts.title||'Tem a certeza?';
  document.getElementById('pop-msg').textContent=opts.msg||'';
  var ok=document.getElementById('pop-ok');
  ok.textContent=opts.okLabel||'Confirmar';
  ok.className='btn'+(opts.danger?' pop-danger':'');
  ico.className='pop-ico '+(opts.icon||(opts.danger?'warn':'info'));
  ico.innerHTML=opts.danger
    ? '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>'
    : '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
  document.getElementById('pop-cancel').style.display=opts.noCancel?'none':'';
  POP_CB=cb||null;
  bg.classList.add('open');
  ok.focus();
}
function popClose(){ document.getElementById('pop-bg').classList.remove('open'); POP_CB=null; }
document.getElementById('pop-cancel').addEventListener('click',popClose);
document.getElementById('pop-bg').addEventListener('click',function(e){ if(e.target===this) popClose(); });
document.getElementById('pop-ok').addEventListener('click',function(){
  var cb=POP_CB; popClose(); if(cb) cb();
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&document.getElementById('pop-bg').classList.contains('open')) popClose();
});

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

/* ─�� Paleta de comandos ⌘K ── */
var CMD_ITEMS=[
  {g:'Telas',t:'Visão Geral',h:'resumo',ic:I.money,act:function(){setView('overview');}},
  {g:'Telas',t:'Ao Vivo',h:'presença, funil, países',ic:I.zap,act:function(){setView('live');}},
  {g:'Telas',t:'Rastreamento',h:'links, pixel e filtro de bots',ic:I.pct,act:function(){setView('tracking');}},
  {g:'Telas',t:'Configurações',h:'sistema',ic:I.check,act:function(){setView('config');}},
  {g:'Ir para',t:'Links de Checkout',h:'dentro de Rastreamento',ic:I.pct,act:function(){setView('links');}},
  {g:'Ir para',t:'Pixel TikTok',h:'dentro de Rastreamento',ic:I.zap,act:function(){setView('pixels');}},
  {g:'Ir para',t:'Gateways',h:'dentro de Rastreamento',ic:I.pct,act:function(){setView('gateways');}},
  {g:'Ir para',t:'Filtro de Bots',h:'dentro de Rastreamento',ic:I.shield,act:function(){setView('cloak');}},
  {g:'Ir para',t:'Funil & Leads',h:'dentro de Ao Vivo',ic:I.cart,act:function(){setView('funnel');}},
  {g:'Ir para',t:'Países',h:'dentro de Ao Vivo',ic:I.globe,act:function(){setView('geo');}},
  {g:'Ir para',t:'Atividade',h:'dentro de Ao Vivo',ic:I.zap,act:function(){setView('activity');}},
  {g:'Período',t:'Hoje',ic:I.check,act:function(){setPeriod('today');}},
  {g:'Período',t:'��ltimos 7 dias',ic:I.check,act:function(){setPeriod('7d');}},
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
  else if(g==='tracking'&&trackingTab==='links'){ renderPageConv(); }
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
function loadHealth(){ return fetch('/api/health',{cache:'no-store'}).then(function(r){return r.json();}).then(function(h){HEALTH=h;}).catch(function(){}); }
/* Atualiza��ão inteligente: só re-renderiza quando os dados realmente
   mudaram (fingerprint) — elimina o repinte periódico que reiniciava
   animações e piscava a tela a cada 12s. */
var lastFp='', refreshing=false;
function dataFp(){
  if(!DATA) return '';
  return (DATA.updatedAt||'')+':'+((DATA.events||[]).length)+':'+((DATA.leads||[]).length);
}
function refresh(force){
  if(refreshing) return Promise.resolve(); // evita requisições sobrepostas
  refreshing=true;
  return loadStats()
    .then(function(){
      refreshing=false;
      var fp=dataFp();
      if(force||fp!==lastFp){
        lastFp=fp;
        RENDERED_GROUPS={}; // dados novos: os outros grupos repintam ao serem abertos
        renderAll(); ingestNotifs();
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
  tracking:['links','pixels','gateways','cloak'],
  config:['config']
  };
  var titles={
  overview:['Visão Geral','Resumo dos números que mais importam'],
  live:['Ao Vivo','Presença, funil, países e atividade — tudo em tempo real'],
  tracking:['Rastreamento','Links de checkout, pixel TikTok e filtro de bots'],
  config:['Configurações','Notificações, chaves e saúde do sistema']
  };
  // rótulos das sub-abas do Rastreamento (aparecem no page-sub)
  var TRACK_LABELS={links:'Links de Checkout',pixels:'Pixel TikTok',gateways:'Gateways',cloak:'Filtro de Bots'};
  var trackingTab=localStorage.getItem('trackingTab')||'links';
  if(!TRACK_LABELS[trackingTab]) trackingTab='links';
// Aceita tanto a chave do grupo quanto o nome de uma sub-view antiga
// (ex.: setView('funnel') abre o grupo Ao Vivo e rola até o funil).
function groupOf(v){
  if(VIEW_GROUPS[v]) return v;
  for(var g in VIEW_GROUPS){ if(VIEW_GROUPS[g].indexOf(v)>=0) return g; }
  return 'overview';
}
/* Transição de aba com View Transitions API (crossfade nativo);
   fallback direto em navegadores sem suporte ou com reduced-motion */
function setView(v){
  if(document.startViewTransition&&!REDUCED&&groupOf(v)!==currentView){
  document.startViewTransition(function(){ applySetView(v); });
  } else {
  applySetView(v);
  }
  // 1ª visita às Configurações: popup de orientação (não volta a aparecer)
  if(v==='config'&&!localStorage.getItem('cfgWelcomed')){
    localStorage.setItem('cfgWelcomed','1');
    setTimeout(function(){
      uiConfirm({title:'Bem-vindo \u00e0s Configura\u00e7\u00f5es',
        msg:'Aqui ficam o script de acompanhamento para as suas p\u00e1ginas, os dom\u00ednios pr\u00f3prios e a API. Copie o script e cole nas suas p\u00e1ginas para come\u00e7ar a medir visitas.',
        okLabel:'Entendi',icon:'hi',noCancel:true});
    },350);
  }
  }
/* ── Gota líquida do nav: mede o botão ativo e desliza (esticando no caminho) ── */
function moveGota(){
  var nav=document.getElementById('nav'); if(!nav) return;
  var gota=document.getElementById('nav-gota');
  if(!gota){ gota=document.createElement('div'); gota.id='nav-gota'; nav.insertBefore(gota,nav.firstChild); }
  var act=nav.querySelector('button.active'); if(!act){ gota.style.opacity='0'; return; }
  gota.style.opacity='1';
  gota.style.width=act.offsetWidth+'px';
  gota.style.transform='translateX('+act.offsetLeft+'px)';
}
window.addEventListener('resize',function(){ moveGota(); });
window.addEventListener('load',function(){ setTimeout(moveGota,120); }); // re-mede após fontes carregarem

/* Specular tracking duplicado removido: trackSpecular() (sob o gate do Liquid
   Glass) já cobre .card/.lg — este rodava sempre, inclusive no Safari onde o
   reflexo nem é renderizado, desperdiçando layout a cada movimento do mouse. */

/* ── Topbar condensa ao rolar ── */
(function(){
  var last=false;
  window.addEventListener('scroll',function(){
    var c=window.scrollY>80;
    if(c!==last){ last=c; document.querySelectorAll('.topbar').forEach(function(t){ t.classList.toggle('condensed',c); }); }
  },{passive:true});
})();

function applySetView(v){
  var g=groupOf(v), sub=(v!==g)?v:null;
  currentView=g;
  var views=VIEW_GROUPS[g];
  // Rastreamento mostra UMA sub-aba por vez (memorizada); grupos normais empilham as sections
  if(g==='tracking'){
    if(sub){ trackingTab=sub; localStorage.setItem('trackingTab',sub); }
    views=[trackingTab];
  }
  document.querySelectorAll('.nav button[data-view]').forEach(function(b){ b.classList.toggle('active',b.getAttribute('data-view')===g); });
  moveGota();
  document.querySelectorAll('section.view').forEach(function(s){ s.classList.toggle('active',views.indexOf(s.id.replace('view-',''))>=0); });
  // barra de sub-abas só visível no Rastreamento
  var tt=document.getElementById('tracking-tabs');
  if(tt){
    tt.hidden=(g!=='tracking');
    tt.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active',b.getAttribute('data-t')===trackingTab); });
  }
  document.getElementById('page-title').textContent=titles[g][0];
  document.getElementById('page-sub').textContent=(g==='tracking')?('Rastreamento \u00b7 '+TRACK_LABELS[trackingTab]):titles[g][1];
  document.getElementById('sidebar').classList.remove('open');
  var scrim=document.getElementById('side-scrim'); if(scrim) scrim.classList.remove('open');
  window.scrollTo(0,0); // aba nova abre sempre no topo (não herda o scroll da anterior)
  // animação de entrada em cascata (só na primeira section do grupo)
  var sec=document.getElementById('view-'+views[0]);
  if(sec){ sec.classList.remove('entering'); void sec.offsetWidth; sec.classList.add('entering'); setTimeout(function(){sec.classList.remove('entering');},700); }
  if(!RENDERED_GROUPS[g]) renderAll(); // pinta o grupo na primeira abertura com os dados atuais
  // pausa o loop WebGL dos globos fora de vista (economiza CPU/GPU nas outras abas)
  try{
    if(liveGlobe){ if(g==='live')liveGlobe.resumeAnimation(); else liveGlobe.pauseAnimation(); }
    if(globoHero){ if(g==='overview')globoHero.resumeAnimation(); else globoHero.pauseAnimation(); }
  }catch(_){}
  if(g==='live'){
    renderLive();
    loadLive();
    var hadGlobe=!!liveGlobe; // se o globo já existia, refaz a entrada cinematográfica
    // globo FORA do caminho crítico do clique: a aba pinta primeiro (instantâneo),
    // o trabalho WebGL (polys + pontos + resize) roda no frame seguinte
    setTimeout(function(){
      renderLiveGlobe();
      if(liveGlobe){ try{liveGlobe.width(document.getElementById('live-globe').clientWidth).height(520);}catch(e){} }
      if(hadGlobe) globeEntrance(liveGlobe);
    },60);
  }
  if(g==='overview'){
    loadHealth().then(renderSetupCard);
    if(globoHero) globeEntrance(globoHero); // giro de entrada no globo hero
  }
  setupLivePoll(g==='live'); // polling mais rápido quando a aba Ao Vivo está aberta
  if(g==='config'){ loadHealth().then(function(){renderHealth();renderSetupCard();}); loadPushcutConfig(); loadShortlinks(); }
  if(g==='tracking'){
    if(trackingTab==='pixels') loadPixels();
    else if(trackingTab==='cloak') loadCloakConfig();
    else { loadLinks(); loadDomains(); }
  }
  // sub-view dentro do Ao Vivo (paleta de comandos)? rola até a section
  if(g==='live'&&sub){ setTimeout(function(){ var t=document.getElementById('view-'+sub); if(t) t.scrollIntoView({behavior:'smooth',block:'start'}); },120); }
  else { document.querySelector('.main').scrollTop=0; window.scrollTo(0,0); }
}
// troca de sub-aba dentro do Rastreamento
function setTrackingTab(t){
  if(!TRACK_LABELS[t]) return;
  trackingTab=t; localStorage.setItem('trackingTab',t);
  delete RENDERED_GROUPS.tracking; // repinta a sub-aba nova
  applySetView(t);
}
// Polling de presença: 4s na aba Ao Vivo, 10s em segundo plano (para o badge).
function setupLivePoll(fast){
  if(liveTimer) clearInterval(liveTimer);
  liveTimer=setInterval(loadLive,fast?4000:10000);
}

/* ── Listeners ── */
document.getElementById('nav').addEventListener('click',function(e){
  var b=e.target.closest('button[data-view]'); if(!b) return;
  var v=b.getAttribute('data-view');
  // clicar em "Rastreamento" no menu principal abre sempre em Links de Checkout
  // (a última sub-aba só persiste dentro da própria vista, não no menu)
  if(v==='tracking'){ trackingTab='links'; localStorage.setItem('trackingTab','links'); delete RENDERED_GROUPS.tracking; }
  setView(v);
});
document.getElementById('tracking-tabs').addEventListener('click',function(e){
  var b=e.target.closest('button[data-t]'); if(b) setTrackingTab(b.getAttribute('data-t'));
});
// setup guiado: botões "Configurar" levam à tela certa
document.addEventListener('click',function(e){
  var b=e.target.closest('.si-go'); if(b) setView(b.getAttribute('data-go'));
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
// ESC fecha camadas na ordem: modal do globo > drawer de lead > popover de calendário.
// (o cmdk tem handler próprio mais abaixo e consome o ESC quando aberto)
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape') return;
  if(document.getElementById('cmdk-bg').classList.contains('open')) return; // cmdk cuida
  var gm=document.getElementById('globe-modal');
  if(gm&&!gm.hidden){ globeModalClose(); return; }
  var dw=document.getElementById('drawer');
  if(dw&&dw.classList.contains('open')){ closeDrawer(); return; }
  var pop=document.getElementById('dr-pop');
  if(pop&&!pop.hidden) closeDrPop();
});
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
bindChartTip();
bindNotes();
loadNotes();
// toggle Vendas/Leads do heatmap de horários
(function(){
  var seg=document.getElementById('heat-mode');
  if(seg) seg.addEventListener('click',function(e){
    var b=e.target.closest('button'); if(!b) return;
    seg.querySelectorAll('button').forEach(function(x){ x.classList.remove('active'); });
    b.classList.add('active');
    heatMode=b.getAttribute('data-h');
    if(DATA) renderHeatmap();
  });
})();
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
  else{ toast('Clipboard indispon\u00edvel',false); }
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

document.getElementById('lk-new').addEventListener('click',function(){ showLinkForm(null); });
document.getElementById('lk-save').addEventListener('click',saveLink);
document.getElementById('dm-add').addEventListener('click',addDomain);
document.getElementById('dm-host').addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229) addDomain(); });
document.getElementById('lk-cancel').addEventListener('click',function(){ document.getElementById('lk-form-card').style.display='none'; var g=document.getElementById('lk-grid'); if(g) g.classList.remove('form-open'); });
  var lkDom=document.getElementById('lk-domain'); if(lkDom) lkDom.addEventListener('change',updateLinkDomainStatus);
  var abSplit=document.getElementById('lk-ab-split');
  if(abSplit) abSplit.addEventListener('input',function(){ updateAbSplitLabel(this.value); });
// auto-save: qualquer toggle de notificação salva na hora (sem botão Salvar)
['pc-ev-sale','pc-ev-failed','pc-ev-refund','pc-ev-dispute','pc-ev-checkout','pc-ev-daily'].forEach(function(id){
  var el=document.getElementById(id); if(el) el.addEventListener('change',savePushcutConfig);
});
var pcUrl=document.getElementById('pc-url');
if(pcUrl) pcUrl.addEventListener('change',savePushcutConfig);
  bindShortlinks();
  bindPublicApi();
  bindCloak();
  document.getElementById('pc-test').addEventListener('click',testPushcut);
document.getElementById('px-new').addEventListener('click',function(){ showPxForm(null); });
document.getElementById('px-save').addEventListener('click',savePixel);
document.getElementById('px-cancel').addEventListener('click',function(){ document.getElementById('px-form-card').style.display='none'; var g=document.getElementById('px-grid'); if(g) g.classList.remove('form-open'); });
document.getElementById('gw-new').addEventListener('click',function(){ showGwForm(null); });
document.getElementById('gw-save').addEventListener('click',saveGateway);
document.getElementById('gw-cancel').addEventListener('click',function(){ document.getElementById('gw-form-card').style.display='none'; var g=document.getElementById('gw-grid'); if(g) g.classList.remove('form-open'); });
document.getElementById('px-log-refresh').addEventListener('click',loadPxLog);
document.getElementById('cw-log-refresh').addEventListener('click',loadConvLog);
document.getElementById('cw-gw-filter').addEventListener('change',renderConvLog);
document.getElementById('ph-refresh').addEventListener('click',function(){loadCapiHealth();loadEmqTrend();});
document.getElementById('cw-reveal').addEventListener('click',function(){
  CW_REVEALED=!CW_REVEALED;
  document.getElementById('cw-url').value=cwUrl();
  this.textContent=CW_REVEALED?'Ocultar':'Revelar';
});
document.getElementById('cw-copy').addEventListener('click',function(){
  if(!CW_SECRET){ toast('Configure o segredo primeiro',false); return; }
  // copia sempre a URL REAL (com segredo URL-encoded), mesmo com o campo mascarado
  navigator.clipboard.writeText(location.origin+'/api/conversion?secret='+encodeURIComponent(CW_SECRET))
    .then(function(){ toast('URL copiada com o segredo',true); })
    .catch(function(){ toast('Erro ao copiar',false); });
});
document.getElementById('cw-test').addEventListener('click',function(){
  var btn=this; btn.disabled=true; btn.textContent='Testando\u2026';
  fetch('/api/conversion/test',{method:'POST'})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.ok&&d.receipt){ toast('Webhook OK \u2014 status: '+(d.receipt.status||'?')); loadConvLog(); }
      else toast('Falhou: '+(d.error||'erro desconhecido'),false);
    })
    .catch(function(){ toast('Erro de rede no teste',false); })
    .finally(function(){ btn.disabled=false; btn.textContent='Testar'; });
});
/* ── Snippet de rastreamento para páginas externas ── */
function trackerSnippet(){ var o=linkOrigin(); return '<script src="'+o+'/t.js" defer><\\/script><noscript><img src="'+o+'/px.gif" alt="" width="1" height="1" style="position:absolute;left:-9999px"></noscript>'; }
(function(){
  var inp=document.getElementById('tk-snippet');
  if(inp) inp.value=trackerSnippet();
})();
document.getElementById('tk-copy').addEventListener('click',function(){
  navigator.clipboard.writeText(trackerSnippet())
    .then(function(){ toast('Script copiado \u2014 cole no <head> das suas p\u00e1ginas'); })
    .catch(function(){ toast('Clipboard indispon\u00edvel',false); });
});
document.getElementById('reset-btn').addEventListener('click',function(){
  uiConfirm({title:'Apagar todos os dados?',msg:'Todos os leads e eventos ser\u00e3o apagados de forma permanente. N\u00e3o h\u00e1 como recuperar depois.',okLabel:'Apagar tudo',danger:true},function(){
    fetch('/api/reset-stats',{method:'POST'})
      .then(function(){ toast('Estat\u00edsticas zeradas'); refresh(); })
      .catch(function(){toast('Erro',false);});
  });
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


/* ── Scroll-in: revela cards UMA vez ao entrarem na viewport (mata loop ambiente) ── */
(function(){
  var els=document.querySelectorAll('.reveal');
  if(REDUCED||!('IntersectionObserver' in window)){ els.forEach(function(e){e.classList.add('in');}); return; }
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); } });
  },{threshold:.12});
  els.forEach(function(e){ io.observe(e); });
})();

/* ── Boot ── */
var LS=document.getElementById('loading-screen');
function hideLS(){ if(LS){ LS.classList.add('hide'); setTimeout(function(){LS.style.display='none';},320); } }
// rede de segurança: nunca deixa a tela de carregamento presa
var lsGuard=setTimeout(hideLS,8000);
refresh().then(function(){
  setupAuto();
  loadLive();            // primeira leitura de presença
  loadHealth().then(renderSetupCard); // setup guiado na Visão Geral desde o boot
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
