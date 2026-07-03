// ─────────────────────────────────────────────────────────────────────
// Snippet universal de rastreamento (servido em GET /t.js)
// Qualquer página EXTERNA (presell, VSL, arquivo hospedado em outro
// domínio) inclui:  <script src="https://SEU-DOMINIO/t.js" defer></script>
//
// O que ele faz, sem depender de cookie cross-site:
//   1. Gera/recupera um vid estável no localStorage (mesmo formato ld_*)
//   2. Captura ttclid (URL), _ttp (cookie do pixel TikTok), UTMs, referrer
//   3. POST /api/track → registra o lead no funil + ViewContent via CAPI
//   4. Decora TODOS os links para /go/ com vid+ttclid+utms → o clique no
//      checkout é atribuído ao MESMO lead (costura de identidade)
//   5. Heartbeat de presença (aparece no "Ao Vivo" da dashboard)
// ─────────────────────────────────────────────────────────────────────
'use strict';

module.exports = `(function(){
  if (window.__roinadosLoaded) return; window.__roinadosLoaded = 1;
  var API = (function(){
    // origem do próprio script: <script src="https://dominio/t.js">
    var s = document.currentScript || (function(){ var a=document.getElementsByTagName('script'); return a[a.length-1]; })();
    try { return new URL(s.src).origin; } catch(_) { return ''; }
  })();
  if (!API) return;

  // ── vid estável (localStorage > cookie 1st-party > novo) ──
  function newVid(){ return 'ld_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
  var vid = null;
  try { vid = localStorage.getItem('roinados_vid'); } catch(_){}
  if (!vid || !/^ld_[a-z0-9]{6,30}$/i.test(vid)) {
    vid = newVid();
    try { localStorage.setItem('roinados_vid', vid); } catch(_){}
  }

  // ── sinais de identidade ──
  function qs(name){ try { return new URLSearchParams(location.search).get(name); } catch(_){ return null; } }
  function ck(name){ var m=document.cookie.match(new RegExp('(?:^|; )'+name+'=([^;]*)')); return m?decodeURIComponent(m[1]):null; }
  var ttclid = qs('ttclid') || null;
  // persiste o ttclid da primeira visita (o lead pode navegar entre páginas)
  try {
    if (ttclid) localStorage.setItem('roinados_ttclid', ttclid);
    else ttclid = localStorage.getItem('roinados_ttclid') || null;
  } catch(_){}
  function buildPayload(){
    return {
      vid: vid,
      url: location.href.slice(0,500),
      title: (document.title||'').slice(0,200),
      referrer: (document.referrer||'').slice(0,300),
      ttclid: ttclid,
      ttp: ck('_ttp') || null,
      utm: {
        source: qs('utm_source'), medium: qs('utm_medium'),
        campaign: qs('utm_campaign'), content: qs('utm_content'), term: qs('utm_term')
      }
    };
  }
  var payload = buildPayload();

  // ── 1. registra visita + ViewContent (CAPI, dedup por hora no servidor) ──
  // text/plain = "simple request" CORS: sem preflight e sendBeacon
  // cross-origin funciona em todos os browsers (application/json é bloqueado)
  function send(path, body){
    var data = JSON.stringify(body);
    try {
      var blob = new Blob([data], {type:'text/plain;charset=UTF-8'});
      if (navigator.sendBeacon && navigator.sendBeacon(API+path, blob)) return;
    } catch(_){}
    try { fetch(API+path, {method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8'}, body: data, keepalive:true}).catch(function(){}); } catch(_){}
  }
  send('/api/track', payload);

  // ── 1a. dedup com o pixel do navegador: se a página TAMBÉM tiver o pixel
  // JS do TikTok (ttq), dispara o ViewContent com o MESMO event_id que o
  // servidor usa ('ViewContent.vid.horaUTC') — o TikTok deduplica sozinho
  // e o evento não conta dobrado (browser + CAPI).
  function utcHourKey(){ return new Date().toISOString().slice(0,13).replace(/[-T]/g,''); }
  function fireBrowserPixel(){
    try {
      if (window.ttq && typeof window.ttq.track === 'function') {
        window.ttq.track('ViewContent', {}, { event_id: 'ViewContent.' + vid + '.' + utcHourKey() });
        return true;
      }
    } catch(_){}
    return false;
  }
  // ttq pode carregar depois de nós: tenta já + re-tenta por até 6s
  if (!fireBrowserPixel()) {
    var ttqTries = 0;
    var ttqIv = setInterval(function(){
      if (fireBrowserPixel() || ++ttqTries >= 12) clearInterval(ttqIv);
    }, 500);
  }

  // ── 1b. SPA: cada troca de "página" (pushState/replaceState/popstate)
  // re-registra a visita → a jornada do lead fica completa mesmo em
  // sites de página única. Dedup no servidor protege a CAPI.
  var lastPath = location.pathname + location.search;
  function onNav(){
    var now = location.pathname + location.search;
    if (now === lastPath) return;
    lastPath = now;
    payload = buildPayload();
    send('/api/track', payload);
    fireBrowserPixel(); // mesmo event_id → TikTok deduplica com a CAPI
  }
  try {
    var _push = history.pushState, _repl = history.replaceState;
    history.pushState = function(){ _push.apply(this, arguments); onNav(); };
    history.replaceState = function(){ _repl.apply(this, arguments); onNav(); };
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', onNav);
  } catch(_){}

  // ── 2. decora links de checkout (/go/) com vid + sinais ──
  // O cookie não cruza domínios; o vid na URL garante que o clique no /go/
  // seja atribuído ao MESMO lead que viu esta página.
  function decorate(root){
    var links = (root||document).querySelectorAll('a[href*="/go/"]');
    for (var i=0;i<links.length;i++){
      try {
        var u = new URL(links[i].href, location.href);
        if (u.origin !== API) continue;              // só decora links do nosso servidor
        if (u.searchParams.get('vid')) continue;      // já decorado
        u.searchParams.set('vid', vid);
        if (payload.ttclid) u.searchParams.set('ttclid', payload.ttclid);
        ['source','medium','campaign','content','term'].forEach(function(k){
          if (payload.utm[k]) u.searchParams.set('utm_'+k, payload.utm[k]);
        });
        links[i].href = u.toString();
      } catch(_){}
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ decorate(); });
  else decorate();
  // links adicionados dinamicamente (frameworks, lazy render)
  try {
    new MutationObserver(function(){ decorate(); }).observe(document.documentElement, {childList:true, subtree:true});
  } catch(_){}
  // rede de segurança: decora NA HORA do clique (captura), cobrindo links
  // criados/trocados depois do observer — inclusive clique com botão do meio
  function clickGuard(e){
    try {
      var a = e.target && e.target.closest ? e.target.closest('a[href*="/go/"]') : null;
      if (!a) return;
      var u = new URL(a.href, location.href);
      if (u.origin !== API || u.searchParams.get('vid')) return;
      u.searchParams.set('vid', vid);
      if (payload.ttclid) u.searchParams.set('ttclid', payload.ttclid);
      a.href = u.toString();
    } catch(_){}
  }
  document.addEventListener('click', clickGuard, true);
  document.addEventListener('auxclick', clickGuard, true);

  // ── 3. presença ao vivo (heartbeat 20s + saída) ──
  function pulse(){ send('/api/pulse', { vid: vid, page: location.pathname, referrer: payload.referrer }); }
  pulse();
  var iv = setInterval(pulse, 20000);
  window.addEventListener('pagehide', function(){
    clearInterval(iv);
    send('/api/pulse/leave', { vid: vid });
  });
})();`;
