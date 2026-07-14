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

  // ── vid estável (URL ?vid= > localStorage > novo) ──
  // O ?vid= da URL vence: é como o encurtador /l/ e páginas de outros
  // domínios "passam o bastão" da identidade — o lead não vira dois ids.
  function newVid(){ return 'ld_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
  var VID_OK = /^ld_[a-z0-9]{6,30}$/i;
  var vid = null;
  try { var uvid = new URLSearchParams(location.search).get('vid'); if (uvid && VID_OK.test(uvid)) vid = uvid; } catch(_){}
  if (!vid) { try { vid = localStorage.getItem('roinados_vid'); } catch(_){} }
  if (!vid || !VID_OK.test(vid)) vid = newVid();
  try { localStorage.setItem('roinados_vid', vid); } catch(_){}

  // ── external_id (EMQ): MESMO hash do servidor → SHA-256('lead:'+vid).
  // Liga o ViewContent do NAVEGADOR ao evento server-side (CAPI) e às
  // conversões da mesma pessoa (o servidor usa hash('lead:'+vid) idêntico).
  // Sem crypto.subtle (contexto inseguro/browser antigo) NÃO enviamos nada:
  // um external_id malformado derruba o Event Match Quality mais do que a
  // simples ausência. extIdReady libera o disparo assim que o hash resolve (~1ms).
  var extIdHash = null, extIdReady = false;
  (function(){
    try {
      if (!(window.crypto && window.crypto.subtle && window.TextEncoder)) { extIdReady = true; return; }
      var data = new TextEncoder().encode(('lead:' + vid).toLowerCase());
      window.crypto.subtle.digest('SHA-256', data).then(function(buf){
        var b = new Uint8Array(buf), h = '';
        for (var i=0;i<b.length;i++) h += (b[i] < 16 ? '0' : '') + b[i].toString(16);
        extIdHash = h; extIdReady = true;
      }).catch(function(){ extIdReady = true; });
    } catch(_){ extIdReady = true; }
  })();

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
      if (!extIdReady) return false;                 // aguarda o hash (~1ms) p/ enviar external_id junto do ViewContent
      if (window.ttq && typeof window.ttq.track === 'function') {
        // external_id ANTES do track: o ttq aplica a identidade aos eventos
        // seguintes. Mesmo hash do servidor → dedup browser+CAPI com identidade.
        if (extIdHash && typeof window.ttq.identify === 'function') {
          try { window.ttq.identify({ external_id: extIdHash }); } catch(_){}
        }
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

  // ── 2b. cliques em elementos marcados: <button data-track="btn-comprar">
  // Vira passo "click:nome" na jornada do lead — revela se o problema é a
  // página (ninguém clica) ou a oferta (clicam e não compram).
  var lastClickSent = {};
  document.addEventListener('click', function(e){
    try {
      var el = e.target && e.target.closest ? e.target.closest('[data-track]') : null;
      if (!el) return;
      var name = (el.getAttribute('data-track')||'').slice(0,60);
      if (!name) return;
      var now = Date.now();
      if (lastClickSent[name] && now - lastClickSent[name] < 2000) return; // anti clique duplo
      lastClickSent[name] = now;
      send('/api/track', { vid: vid, click: name });
    } catch(_){}
  }, true);

  // ── 2c. Advanced Matching: email/telefone digitados em QUALQUER formulário
  // da página (opt-in, checkout embutido, captura de lead) são enviados ao
  // servidor e amarrados ao lead — todos os disparos CAPI seguintes carregam
  // email+phone hasheados, os sinais que mais sobem a nota de correspondência.
  var amSent = { email: null, phone: null };
  function captureField(el){
    try {
      if (!el || el.tagName !== 'INPUT' || !el.value) return;
      var v = String(el.value).trim();
      if (!v) return;
      var type = (el.getAttribute('type')||'').toLowerCase();
      var hint = ((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('autocomplete')||'')+' '+(el.getAttribute('placeholder')||'')).toLowerCase();
      if (type === 'email' || /e-?mail/.test(hint)) {
        if (v.indexOf('@') > 0 && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(v) && v.toLowerCase() !== amSent.email) {
          amSent.email = v.toLowerCase();
          send('/api/track', { vid: vid, email: v });
        }
      } else if (type === 'tel' || /phone|telefone|celular|whats|mobile|movel/.test(hint)) {
        var digits = v.replace(/[^0-9]/g, '');
        if (digits.length >= 8 && digits.length <= 15 && digits !== amSent.phone) {
          amSent.phone = digits;
          send('/api/track', { vid: vid, phone: v });
        }
      }
    } catch(_){}
  }
  document.addEventListener('change', function(e){ captureField(e.target); }, true);
  document.addEventListener('focusout', function(e){ captureField(e.target); }, true);
  // rede de segurança: ao sair da página, varre campos preenchidos não enviados
  window.addEventListener('pagehide', function(){
    try {
      var els = document.querySelectorAll('input[type=email],input[type=tel],input[name*="mail"],input[name*="phone"],input[name*="tel"]');
      for (var i=0;i<els.length;i++) captureField(els[i]);
    } catch(_){}
  });

  // ── 3. presença ao vivo (heartbeat 20s + saída) ──
  function pulse(){ send('/api/pulse', { vid: vid, page: location.pathname, referrer: payload.referrer }); }
  pulse();
  var iv = setInterval(pulse, 20000);
  window.addEventListener('pagehide', function(){
    clearInterval(iv);
    send('/api/pulse/leave', { vid: vid });
  });
})();`;
