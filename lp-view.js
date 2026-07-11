// Landing Page do SaaS ROI-NADOS — servida como HTML estático em /.
// Identidade dark premium alinhada à dashboard (Inter + Geist Mono, ciano/rosa,
// logo orbit, hover lift+glow). Estética de grade com bordas 1px e bento grid.
// IMPORTANTE: template string — não usar crase nem ${ } dentro do HTML.
module.exports = `<!DOCTYPE html>
<html lang="pt" class="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0a0a0b" />
<title>ROI-NADOS — Automação e monitoramento para TikTok Ads | PC Digital Ltda</title>
<meta name="description" content="Plataforma da PC Digital Ltda para monitorar contas de anúncio do TikTok via Marketing API oficial: saldos, status de contas, pixel server-side (Events API 2.0), webhook de conversões e relatórios em tempo real." />
<link rel="icon" href="/assets/roi-nados-logo.jpg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
:root{
  --bg:#0a0a0b; --panel:#0d0d0f; --card:#101013; --card2:#151518; --hover:#1a1a1e;
  --border:rgba(255,255,255,.08); --border2:rgba(255,255,255,.16);
  --text:#f2f2f5; --muted:#9d9da8; --muted2:#63636b;
  --cyan:#52a8ff; --pink:#ff5674; --green:#3ecf8e; --amber:#f5b544;
  --radius:10px;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
html{background:var(--bg);scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
h1,h2,h3{margin:0;letter-spacing:-.02em;font-weight:700}
p{margin:0}
a{color:inherit;text-decoration:none}
::-webkit-scrollbar{width:10px}
::-webkit-scrollbar-thumb{background:#2a2a30;border-radius:8px}
::-webkit-scrollbar-track{background:transparent}
.mono{font-family:'Geist Mono',monospace}
::selection{background:rgba(82,168,255,.28)}

/* ── Moldura de grade (estética de linhas 1px, estilo bento) ── */
.frame{max-width:1120px;margin:0 auto;border-left:1px solid var(--border);border-right:1px solid var(--border)}
.wrap{padding:0 40px}
@media (max-width:720px){.wrap{padding:0 22px}}

/* ── Header ── */
header{position:sticky;top:0;z-index:40;background:rgba(10,10,11,.82);backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
.hd{display:flex;align-items:center;gap:14px;padding:11px 24px;max-width:1120px;margin:0 auto}
.logo-orbit{position:relative;width:42px;height:42px;flex-shrink:0}
.logo-orbit img{position:absolute;inset:4px;width:34px;height:34px;border-radius:50%;object-fit:cover;z-index:2;
  box-shadow:0 0 0 2px rgba(255,255,255,.14),0 4px 18px rgba(0,0,0,.6);
  filter:contrast(1.18) saturate(1.25) brightness(1.08)}
.logo-ring{position:absolute;inset:0;border-radius:50%;padding:2px;z-index:1;
  background:conic-gradient(from var(--ra,0deg),#ff2d6f,#52a8ff,#25f4ee,#ff2d6f);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;
  animation:ringSpin 5s linear infinite;
  filter:drop-shadow(0 0 8px rgba(255,45,111,.55))}
@property --ra{syntax:'<angle>';initial-value:0deg;inherits:false}
@keyframes ringSpin{to{--ra:360deg}}
.brand{font-weight:800;font-size:18px;letter-spacing:.04em;white-space:nowrap;
  background:linear-gradient(92deg,#ff3d7a 0%,#ff6b8a 28%,#6cb4ff 62%,#3ffcf6 100%);
  background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
  animation:brandShift 6s ease-in-out infinite alternate}
@keyframes brandShift{0%{background-position:0% 0}100%{background-position:100% 0}}
.hd nav{display:flex;gap:26px;margin-left:26px;font-size:13.5px;font-weight:500;color:var(--muted)}
.hd nav a{transition:color .15s}
.hd nav a:hover{color:var(--text)}
@media (max-width:820px){.hd nav{display:none}}
.hd .spacer{flex:1}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--card);border:1px solid var(--border2);color:var(--text);border-radius:9px;padding:9px 18px;font-family:inherit;font-weight:600;font-size:14px;cursor:pointer;transition:background .15s,transform .15s,border-color .15s}
.btn:hover{background:var(--hover);transform:translateY(-1px)}
.btn.primary{background:var(--text);color:#0a0a0b;border-color:transparent}
.btn.primary:hover{background:#fff}
.btn.accent{background:var(--cyan);color:#04121a;border-color:transparent}
.btn.accent:hover{filter:brightness(1.1)}
.btn svg{width:15px;height:15px}

/* ── Hero (duas colunas: manifesto + mock do painel) ── */
.hero{position:relative;overflow:hidden;border-bottom:1px solid var(--border)}
.hero-glow{position:absolute;inset:0;pointer-events:none;
  background:
    radial-gradient(640px 300px at 8% -10%, rgba(255,86,116,.10), transparent 65%),
    radial-gradient(700px 340px at 92% 110%, rgba(82,168,255,.10), transparent 65%)}
.hero-grid{position:relative;display:grid;grid-template-columns:1.05fr .95fr;gap:44px;align-items:center;padding:76px 40px 72px}
@media (max-width:920px){.hero-grid{grid-template-columns:1fr;padding:56px 22px 54px}}
.hero .tag{display:inline-flex;align-items:center;gap:8px;font-family:'Geist Mono',monospace;font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);background:var(--card);border:1px solid var(--border);padding:6px 14px;border-radius:20px;width:fit-content}
.hero .tag .dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s ease-in-out infinite}
@keyframes pulse{50%{opacity:.35}}
.hero-copy{display:flex;flex-direction:column;gap:20px}
.hero h1{font-size:clamp(36px,4.8vw,58px);line-height:1.04;font-weight:800;letter-spacing:-.035em;text-wrap:balance}
.hero h1 .gx{background:linear-gradient(92deg,#ff3d7a,#6cb4ff 60%,#3ffcf6);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero .sub{font-size:clamp(15px,1.8vw,17px);color:var(--muted);max-width:480px;text-wrap:pretty;line-height:1.65}
.hero-ctas{display:flex;gap:12px;flex-wrap:wrap;margin-top:4px}
.hero-ctas .btn{padding:12px 24px;font-size:14.5px;border-radius:10px}

/* mock do painel — cartão “vitrine” do produto */
.mock{position:relative;background:var(--panel);border:1px solid var(--border2);border-radius:14px;overflow:hidden;
  box-shadow:0 30px 80px -20px rgba(0,0,0,.7),0 0 40px -18px rgba(82,168,255,.25)}
.mock-bar{display:flex;align-items:center;gap:7px;padding:11px 14px;border-bottom:1px solid var(--border);background:var(--card)}
.mock-bar i{width:9px;height:9px;border-radius:50%;background:#2c2c31;display:block}
.mock-bar i:first-child{background:rgba(255,86,116,.55)}
.mock-bar i:nth-child(2){background:rgba(245,181,68,.5)}
.mock-bar i:nth-child(3){background:rgba(62,207,142,.5)}
.mock-bar span{font-family:'Geist Mono',monospace;font-size:11px;color:var(--muted2);margin-left:6px}
.mock-body{padding:16px;display:flex;flex-direction:column;gap:12px}
.mock-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.mk{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 13px;display:flex;flex-direction:column;gap:3px}
.mk small{font-size:10.5px;color:var(--muted2);text-transform:uppercase;letter-spacing:.07em;font-weight:600}
.mk b{font-family:'Geist Mono',monospace;font-size:17px;font-weight:700}
.mk .up{color:var(--green);font-size:10.5px;font-family:'Geist Mono',monospace}
.mock-chart{position:relative;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:13px;height:120px}
.mock-chart small{font-size:10.5px;color:var(--muted2);text-transform:uppercase;letter-spacing:.07em;font-weight:600}
.mock-chart svg{position:absolute;inset:32px 13px 10px;width:calc(100% - 26px);height:calc(100% - 42px)}
.mock-feed{display:flex;flex-direction:column;gap:7px}
.mf{display:flex;align-items:center;gap:9px;background:var(--card);border:1px solid var(--border);border-radius:9px;padding:8px 11px;font-size:11.5px;color:var(--muted)}
.mf i{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.mf b{color:var(--text);font-weight:600}
.mf .mono{font-size:10.5px;color:var(--muted2);margin-left:auto}
@media (max-width:520px){.mock-kpis{grid-template-columns:repeat(2,1fr)}.mock-kpis .mk:last-child{display:none}}

/* ── Banda de estatísticas (células com borda, estilo grade) ── */
.statband{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--border)}
.sb{padding:26px 24px;border-right:1px solid var(--border);display:flex;flex-direction:column;gap:4px}
.sb:last-child{border-right:0}
.sb b{font-family:'Geist Mono',monospace;font-size:19px;font-weight:700;letter-spacing:-.01em}
.sb span{font-size:12.5px;color:var(--muted2)}
@media (max-width:820px){.statband{grid-template-columns:repeat(2,1fr)}.sb:nth-child(2n){border-right:0}.sb:nth-child(-n+2){border-bottom:1px solid var(--border)}}

/* ── Seções ── */
section{padding:78px 0;border-bottom:1px solid var(--border)}
section:last-of-type{border-bottom:0}
.sec-head{display:flex;flex-direction:column;gap:10px;margin-bottom:42px;max-width:640px}
.sec-head .kicker{font-family:'Geist Mono',monospace;font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:var(--cyan)}
.sec-head.pink .kicker{color:var(--pink)}
.sec-head.green .kicker{color:var(--green)}
.sec-head h2{font-size:clamp(26px,3.4vw,36px);letter-spacing:-.028em;text-wrap:balance}
.sec-head p{font-size:15px;color:var(--muted);text-wrap:pretty;line-height:1.65}

/* ── Bento grid de recursos ── */
.bento{display:grid;grid-template-columns:repeat(6,1fr);gap:14px}
.bcard{--glow:rgba(82,168,255,.35);grid-column:span 2;position:relative;overflow:hidden;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:24px;display:flex;flex-direction:column;gap:12px;transition:transform .2s,box-shadow .2s,border-color .2s}
.bcard:hover{transform:translateY(-3px);border-color:var(--border2);box-shadow:0 12px 34px rgba(0,0,0,.45),0 0 26px -10px var(--glow)}
.bcard.w3{grid-column:span 3}
.bcard.pink{--glow:rgba(255,86,116,.4)}
.bcard.green{--glow:rgba(62,207,142,.35)}
.bcard.amber{--glow:rgba(245,181,68,.35)}
.bcard::after{content:'';position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .25s;
  background:radial-gradient(320px 140px at 85% -10%, var(--glow), transparent 70%)}
.bcard:hover::after{opacity:.18}
@media (max-width:920px){.bcard,.bcard.w3{grid-column:span 3}}
@media (max-width:640px){.bcard,.bcard.w3{grid-column:span 6}}
.f-ico{width:40px;height:40px;border-radius:10px;display:grid;place-items:center;background:var(--card2);box-shadow:inset 0 0 0 1px var(--border)}
.f-ico svg{width:19px;height:19px;color:var(--cyan)}
.bcard.pink .f-ico svg{color:var(--pink)}
.bcard.green .f-ico svg{color:var(--green)}
.bcard.amber .f-ico svg{color:var(--amber)}
.bcard h3{font-size:16.5px;letter-spacing:-.015em}
.bcard p{font-size:13.5px;color:var(--muted);text-wrap:pretty;line-height:1.6}
.bcard code{font-family:'Geist Mono',monospace;font-size:12px;color:var(--cyan);background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:2px 7px;word-break:break-all}

/* ── Como funciona (passos com trilho numérico) ── */
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
@media (max-width:820px){.steps{grid-template-columns:1fr}}
.step{position:relative;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:26px 24px 24px;display:flex;flex-direction:column;gap:11px;transition:transform .2s,box-shadow .2s,border-color .2s}
.step:hover{transform:translateY(-3px);border-color:var(--border2);box-shadow:0 12px 34px rgba(0,0,0,.45),0 0 26px -10px rgba(82,168,255,.35)}
.step .n{font-family:'Geist Mono',monospace;font-size:12px;font-weight:700;color:var(--cyan);background:rgba(82,168,255,.1);border:1px solid rgba(82,168,255,.25);width:fit-content;padding:3px 11px;border-radius:20px;letter-spacing:.08em}
.step h3{font-size:16px;letter-spacing:-.015em}
.step p{font-size:13.5px;color:var(--muted);text-wrap:pretty;line-height:1.6}
.step code{font-family:'Geist Mono',monospace;font-size:12px;color:var(--cyan);background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:2px 7px;word-break:break-all}

/* ── Seção API TikTok (painel de conformidade) ── */
.api-panel{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
@media (max-width:920px){.api-panel{grid-template-columns:1fr}}
.scopes{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px}
.scope{font-family:'Geist Mono',monospace;font-size:11.5px;font-weight:600;color:var(--text);background:var(--card2);border:1px solid var(--border2);border-radius:20px;padding:4px 12px;display:inline-flex;align-items:center;gap:7px}
.scope i{width:6px;height:6px;border-radius:50%;background:var(--green);display:block}

/* ── Contato ── */
.contact-inner{display:flex;align-items:center;justify-content:space-between;gap:28px;flex-wrap:wrap}
.contact-inner .sec-head{margin-bottom:0}

/* ── CTA final ── */
.cta-inner{position:relative;overflow:hidden;background:var(--card);border:1px solid var(--border2);border-radius:18px;padding:56px 32px;display:flex;flex-direction:column;align-items:center;gap:18px;text-align:center;margin:0 40px}
@media (max-width:720px){.cta-inner{margin:0 22px;padding:44px 22px}}
.cta-inner::before{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(440px 200px at 18% 0%, rgba(255,86,116,.12), transparent 65%),radial-gradient(440px 200px at 82% 100%, rgba(82,168,255,.12), transparent 65%)}
.cta-inner h2{position:relative;font-size:clamp(24px,3.2vw,32px);letter-spacing:-.028em;text-wrap:balance}
.cta-inner p{position:relative;color:var(--muted);max-width:520px;text-wrap:pretty}
.cta-inner .btn{position:relative}

/* ── Rodapé ── */
footer{border-top:1px solid var(--border);background:var(--panel)}
.ft{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;max-width:1120px;margin:0 auto;padding:36px 40px 44px;border-left:1px solid var(--border);border-right:1px solid var(--border)}
@media (max-width:720px){.ft{padding:30px 22px 38px}}
.ft .brand{font-size:15px}
.ft .spacer{flex:1}
.ft p{font-size:12.5px;color:var(--muted2)}
.ft nav a{transition:color .15s}
.ft nav a:hover{color:var(--text)}

/* ── Revelação ao rolar — só com JS ativo (html.js); sem JS tudo visível ── */
html.js .reveal{opacity:0;transform:translateY(20px);transition:opacity .6s cubic-bezier(.2,.8,.2,1),transform .6s cubic-bezier(.2,.8,.2,1)}
html.js .reveal.in{opacity:1;transform:none}

@media (max-width:640px){
  section{padding:56px 0}
}
</style>
</head>
<body>

<header>
  <div class="hd">
    <div class="logo-orbit"><span class="logo-ring"></span><img src="/assets/roi-nados-logo.jpg" alt="Logo ROI-NADOS" width="34" height="34" decoding="async" /></div>
    <span class="brand">ROI-NADOS</span>
    <nav aria-label="Navega&ccedil;&atilde;o principal">
      <a href="#recursos">Recursos</a>
      <a href="#como-funciona">Como funciona</a>
      <a href="#api-tiktok">Marketing API</a>
      <a href="#contato">Contato</a>
    </nav>
    <span class="spacer"></span>
    <a class="btn primary" href="/dashboard">Acessar painel
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </a>
  </div>
</header>

<main>
  <div class="frame">

    <div class="hero">
      <div class="hero-glow"></div>
      <div class="hero-grid">
        <div class="hero-copy">
          <span class="tag"><span class="dot"></span>Opera&ccedil;&atilde;o ao vivo &middot; TikTok Ads</span>
          <h1>Rastreie cada venda.<br /><span class="gx">Escale com dados reais.</span></h1>
          <p class="sub">Pixel server-side, webhook universal de convers&otilde;es, links de checkout com teste A/B e monitoramento oficial via TikTok Marketing API — tudo num painel s&oacute;.</p>
          <div class="hero-ctas">
            <a class="btn accent" href="/dashboard">Abrir o painel</a>
            <a class="btn" href="#recursos">Explorar recursos</a>
          </div>
        </div>

        <div class="mock reveal" aria-hidden="true">
          <div class="mock-bar"><i></i><i></i><i></i><span>roi-nados.top/dashboard</span></div>
          <div class="mock-body">
            <div class="mock-kpis">
              <div class="mk"><small>Receita</small><b>&euro; 12.480</b><span class="up">&#9650; 18%</span></div>
              <div class="mk"><small>Vendas</small><b>342</b><span class="up">&#9650; 11%</span></div>
              <div class="mk"><small>Convers&atilde;o</small><b>4,7%</b><span class="up">&#9650; 0,6 pp</span></div>
            </div>
            <div class="mock-chart">
              <small>Convers&otilde;es &middot; 7 dias</small>
              <svg viewBox="0 0 300 78" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="mg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#52a8ff" stop-opacity=".35"/>
                    <stop offset="1" stop-color="#52a8ff" stop-opacity="0"/>
                  </linearGradient>
                </defs>
                <path d="M0 62 L40 55 L80 58 L120 40 L160 44 L200 26 L240 30 L280 12 L300 16 L300 78 L0 78 Z" fill="url(#mg)"/>
                <path d="M0 62 L40 55 L80 58 L120 40 L160 44 L200 26 L240 30 L280 12 L300 16" fill="none" stroke="#52a8ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="mock-feed">
              <div class="mf"><i style="background:var(--green)"></i><b>Venda aprovada</b> &middot; &euro; 49,90 &middot; Lisboa, PT<span class="mono">agora</span></div>
              <div class="mf"><i style="background:var(--cyan)"></i><b>Checkout iniciado</b> &middot; Madri, ES<span class="mono">12s</span></div>
              <div class="mf"><i style="background:var(--pink)"></i><b>InitiateCheckout &rarr; CAPI</b> &middot; pixel disparado<span class="mono">40s</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="statband" role="list">
      <div class="sb" role="listitem"><b>Marketing API</b><span>Integra&ccedil;&atilde;o oficial TikTok</span></div>
      <div class="sb" role="listitem"><b>Events API 2.0</b><span>Pixel server-side</span></div>
      <div class="sb" role="listitem"><b>Qualquer gateway</b><span>Webhook universal</span></div>
      <div class="sb" role="listitem"><b>Tempo real</b><span>Radar de vendas ao vivo</span></div>
    </div>

    <section id="recursos">
      <div class="wrap">
        <div class="sec-head reveal">
          <span class="kicker">Recursos</span>
          <h2>Tudo o que o seu funil de TikTok Ads precisa</h2>
          <p>Do primeiro clique no an&uacute;ncio at&eacute; a venda aprovada no gateway — sem perder nenhum sinal no caminho.</p>
        </div>
        <div class="bento">
          <div class="bcard w3 reveal">
            <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div>
            <h3>Pixel TikTok server-side</h3>
            <p>Eventos disparados direto do servidor via Events API 2.0, com deduplica&ccedil;&atilde;o autom&aacute;tica e o m&aacute;ximo de sinal de identidade — cobre at&eacute; quem bloqueia JavaScript. E-mails e telefones s&atilde;o sempre hasheados em SHA-256 antes do envio.</p>
          </div>
          <div class="bcard w3 pink reveal">
            <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div>
            <h3>Webhook universal de convers&otilde;es</h3>
            <p>Conecte qualquer gateway de pagamento com uma &uacute;nica URL. O payload &eacute; normalizado automaticamente e cada status vira o evento certo no TikTok.</p>
            <p><code>POST /api/conversion?secret=&bull;&bull;&bull;</code></p>
          </div>
          <div class="bcard green reveal">
            <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 20V10M12 20V4M6 20v-6"/></svg></div>
            <h3>Links de checkout A/B</h3>
            <p>Links rastreados que dividem o tr&aacute;fego entre checkouts por peso. Cliques, convers&otilde;es e receita por variante.</p>
          </div>
          <div class="bcard amber reveal">
            <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg></div>
            <h3>Radar de vendas ao vivo</h3>
            <p>Globo 3D em tempo real: visitantes, checkouts em andamento e vendas pingando por pa&iacute;s e cidade.</p>
          </div>
          <div class="bcard reveal">
            <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>
            <h3>Notifica&ccedil;&otilde;es no celular</h3>
            <p>Venda, recusa, reembolso ou disputa — chega via Pushcut no segundo em que acontece.</p>
          </div>
          <div class="bcard pink w3 reveal">
            <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg></div>
            <h3>Funil e m&eacute;tricas por per&iacute;odo</h3>
            <p>Visita &rarr; Checkout &rarr; Compra com taxas de convers&atilde;o, aprova&ccedil;&atilde;o, ticket m&eacute;dio e ranking de pa&iacute;ses. Filtre por hoje, 7 dias, 30 dias ou calend&aacute;rio.</p>
          </div>
          <div class="bcard green w3 reveal">
            <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 20h10M12 18v2"/></svg></div>
            <h3>Monitoramento de contas TikTok</h3>
            <p>Saldos, status e informa&ccedil;&otilde;es das contas de an&uacute;ncio do nosso Business Center, consultados pela Marketing API oficial com autoriza&ccedil;&atilde;o OAuth 2.0.</p>
          </div>
        </div>
      </div>
    </section>

    <section id="como-funciona" style="background:var(--panel)">
      <div class="wrap">
        <div class="sec-head pink reveal">
          <span class="kicker">Como funciona</span>
          <h2>Do zero ao rastreamento completo em 3 passos</h2>
          <p>Sem instalar nada no seu site de vendas. Toda a automa&ccedil;&atilde;o roda no nosso servidor.</p>
        </div>
        <div class="steps">
          <div class="step reveal">
            <span class="n">PASSO 01</span>
            <h3>Conecte o seu pixel</h3>
            <p>Cole o c&oacute;digo do pixel e o access token do TikTok Ads no painel. Os eventos server-side come&ccedil;am a disparar na hora, com deduplica&ccedil;&atilde;o autom&aacute;tica.</p>
          </div>
          <div class="step reveal">
            <span class="n">PASSO 02</span>
            <h3>Aponte o webhook do gateway</h3>
            <p>Configure a URL universal no seu gateway de pagamento:</p>
            <p><code>/api/conversion?secret=&bull;&bull;&bull;</code></p>
            <p>Cada venda, recusa ou reembolso vira evento no TikTok e m&eacute;trica no painel.</p>
          </div>
          <div class="step reveal">
            <span class="n">PASSO 03</span>
            <h3>Acompanhe e escale</h3>
            <p>Crie links de checkout com teste A/B, acompanhe o radar ao vivo e receba notifica&ccedil;&otilde;es de cada venda no celular. Decida com dados, n&atilde;o com achismo.</p>
          </div>
        </div>
      </div>
    </section>

    <section id="api-tiktok">
      <div class="wrap">
        <div class="sec-head green reveal">
          <span class="kicker">Integra&ccedil;&atilde;o oficial</span>
          <h2>Conectado &agrave; TikTok Marketing API</h2>
          <p>O ROI-NADOS &eacute; a ferramenta interna da PC Digital Ltda para monitorar as contas de an&uacute;ncio conectadas ao nosso Business Center — com transpar&ecirc;ncia e gest&atilde;o simplificada.</p>
          <div class="scopes" aria-label="Escopos autorizados">
            <span class="scope"><i></i>Ad Account Management</span>
            <span class="scope"><i></i>Ads Management</span>
            <span class="scope"><i></i>OAuth 2.0</span>
          </div>
        </div>
        <div class="api-panel">
          <div class="bcard reveal" style="grid-column:auto">
            <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 20h10M12 18v2"/></svg></div>
            <h3>Monitoramento de contas de an&uacute;ncio</h3>
            <p>Consultamos saldos, status das contas e informa&ccedil;&otilde;es b&aacute;sicas do neg&oacute;cio pela TikTok Marketing API, usando os escopos oficiais de Ad Account Management e Ads Management.</p>
          </div>
          <div class="bcard green reveal" style="grid-column:auto">
            <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/></svg></div>
            <h3>Autoriza&ccedil;&atilde;o segura via OAuth 2.0</h3>
            <p>O acesso &agrave;s contas &eacute; concedido pelo fluxo oficial de OAuth do TikTok for Business. Nenhuma senha &eacute; armazenada e a autoriza&ccedil;&atilde;o pode ser revogada a qualquer momento.</p>
            <p><code>roi-nados.top/api/tiktok/oauth/callback</code></p>
          </div>
          <div class="bcard amber reveal" style="grid-column:auto">
            <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg></div>
            <h3>Uso interno e transparente</h3>
            <p>A plataforma &eacute; de uso exclusivo da equipe da PC Digital Ltda. Os dados obtidos pela API servem apenas para acompanhar as nossas pr&oacute;prias contas — nada &eacute; vendido ou compartilhado com terceiros.</p>
          </div>
        </div>
      </div>
    </section>

    <section id="contato" style="background:var(--panel);padding:56px 0">
      <div class="wrap">
        <div class="contact-inner">
          <div class="sec-head reveal">
            <span class="kicker">Contato</span>
            <h2>Fale com a nossa equipe</h2>
            <p>D&uacute;vidas sobre a plataforma, a integra&ccedil;&atilde;o com o TikTok for Business ou o tratamento de dados? Escreva para a gente.</p>
          </div>
          <a class="btn reveal" href="mailto:contact@roi-nados.top" style="padding:13px 24px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>
            contact@roi-nados.top
          </a>
        </div>
      </div>
    </section>

    <section>
      <div class="cta-inner reveal">
        <h2>Pronto para parar de perder convers&otilde;es?</h2>
        <p>Acesse o painel e veja o seu funil de TikTok Ads com a clareza que ele merece.</p>
        <a class="btn accent" href="/dashboard">Acessar painel
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </a>
      </div>
    </section>

  </div>
</main>

<footer>
  <div class="ft">
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="logo-orbit" style="width:34px;height:34px"><span class="logo-ring"></span><img src="/assets/roi-nados-logo.jpg" alt="" width="28" height="28" loading="lazy" decoding="async" style="inset:3px;width:28px;height:28px" /></div>
        <span class="brand">ROI-NADOS</span>
      </div>
      <p>Operado por <strong style="color:var(--muted)">PC Digital Ltda</strong> &middot; <a href="mailto:contact@roi-nados.top" style="color:var(--cyan)">contact@roi-nados.top</a></p>
      <p>&copy; 2026 ROI-NADOS — Automa&ccedil;&atilde;o e monitoramento para TikTok Ads. Todos os direitos reservados.</p>
    </div>
    <span class="spacer"></span>
    <nav aria-label="Links legais" style="display:flex;flex-direction:column;gap:8px;font-size:13px">
      <a href="/privacidade" style="color:var(--muted)">Pol&iacute;tica de Privacidade</a>
      <a href="/termos" style="color:var(--muted)">Termos de Servi&ccedil;o</a>
      <a href="#api-tiktok" style="color:var(--muted)">Integra&ccedil;&atilde;o TikTok Marketing API</a>
      <a href="#contato" style="color:var(--muted)">Contato</a>
    </nav>
  </div>
</footer>

<script>
// revelação ao rolar (mesma convenção da dashboard)
(function () {
  document.documentElement.classList.add('js');
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });
})();
</script>

</body>
</html>`;
