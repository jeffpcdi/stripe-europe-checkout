'use strict';

// Código-base oficial do TikTok, mantido em um único módulo para que o loader
// individual e o snippet opcional usem exatamente a mesma implementação.
const TTQ_STUB = '!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)}}(window,document,"ttq");';

function buildPixelClient(pixel, token) {
  const code = String(pixel && pixel.pixelCode || '');
  const events = pixel && pixel.events || {};
  const enabled = {
    ViewContent: events.ViewContent !== false,
    AddToCart: events.AddToCart !== false,
    InitiateCheckout: events.InitiateCheckout !== false,
  };

  // O script calcula vid/event_id no navegador, não no request do JS. Isso é
  // essencial em páginas externas onde cookies third-party não chegam ao
  // servidor. Também torna o corpo cacheável sem misturar visitantes.
  return `(function(){
  var TOKEN=${JSON.stringify(String(token || ''))}, CODE=${JSON.stringify(code)}, ENABLED=${JSON.stringify(enabled)};
  var script=document.currentScript||(function(){var a=document.getElementsByTagName('script');return a[a.length-1];})();
  var API='';try{API=new URL(script.src).origin}catch(_){return}
  window.__roiNadosPixels=window.__roiNadosPixels||{};
  if(window.__roiNadosPixels[TOKEN])return;

  if(!window.ttq){${TTQ_STUB}}
  var ttq=window.ttq;
  if(!(ttq._i&&ttq._i[CODE]))ttq.load(CODE);
  var instance=typeof ttq.instance==='function'?ttq.instance(CODE):ttq;
  window.__roiNadosPixels[TOKEN]={code:CODE,instance:instance};

  function qs(n){try{return new URLSearchParams(location.search).get(n)}catch(_){return null}}
  function ck(n){var m=document.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?decodeURIComponent(m[1]):null}
  function newVid(){return 'ld_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
  var VID_OK=/^ld_[a-z0-9]{6,30}$/i,vid=qs('vid');
  if(!vid||!VID_OK.test(vid)){try{vid=localStorage.getItem('roinados_vid')}catch(_){}}
  if(!vid||!VID_OK.test(vid))vid=newVid();
  try{localStorage.setItem('roinados_vid',vid)}catch(_){}
  function hour(){return new Date().toISOString().slice(0,13).replace(/[-T]/g,'')}
  function routeKey(){var s=(location.pathname||'/')+(location.search||''),h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
  function eventId(name){
    return name==='ViewContent'
      ? name+'.'+vid+'.'+hour()+'.'+routeKey()
      : name+'.'+vid+'.'+Date.now().toString(36)+'.'+Math.random().toString(36).slice(2,8)
  }
  function cleanProps(p){
    p=p&&typeof p==='object'?p:{};var out={};
    ['content_id','content_name','content_category','content_type','currency','description','query'].forEach(function(k){if(p[k]!=null)out[k]=String(p[k]).slice(0,100)});
    ['value','price','quantity'].forEach(function(k){var n=Number(p[k]);if(isFinite(n)&&n>=0)out[k]=n});
    if(Array.isArray(p.contents))out.contents=p.contents.slice(0,20);
    return out;
  }
  function hashExternal(done){
    try{if(!(crypto&&crypto.subtle&&window.TextEncoder))return done(null);
      crypto.subtle.digest('SHA-256',new TextEncoder().encode(('lead:'+vid).toLowerCase())).then(function(buf){
        var b=new Uint8Array(buf),h='';for(var i=0;i<b.length;i++)h+=(b[i]<16?'0':'')+b[i].toString(16);done(h)
      }).catch(function(){done(null)})
    }catch(_){done(null)}
  }
  function beacon(name,id,props){
    var q=new URLSearchParams(location.search),body={px:TOKEN,vid:vid,events:[{n:name,id:id,properties:props}],url:location.href.slice(0,500),ttclid:q.get('ttclid')||ck('ttclid')||null,ttp:ck('_ttp')||null};
    var raw=JSON.stringify(body);
    try{var blob=new Blob([raw],{type:'text/plain;charset=UTF-8'});if(navigator.sendBeacon&&navigator.sendBeacon(API+'/api/px/event',blob))return}catch(_){}
    try{fetch(API+'/api/px/event',{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:raw,keepalive:true}).catch(function(){})}catch(_){}
  }
  function track(name,properties,customId){
    if(!ENABLED[name]||!/^(ViewContent|AddToCart|InitiateCheckout)$/.test(name))return false;
    var props=cleanProps(properties),id=customId||eventId(name);
    hashExternal(function(externalId){
      try{if(externalId&&typeof instance.identify==='function')instance.identify({external_id:externalId});instance.track(name,props,{event_id:id})}catch(_){}
    });
    beacon(name,id,props);return true;
  }
  window.__roiNadosPixels[TOKEN].track=track;
  try{instance.page()}catch(_){}
  track('ViewContent',{});

  // API pública explícita: o token torna impossível enviar sem querer ao pixel
  // vizinho. Ex.: RoiNadosPixel.track('px_abc','AddToCart',{content_id:'sku-1'}).
  window.RoiNadosPixel=window.RoiNadosPixel||{};
  window.RoiNadosPixel.track=function(target,name,props,id){
    var row=window.__roiNadosPixels&&window.__roiNadosPixels[target];
    if(!row||typeof row.track!=='function')return false;
    return row.track(String(name||''),props,id)
  };

  // Alternativa sem código: marque um elemento com data-tiktok-event e os
  // parâmetros data-content-id/data-content-name/data-value/data-currency.
  document.addEventListener('click',function(e){
    try{var el=e.target&&e.target.closest?e.target.closest('[data-tiktok-event]'):null;if(!el)return;
      var name=el.getAttribute('data-tiktok-event')||'';
      var target=el.getAttribute('data-pixel-token');
      // Em uma página com dois loaders, um botão sem destino é ambíguo: não
      // dispara em ambos. Com um loader apenas, o atalho sem token permanece.
      if(target&&target!==TOKEN)return;
      if(!target&&Object.keys(window.__roiNadosPixels||{}).length>1)return;
      track(name,{content_id:el.getAttribute('data-content-id'),content_name:el.getAttribute('data-content-name'),value:el.getAttribute('data-value'),currency:el.getAttribute('data-currency')})
    }catch(_){}
  },true);

  // O tracker universal emite este evento em trocas de rota de SPA. Cada
  // loader responde apenas pelo próprio TOKEN/instance.
  window.addEventListener('roinados:navigation',function(e){
    if(e&&e.detail&&e.detail.px&&e.detail.px!==TOKEN)return;
    track('ViewContent',{})
  });
})();`;
}

module.exports = { TTQ_STUB, buildPixelClient };
