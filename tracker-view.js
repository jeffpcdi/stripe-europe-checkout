// ─────────────────────────────────────────────────────────────────────
// Snippet universal de rastreamento (servido em GET /t.js)
// Qualquer página EXTERNA (presell, VSL, arquivo hospedado em outro
// domínio) inclui a tag específica exibida no painel:
//   <script src="https://SEU-DOMINIO/t.js?px=TOKEN_DO_PIXEL" defer></script>
//
// O que ele faz, sem depender de cookie cross-site:
//   1. Gera/recupera um vid estável no localStorage (mesmo formato ld_*)
//   2. Captura ttclid (URL), _ttp (cookie do pixel TikTok), UTMs, referrer
//   3. POST /api/track → registra o lead e roteia CAPI só ao pixel da tag
//   4. Decora TODOS os links para /go/ com vid+ttclid+utms → o clique no
//      checkout é atribuído ao MESMO lead (costura de identidade)
//   5. Heartbeat de presença (aparece no "Ao Vivo" da dashboard)
// ─────────────────────────────────────────────────────────────────────
'use strict';

module.exports = `(function(){
  if (window.__roinadosLoaded) return; window.__roinadosLoaded = 1;
  var SCRIPT_EL = document.currentScript || (function(){ var a=document.getElementsByTagName('script'); return a[a.length-1]; })();
  var SCRIPT_URL = (function(){
    // origem/token do próprio script: <script src="https://dominio/t.js?px=...">
    try { return new URL(SCRIPT_EL.src); } catch(_) { return null; }
  })();
  var API = SCRIPT_URL ? SCRIPT_URL.origin : '';
  var PIXEL_TOKEN = SCRIPT_URL ? (SCRIPT_URL.searchParams.get('px') || '').slice(0,64) : '';
  if (!API) return;
  function lsGet(k){ try { return localStorage.getItem(k); } catch(_) { return null; } }
  function lsSet(k,v){ try { localStorage.setItem(k,v); return true; } catch(_) { return false; } }
  var CONSENT_MODE = String(SCRIPT_EL.getAttribute && SCRIPT_EL.getAttribute('data-consent') || 'granted').toLowerCase();
  var consentGranted = CONSENT_MODE !== 'required' || lsGet('roinados_consent') === 'granted';
  var AUTO_MATCH = String(SCRIPT_EL.getAttribute && SCRIPT_EL.getAttribute('data-advanced-matching') || 'on').toLowerCase() !== 'off';
  var LINK_DOMAINS = String(SCRIPT_EL.getAttribute && SCRIPT_EL.getAttribute('data-link-domains') || '')
    .split(',').map(function(v){ return v.trim().toLowerCase().replace(/^www\./,''); }).filter(Boolean);

  // ── vid estável (URL ?vid= > localStorage > novo) ──
  // O ?vid= da URL vence: é como o encurtador /l/ e páginas de outros
  // domínios "passam o bastão" da identidade — o lead não vira dois ids.
  function newVid(){ return 'ld_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
  var VID_OK = /^ld_[a-z0-9]{6,30}$/i;
  var vid = null;
  try { var uvid = new URLSearchParams(location.search).get('vid'); if (uvid && VID_OK.test(uvid)) vid = uvid; } catch(_){}
  if (!vid) vid = lsGet('roinados_vid');
  if (!vid || !VID_OK.test(vid)) vid = newVid();
  lsSet('roinados_vid', vid);

  // ── sinais de identidade ──
  function qs(name){ try { return new URLSearchParams(location.search).get(name); } catch(_){ return null; } }
  function ck(name){ var m=document.cookie.match(new RegExp('(?:^|; )'+name+'=([^;]*)')); return m?decodeURIComponent(m[1]):null; }
  function routeKey(){
    var s=(location.pathname||'/')+(location.search||''),h=2166136261;
    for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
    return (h>>>0).toString(36);
  }
  function currentRoute(){ return (location.pathname||'/') + (location.search||'') + (location.hash||''); }
  function pageEventId(force){
    var now=Date.now(),route=currentRoute(),shared=window.__roinadosNavigationEvent;
    if(!force&&shared&&shared.route===route&&now-shared.at<10000)return shared.id;
    var id='ViewContent.'+vid+'.'+now.toString(36)+'.'+routeKey()+'.'+Math.random().toString(36).slice(2,7);
    window.__roinadosNavigationEvent={id:id,route:route,at:now};return id;
  }
  var ttclid = qs('ttclid') || null;
  // persiste o ttclid da primeira visita (o lead pode navegar entre páginas)
  try {
    if (ttclid) lsSet('roinados_ttclid', ttclid);
    else ttclid = lsGet('roinados_ttclid') || null;
  } catch(_){}
  function campaignValue(name){
    var value=qs('utm_'+name),key='roinados_utm_'+name;
    if(value)lsSet(key,String(value).slice(0,200));else value=lsGet(key);
    return value||null;
  }
  function buildPayload(forceNewEvent){
    return {
      vid: vid,
      px: PIXEL_TOKEN || undefined,
      eventId: pageEventId(!!forceNewEvent),
      url: location.href.slice(0,500),
      title: (document.title||'').slice(0,200),
      referrer: (document.referrer||'').slice(0,300),
      ttclid: ttclid,
      ttp: ck('_ttp') || null,
      utm: {
        source: campaignValue('source'), medium: campaignValue('medium'),
        campaign: campaignValue('campaign'), content: campaignValue('content'), term: campaignValue('term')
      }
    };
  }
  var payload = buildPayload();

  // ── 1. registra visita + ViewContent (mesmo event_id no navegador/CAPI) ──
  // text/plain = "simple request" CORS: sem preflight e sendBeacon
  // cross-origin funciona em todos os browsers (application/json é bloqueado)
  var OUTBOX='roinados_tracker_outbox_'+(PIXEL_TOKEN||'default').slice(-16),MAX_AGE=172800000;
  function readOutbox(){
    try{var rows=JSON.parse(lsGet(OUTBOX)||'[]'),now=Date.now();return Array.isArray(rows)?rows.filter(function(r){return r&&r.key&&now-r.at<MAX_AGE}).slice(-40):[];}catch(_){return[];}
  }
  function writeOutbox(rows){try{lsSet(OUTBOX,JSON.stringify(rows.slice(-40)));}catch(_){}}
  function removeOutbox(key){writeOutbox(readOutbox().filter(function(row){return row.key!==key;}));}
  function send(path, body, durable, preferBeacon){
    if(!consentGranted)return;
    var data = JSON.stringify(body);
    var key=path+'|'+(body.eventId||(body.click?body.click+'.':'')+Date.now().toString(36)+Math.random().toString(36).slice(2,7));
    if(durable){var rows=readOutbox();if(!rows.some(function(row){return row.key===key;})){rows.push({key:key,at:Date.now(),path:path,body:body});writeOutbox(rows);}}
    if(preferBeacon)try {
      var blob = new Blob([data], {type:'text/plain;charset=UTF-8'});
      if (navigator.sendBeacon && navigator.sendBeacon(API+path, blob)) return;
    } catch(_){}
    try { fetch(API+path, {method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8'}, body: data, keepalive:true})
      .then(function(resp){if(durable&&resp&&resp.ok!==false)removeOutbox(key);}).catch(function(){}); } catch(_){}
  }
  function flush(){
    if(!consentGranted||navigator.onLine===false)return;
    readOutbox().forEach(function(row){
      try{fetch(API+row.path,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(row.body),keepalive:true})
        .then(function(resp){if(resp&&resp.ok!==false)removeOutbox(row.key);}).catch(function(){});}catch(_){}
    });
  }
  function syncSignals(){
    var ttp=ck('_ttp')||null;if(!ttp&&!ttclid)return;
    send('/api/track',{vid:vid,px:PIXEL_TOKEN||undefined,signalsOnly:true,ttclid:ttclid,ttp:ttp},false,false);
  }
  if(consentGranted){flush();send('/api/track', payload, true, false);}

  // O disparo no navegador vive no loader /px/TOKEN.js, que usa
  // ttq.instance(PIXEL_CODE). O tracker universal não chama ttq.track global:
  // numa página com mais de um pixel isso enviaria o evento ao destino errado.

  // ── 1b. SPA: cada troca de "página" (pushState/replaceState/popstate)
  // re-registra a visita → a jornada do lead fica completa mesmo em
  // sites de página única. Dedup no servidor protege a CAPI.
  var lastPath = currentRoute();
  function onNav(){
    var now = currentRoute();
    if (now === lastPath) return;
    lastPath = now;
    payload = buildPayload(true);
    send('/api/track', payload, true, false);
    try { window.dispatchEvent(new CustomEvent('roinados:navigation', { detail: { px: PIXEL_TOKEN, eventId: payload.eventId } })); } catch(_){}
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
  function shouldLink(a,u){
    var host=(u.hostname||'').toLowerCase().replace(/^www\./,'');
    if(u.origin===API&&u.pathname.indexOf('/go/')===0)return true;
    if(a&&a.hasAttribute&&a.hasAttribute('data-roinados-link'))return true;
    return LINK_DOMAINS.indexOf(host)!==-1;
  }
  function linkedUrl(raw,a){
    try{
      if(!consentGranted)return null;
      var u=new URL(raw,location.href);if(!shouldLink(a,u))return null;
      if(!u.searchParams.get('vid'))u.searchParams.set('vid',vid);
      if(payload.ttclid&&!u.searchParams.get('ttclid'))u.searchParams.set('ttclid',payload.ttclid);
      ['source','medium','campaign','content','term'].forEach(function(k){if(payload.utm[k]&&!u.searchParams.get('utm_'+k))u.searchParams.set('utm_'+k,payload.utm[k]);});
      return u.toString();
    }catch(_){return null;}
  }
  function decorate(root){
    var links = (root||document).querySelectorAll('a[href]');
    for (var i=0;i<links.length;i++){
      var linked=linkedUrl(links[i].href,links[i]);if(linked)links[i].href=linked;
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
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var linked=linkedUrl(a.href,a);if(linked)a.href=linked;
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
      send('/api/track', { vid: vid, px: PIXEL_TOKEN || undefined, click: name }, true, false);
    } catch(_){}
  }, true);

  // ── 2c. Advanced Matching: email/telefone digitados em QUALQUER formulário
  // da página (opt-in, checkout embutido, captura de lead) são enviados ao
  // servidor e amarrados ao lead — todos os disparos CAPI seguintes carregam
  // email+phone hasheados, os sinais que mais sobem a nota de correspondência.
  var amSent = { email: null, phone: null };
  function captureField(el){
    try {
      if(!consentGranted||!AUTO_MATCH)return;
      if (!el || el.tagName !== 'INPUT' || !el.value) return;
      if(el.closest&&el.closest('[data-roinados-ignore]'))return;
      var v = String(el.value).trim();
      if (!v) return;
      var type = (el.getAttribute('type')||'').toLowerCase();
      var hint = ((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('autocomplete')||'')+' '+(el.getAttribute('placeholder')||'')).toLowerCase();
      if (type === 'email' || /e-?mail/.test(hint)) {
        if (v.indexOf('@') > 0 && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(v) && v.toLowerCase() !== amSent.email) {
          amSent.email = v.toLowerCase();
          send('/api/track', { vid: vid, px: PIXEL_TOKEN || undefined, email: v }, false, false);
        }
      } else if (type === 'tel' || /phone|telefone|celular|whats|mobile|movel/.test(hint)) {
        var digits = v.replace(/[^0-9]/g, '');
        if (digits.length >= 8 && digits.length <= 15 && digits !== amSent.phone) {
          amSent.phone = digits;
          send('/api/track', { vid: vid, px: PIXEL_TOKEN || undefined, phone: v }, false, false);
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
  window.RoiNadosPixel=window.RoiNadosPixel||{};
  window.RoiNadosPixel.identify=function(data){data=data&&typeof data==='object'?data:{};send('/api/track',{vid:vid,px:PIXEL_TOKEN||undefined,email:data.email,phone:data.phone},false,false);return true;};
  window.RoiNadosPixel.getVisitorId=function(){return vid;};
  window.RoiNadosPixel.decorate=function(url){return linkedUrl(url,null)||url;};
  window.RoiNadosPixel.consent=function(value){
    var granted=value===true||value==='grant'||value==='granted';lsSet('roinados_consent',granted?'granted':'revoked');
    try{window.dispatchEvent(new CustomEvent('roinados:consent',{detail:{granted:granted}}));}catch(_){}return granted;
  };
  var iv=null,started=consentGranted;
  function pulse(){ send('/api/pulse', { vid: vid, page: location.pathname, referrer: payload.referrer }, false, false); }
  if(started){pulse();iv=setInterval(pulse,20000);}
  window.addEventListener('online',flush);
  window.addEventListener('roinados:consent',function(e){
    consentGranted=!!(e&&e.detail&&e.detail.granted);
    if(consentGranted&&!started){started=true;payload=buildPayload(true);flush();send('/api/track',payload,true,false);decorate();pulse();iv=setInterval(pulse,20000);syncSignals();}
    if(!consentGranted){started=false;if(iv)clearInterval(iv);iv=null;writeOutbox([]);}
  });
  setTimeout(syncSignals,1500);
  setTimeout(syncSignals,5000);
  window.addEventListener('pagehide', function(){
    if(iv)clearInterval(iv);
    readOutbox().forEach(function(row){send(row.path,row.body,false,true);});
    send('/api/pulse/leave', { vid: vid }, false, true);
  });
})();`;
