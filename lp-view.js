// Landing Page do SaaS ROI-NADOS — servida como HTML estático em /.
// Replica a identidade visual da dashboard (dark, Inter/Geist Mono, gradiente
// pink→cyan, logo orbit). IMPORTANTE: template string — não usar crase nem ${ }.
module.exports = `<!DOCTYPE html>
<html lang="pt" class="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0a0a0b" />
<title>ROI-NADOS — Automação e rastreamento para TikTok Ads</title>
<meta name="description" content="Pixel server-side (Events API 2.0), webhook universal de conversões, links de checkout com teste A/B e radar de vendas ao vivo. Automação 100% focada em TikTok Ads." />
<link rel="icon" href="/assets/roi-nados-logo.jpg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
:root{
  --bg:#0a0a0b; --panel:#0e0e10; --card:#101013; --card2:#161619; --hover:#1b1b1f;
  --border:rgba(255,255,255,.07); --border2:rgba(255,255,255,.13);
  --text:#ededf0; --muted:#9d9da8; --muted2:#68686f;
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

.wrap{max-width:1120px;margin:0 auto;padding:0 24px}

/* ── Header ── */
header{position:sticky;top:0;z-index:40;background:rgba(10,10,11,.85);backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
.hd{display:flex;align-items:center;gap:14px;padding:12px 24px;max-width:1120px;margin:0 auto}
.logo-orbit{position:relative;width:46px;height:46px;flex-shrink:0}
.logo-orbit img{position:absolute;inset:4px;width:38px;height:38px;border-radius:50%;object-fit:cover;z-index:2;
  box-shadow:0 0 0 2px rgba(255,255,255,.14),0 4px 18px rgba(0,0,0,.6);
  filter:contrast(1.18) saturate(1.25) brightness(1.08)}
.logo-ring{position:absolute;inset:0;border-radius:50%;padding:2px;z-index:1;
  background:conic-gradient(from var(--ra,0deg),#ff2d6f,#52a8ff,#25f4ee,#ff2d6f);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;
  animation:ringSpin 5s linear infinite;
  filter:drop-shadow(0 0 8px rgba(255,45,111,.6))}
@property --ra{syntax:'<angle>';initial-value:0deg;inherits:false}
@keyframes ringSpin{to{--ra:360deg}}
.brand{font-weight:800;font-size:19px;letter-spacing:.04em;
  background:linear-gradient(92deg,#ff3d7a 0%,#ff6b8a 28%,#6cb4ff 62%,#3ffcf6 100%);
  background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
  animation:brandShift 6s ease-in-out infinite alternate}
@keyframes brandShift{0%{background-position:0% 0}100%{background-position:100% 0}}
.hd .spacer{flex:1}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:10px 18px;font-family:inherit;font-weight:600;font-size:14px;cursor:pointer;transition:.15s}
.btn:hover{background:var(--hover);transform:translateY(-2px)}
.btn.primary{background:var(--cyan);color:#04121a;border-color:transparent}
.btn.primary:hover{filter:brightness(1.08)}
.btn svg{width:16px;height:16px}

/* ── Hero ── */
.hero{position:relative;overflow:hidden;border-bottom:1px solid var(--border);
  background:linear-gradient(180deg,#101014 0%,var(--bg) 100%)}
.hero-glow{position:absolute;inset:-30% -10% auto;height:170%;pointer-events:none;
  background:
    radial-gradient(520px 260px at 15% 30%, rgba(255,86,116,.16), transparent 65%),
    radial-gradient(560px 280px at 55% 8%, rgba(82,168,255,.13), transparent 65%),
    radial-gradient(380px 200px at 85% 45%, rgba(62,207,142,.07), transparent 70%);
  animation:hhFloat 12s ease-in-out infinite alternate}
@keyframes hhFloat{0%{transform:translateX(-2%) translateY(0)}100%{transform:translateX(2%) translateY(4%)}}
.hero-inner{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;gap:22px;padding:84px 24px 90px;max-width:860px;margin:0 auto}
.hero .tag{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:var(--muted);background:var(--card);border:1px solid var(--border);padding:7px 16px;border-radius:20px}
.hero .tag .dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s ease-in-out infinite}
@keyframes pulse{50%{opacity:.4}}
.hero h1{font-size:clamp(34px,5.5vw,56px);line-height:1.08;font-weight:800;letter-spacing:-.03em;text-wrap:balance}
.hero h1 .gx{background:linear-gradient(92deg,#ff3d7a,#6cb4ff 60%,#3ffcf6);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero .sub{font-size:clamp(15px,2vw,18px);color:var(--muted);max-width:620px;text-wrap:pretty}
.hero-ctas{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}
.hero-ctas .btn{padding:13px 26px;font-size:15px;border-radius:12px}
.hero-stats{display:flex;gap:34px;flex-wrap:wrap;justify-content:center;margin-top:14px}
.hs{display:flex;flex-direction:column;gap:2px;align-items:center}
.hs b{font-family:'Geist Mono',monospace;font-size:22px;font-weight:700;color:var(--text)}
.hs span{font-size:12px;color:var(--muted2)}

/* ── Seções ── */
section{padding:74px 0}
.sec-head{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;margin-bottom:44px}
.sec-head .kicker{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--cyan)}
.sec-head h2{font-size:clamp(26px,3.6vw,36px);letter-spacing:-.025em;text-wrap:balance}
.sec-head p{font-size:15px;color:var(--muted);max-width:560px;text-wrap:pretty}

/* cards de recursos — hover único: lift + glow (convenção da dash) */
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}
.fcard{--glow:rgba(82,168,255,.35);position:relative;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:24px;display:flex;flex-direction:column;gap:12px;transition:transform .2s,box-shadow .2s,border-color .2s}
.fcard:hover{transform:translateY(-3px);border-color:var(--border2);box-shadow:0 12px 34px rgba(0,0,0,.45),0 0 26px -10px var(--glow)}
.fcard.pink{--glow:rgba(255,86,116,.4)}
.fcard.green{--glow:rgba(62,207,142,.35)}
.fcard.amber{--glow:rgba(245,181,68,.35)}
.f-ico{width:42px;height:42px;border-radius:11px;display:grid;place-items:center;background:var(--card2);box-shadow:inset 0 0 0 1px var(--border)}
.f-ico svg{width:20px;height:20px;color:var(--cyan)}
.fcard.pink .f-ico svg{color:var(--pink)}
.fcard.green .f-ico svg{color:var(--green)}
.fcard.amber .f-ico svg{color:var(--amber)}
.fcard h3{font-size:16.5px}
.fcard p{font-size:13.5px;color:var(--muted);text-wrap:pretty}

/* como funciona */
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;counter-reset:step}
.step{position:relative;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:26px 24px 24px;display:flex;flex-direction:column;gap:10px;transition:transform .2s,box-shadow .2s,border-color .2s}
.step:hover{transform:translateY(-3px);border-color:var(--border2);box-shadow:0 12px 34px rgba(0,0,0,.45),0 0 26px -10px rgba(82,168,255,.35)}
.step .n{font-family:'Geist Mono',monospace;font-size:13px;font-weight:700;color:#04121a;background:var(--cyan);width:30px;height:30px;border-radius:9px;display:grid;place-items:center}
.step h3{font-size:16px}
.step p{font-size:13.5px;color:var(--muted);text-wrap:pretty}
.step code{font-family:'Geist Mono',monospace;font-size:12px;color:var(--cyan);background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:2px 7px;word-break:break-all}

/* CTA final */
.cta-band{margin:0 24px}
.cta-inner{position:relative;overflow:hidden;max-width:1072px;margin:0 auto;background:var(--card);border:1px solid var(--border2);border-radius:18px;padding:54px 30px;display:flex;flex-direction:column;align-items:center;gap:18px;text-align:center}
.cta-inner::before{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(420px 200px at 20% 0%, rgba(255,86,116,.12), transparent 65%),radial-gradient(420px 200px at 80% 100%, rgba(82,168,255,.12), transparent 65%)}
.cta-inner h2{position:relative;font-size:clamp(24px,3.4vw,32px);text-wrap:balance}
.cta-inner p{position:relative;color:var(--muted);max-width:520px;text-wrap:pretty}
.cta-inner .btn{position:relative}

/* rodapé */
footer{border-top:1px solid var(--border);padding:30px 0 40px}
.ft{display:flex;align-items:center;gap:14px;flex-wrap:wrap;max-width:1120px;margin:0 auto;padding:0 24px}
.ft .brand{font-size:15px}
.ft .spacer{flex:1}
.ft p{font-size:12.5px;color:var(--muted2)}

/* revelação ao rolar */
.reveal{opacity:0;transform:translateY(22px);transition:opacity .6s cubic-bezier(.2,.8,.2,1),transform .6s cubic-bezier(.2,.8,.2,1)}
.reveal.in{opacity:1;transform:none}

@media (max-width:640px){
  .hero-inner{padding:60px 20px 66px}
  section{padding:56px 0}
  .hero-stats{gap:22px}
}
</style>
</head>
<body>

<header>
  <div class="hd">
    <div class="logo-orbit"><span class="logo-ring"></span><img src="/assets/roi-nados-logo.jpg" alt="Logo ROI-NADOS" /></div>
    <span class="brand">ROI-NADOS</span>
    <span class="spacer"></span>
    <a class="btn primary" href="/dashboard">Acessar painel
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </a>
  </div>
</header>

<main>
  <div class="hero">
    <div class="hero-glow"></div>
    <div class="hero-inner">
      <span class="tag"><span class="dot"></span>Automação 100% focada em TikTok Ads</span>
      <h1>Rastreie cada venda.<br /><span class="gx">Escale com dados reais.</span></h1>
      <p class="sub">Pixel server-side, webhook universal de conversões e links de checkout com teste A/B — tudo num painel só, feito para quem anuncia no TikTok.</p>
      <div class="hero-ctas">
        <a class="btn primary" href="/dashboard">Abrir o painel</a>
        <a class="btn" href="#recursos">Ver recursos</a>
      </div>
      <div class="hero-stats">
        <div class="hs"><b>Events API 2.0</b><span>Pixel server-side</span></div>
        <div class="hs"><b>Qualquer gateway</b><span>Webhook universal</span></div>
        <div class="hs"><b>Tempo real</b><span>Radar de vendas</span></div>
      </div>
    </div>
  </div>

  <section id="recursos">
    <div class="wrap">
      <div class="sec-head reveal">
        <span class="kicker">Recursos</span>
        <h2>Tudo o que o seu funil de TikTok Ads precisa</h2>
        <p>Do primeiro clique no anúncio até a venda aprovada no gateway — sem perder nenhum sinal no caminho.</p>
      </div>
      <div class="features">
        <div class="fcard reveal">
          <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div>
          <h3>Pixel TikTok server-side</h3>
          <p>Eventos disparados direto do servidor via Events API 2.0, com deduplicação automática e o máximo de sinal de identidade — cobre até quem bloqueia JavaScript.</p>
        </div>
        <div class="fcard pink reveal">
          <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div>
          <h3>Webhook universal de conversões</h3>
          <p>Conecte qualquer gateway de pagamento com uma única URL. O payload é normalizado automaticamente e cada status vira o evento certo no TikTok.</p>
        </div>
        <div class="fcard green reveal">
          <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 20V10M12 20V4M6 20v-6"/></svg></div>
          <h3>Links de checkout com teste A/B</h3>
          <p>Crie links rastreados que dividem o tráfego entre checkouts externos por peso. Cliques, conversões e receita por variante, direto no painel.</p>
        </div>
        <div class="fcard amber reveal">
          <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg></div>
          <h3>Radar de vendas ao vivo</h3>
          <p>Globo 3D com a atividade em tempo real: visitantes navegando, checkouts em andamento e vendas pingando por país, cidade e campanha.</p>
        </div>
        <div class="fcard reveal">
          <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>
          <h3>Notificações em tempo real</h3>
          <p>Venda aprovada, pagamento recusado, reembolso ou disputa — receba tudo no celular via Pushcut, no segundo em que acontece.</p>
        </div>
        <div class="fcard pink reveal">
          <div class="f-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg></div>
          <h3>Funil e métricas por período</h3>
          <p>Visita → Checkout → Compra com taxas de conversão, aprovação, ticket médio e ranking de países. Filtre por hoje, 7 dias, 30 dias ou calendário.</p>
        </div>
      </div>
    </div>
  </section>

  <section id="como-funciona" style="background:var(--panel);border-top:1px solid var(--border);border-bottom:1px solid var(--border)">
    <div class="wrap">
      <div class="sec-head reveal">
        <span class="kicker">Como funciona</span>
        <h2>Do zero ao rastreamento completo em 3 passos</h2>
        <p>Sem instalar nada no seu site de vendas. Toda a automação roda no nosso servidor.</p>
      </div>
      <div class="steps">
        <div class="step reveal">
          <span class="n">1</span>
          <h3>Conecte o seu pixel</h3>
          <p>Cole o código do pixel e o access token do TikTok Ads no painel. Os eventos server-side começam a disparar na hora, com deduplicação automática.</p>
        </div>
        <div class="step reveal">
          <span class="n">2</span>
          <h3>Aponte o webhook do gateway</h3>
          <p>Configure a URL universal no seu gateway de pagamento:</p>
          <p><code>/api/conversion?secret=•••</code></p>
          <p>Cada venda, recusa ou reembolso vira evento no TikTok e métrica no painel.</p>
        </div>
        <div class="step reveal">
          <span class="n">3</span>
          <h3>Acompanhe e escale</h3>
          <p>Crie links de checkout com teste A/B, acompanhe o radar ao vivo e receba notificações de cada venda no celular. Decida com dados, não com achismo.</p>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="cta-band reveal">
      <div class="cta-inner">
        <h2>Pronto para parar de perder conversões?</h2>
        <p>Acesse o painel e veja o seu funil de TikTok Ads com a clareza que ele merece.</p>
        <a class="btn primary" href="/dashboard">Acessar painel
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </a>
      </div>
    </div>
  </section>
</main>

<footer>
  <div class="ft">
    <div class="logo-orbit" style="width:34px;height:34px"><span class="logo-ring"></span><img src="/assets/roi-nados-logo.jpg" alt="" style="inset:3px;width:28px;height:28px" /></div>
    <span class="brand">ROI-NADOS</span>
    <span class="spacer"></span>
    <p>&copy; 2026 ROI-NADOS — Automação para TikTok Ads. Todos os direitos reservados.</p>
  </div>
</footer>

<script>
// revelação ao rolar (mesma convenção da dashboard)
(function () {
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
