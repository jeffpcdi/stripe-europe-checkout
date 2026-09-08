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
    Purchase: events.CompletePayment !== false && events.Purchase !== false,
  };

  // O script calcula vid/event_id no navegador, não no request do JS. Isso é
  // essencial em páginas externas onde cookies third-party não chegam ao
  // servidor. Também torna o corpo cacheável sem misturar visitantes.
  return `(function(){
  var TOKEN=${JSON.stringify(String(token || ''))}, CODE=${JSON.stringify(code)}, ENABLED=${JSON.stringify(enabled)};
  var script=document.currentScript||(function(){var a=document.getElementsByTagName('script');return a[a.length-1];})();
  var API='';try{API=new URL(script.src).origin}catch(_){return}
  var CONSENT=String(script.getAttribute&&script.getAttribute('data-consent')||'granted').toLowerCase();
  window.__roiNadosPixels=window.__roiNadosPixels||{};
  if(window.__roiNadosPixels[TOKEN])return;

  if(!window.ttq){${TTQ_STUB}}
  var ttq=window.ttq;
  var volatileStorage=window.__roinadosVolatileStorage=window.__roinadosVolatileStorage||{};
  function lsGet(k){try{return localStorage.getItem(k)||volatileStorage[k]||null}catch(_){return volatileStorage[k]||null}}
  function lsSet(k,v){volatileStorage[k]=v;try{localStorage.setItem(k,v);return true}catch(_){return false}}
  var consentGranted=CONSENT!=='required'||lsGet('roinados_consent')==='granted';
  if(!consentGranted){try{ttq.holdConsent()}catch(_){}}
  if(!(ttq._i&&ttq._i[CODE]))ttq.load(CODE);
  var instance=typeof ttq.instance==='function'?ttq.instance(CODE):ttq;
  window.__roiNadosPixels[TOKEN]={code:CODE,instance:instance,consentGranted:consentGranted};

  function qs(n){try{return new URLSearchParams(location.search).get(n)}catch(_){return null}}
  function ck(n){var m=document.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?decodeURIComponent(m[1]):null}
  function newVid(){return 'ld_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
  var VID_OK=/^ld_[a-z0-9]{6,30}$/i,vid=qs('vid');
  if(!vid||!VID_OK.test(vid))vid=lsGet('roinados_vid');
  if(!vid||!VID_OK.test(vid))vid=newVid();
  lsSet('roinados_vid',vid);
  var ttclid=qs('ttclid')||lsGet('roinados_ttclid')||ck('ttclid')||null;
  if(ttclid)lsSet('roinados_ttclid',ttclid);
  function route(){return(location.pathname||'/')+(location.search||'')+(location.hash||'')}
  function routeKey(){var s=route(),h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
  function pageEventId(){
    var now=Date.now(),r=route(),shared=window.__roinadosNavigationEvent;
    if(shared&&shared.route===r&&now-shared.at<10000)return shared.id;
    var id='ViewContent.'+vid+'.'+now.toString(36)+'.'+routeKey()+'.'+Math.random().toString(36).slice(2,7);
    window.__roinadosNavigationEvent={id:id,route:r,at:now};return id
  }
  function eventId(name){
    return name==='ViewContent'
      ? pageEventId()
      : name+'.'+vid+'.'+Date.now().toString(36)+'.'+Math.random().toString(36).slice(2,8)
  }
  function purchaseEventId(orderId){
    var safe=String(orderId==null?'':orderId).trim().replace(/[^A-Za-z0-9._:-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,90);
    return safe?'Purchase.'+safe:null
  }
  function cleanProps(p){
    p=p&&typeof p==='object'?p:{};var out={};
    ['content_id','content_name','content_category','content_type','currency','description','query'].forEach(function(k){if(p[k]!=null)out[k]=String(p[k]).slice(0,100)});
    ['value','price','quantity'].forEach(function(k){if(p[k]==null||p[k]==='')return;var n=Number(p[k]);if(isFinite(n)&&n>=0)out[k]=n});
    if(Array.isArray(p.contents))out.contents=p.contents.slice(0,20).map(function(row){
      row=row&&typeof row==='object'?row:{};var item={};
      ['content_id','content_name','content_category','content_type'].forEach(function(k){if(row[k]!=null)item[k]=String(row[k]).slice(0,100)});
      ['price','quantity'].forEach(function(k){var n=Number(row[k]);if(isFinite(n)&&n>=0)item[k]=n});return item
    }).filter(function(row){return Object.keys(row).length>0});
    return out;
  }
  function meta(name,property){
    try{if(!document.querySelector)return null;var el=document.querySelector('meta['+(property?'property':'name')+'="'+name+'"]');return el&&el.getAttribute('content')}catch(_){return null}
  }
  function pageProps(){
    var id=meta('product:retailer_item_id',true)||meta('product:sku',true)||meta('sku',false);
    var name=meta('og:title',true)||(document.title||'');
    var raw=meta('product:price:amount',true)||meta('product:price',true),value=Number(raw);
    var cur=meta('product:price:currency',true);
    var out={content_name:name.slice(0,100)};
    if(id)out.content_id=String(id).slice(0,100);
    if(raw!=null&&raw!==''&&isFinite(value)&&value>=0){out.value=value;out.price=value;out.content_type='product'}
    if(cur)out.currency=String(cur).toUpperCase().slice(0,3);
    return out
  }
  function hashExternal(done){
    try{if(!(crypto&&crypto.subtle&&window.TextEncoder))return done(null);
      crypto.subtle.digest('SHA-256',new TextEncoder().encode(('lead:'+vid).toLowerCase())).then(function(buf){
        var b=new Uint8Array(buf),h='';for(var i=0;i<b.length;i++)h+=(b[i]<16?'0':'')+b[i].toString(16);done(h)
      }).catch(function(){done(null)})
    }catch(_){done(null)}
  }
  var OUTBOX='roinados_px_outbox_'+TOKEN.slice(-16),MAX_AGE=172800000;
  function readOutbox(){try{var rows=JSON.parse(lsGet(OUTBOX)||'[]'),now=Date.now();return Array.isArray(rows)?rows.filter(function(r){return r&&r.key&&now-r.at<MAX_AGE}).slice(-40):[]}catch(_){return[]}}
  function writeOutbox(rows){try{lsSet(OUTBOX,JSON.stringify(rows.slice(-40)))}catch(_){}}
  function enqueue(body,key){var rows=readOutbox();if(!rows.some(function(r){return r.key===key}))rows.push({key:key,at:Date.now(),body:body});writeOutbox(rows);return{key:key,at:Date.now(),body:body}}
  function delivered(key){writeOutbox(readOutbox().filter(function(r){return r.key!==key}))}
  function deliver(row,preferBeacon){
    if(!row||!consentGranted)return;
    var raw=JSON.stringify(row.body);
    if(preferBeacon){try{var blob=new Blob([raw],{type:'text/plain;charset=UTF-8'});if(navigator.sendBeacon&&navigator.sendBeacon(API+'/api/px/event',blob))return}catch(_){}}
    if(typeof fetch!=='function')return;
    try{fetch(API+'/api/px/event',{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:raw,keepalive:true}).then(function(resp){if(resp&&resp.ok!==false)delivered(row.key)}).catch(function(){})}catch(_){}
  }
  function flush(){if(!consentGranted||navigator.onLine===false)return;readOutbox().forEach(function(row){deliver(row,false)})}
  function post(body,key,preferBeacon){var row=enqueue(body,key);deliver(row,!!preferBeacon)}
  function transient(body){
    if(!consentGranted||typeof fetch!=='function')return;
    try{fetch(API+'/api/px/event',{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(body),keepalive:true}).catch(function(){})}catch(_){}
  }
  function beacon(name,id,props){
    var body={px:TOKEN,vid:vid,events:[{n:name,id:id,time:Math.floor(Date.now()/1000),properties:props}],url:location.href.slice(0,500),title:(document.title||'').slice(0,200),referrer:(document.referrer||'').slice(0,300),ttclid:ttclid,ttp:ck('_ttp')||null};
    post(body,id,false)
  }
  function signals(extra){
    extra=extra&&typeof extra==='object'?extra:{};var ttp=ck('_ttp')||null;
    if(!ttp&&!ttclid&&!extra.email&&!extra.phone)return;
    var body={px:TOKEN,vid:vid,events:[],signalsOnly:true,url:location.href.slice(0,500),ttclid:ttclid,ttp:ttp,email:extra.email||undefined,phone:extra.phone||undefined};
    // Identidade não vai para localStorage: envia em trânsito e o backend
    // persiste apenas no lead da conta, aplicando hash antes da Events API.
    transient(body)
  }
  function track(name,properties,customId){
    name=name==='CompletePayment'?'Purchase':String(name||'');
    if(!consentGranted||!ENABLED[name]||!/^(ViewContent|AddToCart|InitiateCheckout|Purchase)$/.test(name))return false;
    var raw=properties&&typeof properties==='object'?properties:{};
    var props=cleanProps(raw),id=customId||raw.event_id||raw.eventId;
    if(name==='Purchase'){
      id=id||purchaseEventId(raw.order_id||raw.orderId||raw.transaction_id||raw.transactionId);
      var value=Number(props.value),currency=String(props.currency||'').toUpperCase();
      if(!id||!/^[A-Za-z0-9._:-]{8,120}$/.test(String(id))||!isFinite(value)||value<0||!/^[A-Z]{3}$/.test(currency))return false;
      props.value=value;props.currency=currency;
      var purchaseKey='roinados_purchase_'+TOKEN.slice(-16),seen=[];
      try{seen=JSON.parse(lsGet(purchaseKey)||'[]');if(!Array.isArray(seen))seen=[]}catch(_){seen=[]}
      if(seen.indexOf(String(id))!==-1)return true;
      seen.push(String(id));lsSet(purchaseKey,JSON.stringify(seen.slice(-50)));
      hashExternal(function(externalId){
        try{if(externalId&&typeof instance.identify==='function')instance.identify({external_id:externalId});instance.track('Purchase',props,{event_id:String(id)})}catch(_){}
      });
      signals({email:raw.email,phone:raw.phone});
      try{window.dispatchEvent(new CustomEvent('roinados:purchase',{detail:{px:TOKEN,eventId:String(id)}}))}catch(_){}
      return true
    }
    id=id||eventId(name);
    hashExternal(function(externalId){
      try{if(externalId&&typeof instance.identify==='function')instance.identify({external_id:externalId});instance.track(name,props,{event_id:id})}catch(_){}
    });
    beacon(name,id,props);return true;
  }
  window.__roiNadosPixels[TOKEN].track=track;
  window.__roiNadosPixels[TOKEN].identify=signals;
  if(consentGranted){flush();try{instance.page()}catch(_){}track('ViewContent',pageProps())}

  // API pública explícita: o token torna impossível enviar sem querer ao pixel
  // vizinho. Ex.: RoiNadosPixel.track('px_abc','AddToCart',{content_id:'sku-1'}).
  window.RoiNadosPixel=window.RoiNadosPixel||{};
  window.RoiNadosPixel.track=function(target,name,props,id){
    var row=window.__roiNadosPixels&&window.__roiNadosPixels[target];
    if(!row||typeof row.track!=='function')return false;
    return row.track(String(name||''),props,id)
  };
  window.RoiNadosPixel.purchase=function(target,data,id){
    var row=window.__roiNadosPixels&&window.__roiNadosPixels[target];
    if(!row||typeof row.track!=='function')return false;
    return row.track('Purchase',data,id)
  };
  window.RoiNadosPixel.identify=function(target,data){
    var tokens=Object.keys(window.__roiNadosPixels||{});
    if(target&&typeof target==='object'){data=target;target=tokens.length===1?tokens[0]:null}
    var row=target&&window.__roiNadosPixels&&window.__roiNadosPixels[target];
    if(!row||typeof row.identify!=='function')return false;
    data=data&&typeof data==='object'?data:{};row.identify({email:data.email,phone:data.phone});return true
  };
  window.RoiNadosPixel.getVisitorId=function(){return vid};
  window.RoiNadosPixel.consent=function(value){
    var granted=value===true||value==='grant'||value==='granted';lsSet('roinados_consent',granted?'granted':'revoked');
    try{window.dispatchEvent(new CustomEvent('roinados:consent',{detail:{granted:granted}}))}catch(_){}return granted
  };

  // Alternativa sem código: marque um elemento com data-tiktok-event (ou data-event,
  // data-tt-event, data-checkout) e os parâmetros data-value/data-currency.
  // Links diretos para plataformas de checkout (Kiwify, Hotmart, PerfectPay, etc.)
  // disparam InitiateCheckout automaticamente quando há 1 pixel na página.
  document.addEventListener('click',function(e){
    try{
      var el=e.target&&e.target.closest?e.target.closest('[data-tiktok-event],[data-event],[data-tt-event],[data-checkout]'):null;
      if(el){
        var name=el.getAttribute('data-tiktok-event')||el.getAttribute('data-event')||el.getAttribute('data-tt-event')||(el.hasAttribute('data-checkout')?'InitiateCheckout':'');
        if(!name)return;
        var target=el.getAttribute('data-pixel-token');
        // Em uma página com dois loaders, um botão sem destino é ambíguo: não
        // dispara em ambos. Com um loader apenas, o atalho sem token permanece.
        if(target&&target!==TOKEN)return;
        if(!target&&Object.keys(window.__roiNadosPixels||{}).length>1)return;
        track(name,{
          content_id:el.getAttribute('data-content-id')||el.getAttribute('data-id'),
          content_name:el.getAttribute('data-content-name')||el.getAttribute('data-name'),
          value:el.getAttribute('data-value')||el.getAttribute('data-price'),
          currency:el.getAttribute('data-currency')||el.getAttribute('data-cur')
        });
        return;
      }
      var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;
      if(a&&!a.hasAttribute('data-no-track')&&!a.hasAttribute('data-ignore-pixel')){
        var href=(a.getAttribute('href')||'').toLowerCase();
        var isPayLink=href.indexOf('kiwify')!==-1||href.indexOf('hotmart')!==-1||href.indexOf('eduzz')!==-1||href.indexOf('perfectpay')!==-1||href.indexOf('cakto')!==-1||href.indexOf('ticto')!==-1||href.indexOf('kirvano')!==-1||href.indexOf('monetizze')!==-1||href.indexOf('braip')!==-1||href.indexOf('yampi')!==-1||href.indexOf('cartx')!==-1||href.indexOf('doppus')!==-1||href.indexOf('pepper')!==-1||href.indexOf('/checkout')!==-1||href.indexOf('/pay')!==-1;
        if(isPayLink&&Object.keys(window.__roiNadosPixels||{}).length===1){
          track('InitiateCheckout',{content_name:(a.textContent||'').trim().slice(0,60)||'Checkout'});
        }
      }
    }catch(_){}
  },true);

  // Página de confirmação sem código adicional: um marcador [data-roinados-purchase],
  // [data-purchase] ou [data-order] com pedido, valor e moeda dispara Purchase no
  // Pixel nativo. A venda/receita e a CAPI continuam vindo com 100% de segurança
  // via webhook do gateway para evitar perdas de Pix/Boleto e fraudes.
  function scanPurchases(root){
    try{var rows=[];
      if(root&&root.matches&&root.matches('[data-roinados-purchase],[data-purchase],[data-order]'))rows.push(root);
      if(root&&root.querySelectorAll)rows=rows.concat(Array.prototype.slice.call(root.querySelectorAll('[data-roinados-purchase],[data-purchase],[data-order]')));
      rows.forEach(function(el){
        var target=el.getAttribute('data-pixel-token');
        if(target&&target!==TOKEN)return;
        var loaderCount=0;try{loaderCount=document.querySelectorAll('script[src*="/px/"]').length}catch(_){}
        if(!target&&(loaderCount>1||Object.keys(window.__roiNadosPixels||{}).length>1))return;
        track('Purchase',{
          order_id:el.getAttribute('data-order-id')||el.getAttribute('data-order')||el.getAttribute('data-id'),
          event_id:el.getAttribute('data-event-id'),
          value:el.getAttribute('data-value')||el.getAttribute('data-price')||el.getAttribute('data-amount'),
          currency:el.getAttribute('data-currency')||el.getAttribute('data-cur'),
          content_id:el.getAttribute('data-content-id')||el.getAttribute('data-id'),
          content_name:el.getAttribute('data-content-name')||el.getAttribute('data-name'),
          email:el.getAttribute('data-email'),phone:el.getAttribute('data-phone')
        })
      })
    }catch(_){}
  }
  scanPurchases(document);
  try{new MutationObserver(function(rows){rows.forEach(function(row){Array.prototype.forEach.call(row.addedNodes||[],scanPurchases)})}).observe(document.documentElement,{childList:true,subtree:true})}catch(_){}

  // O tracker universal emite este evento em trocas de rota de SPA. Cada
  // loader responde apenas pelo próprio TOKEN/instance.
  window.addEventListener('roinados:navigation',function(e){
    if(e&&e.detail&&e.detail.px&&e.detail.px!==TOKEN)return;
    track('ViewContent',pageProps(),e&&e.detail&&e.detail.eventId)
  });
  window.addEventListener('roinados:consent',function(e){
    consentGranted=!!(e&&e.detail&&e.detail.granted);window.__roiNadosPixels[TOKEN].consentGranted=consentGranted;
    try{if(consentGranted){instance.grantConsent();flush();instance.page();track('ViewContent',pageProps());scanPurchases(document)}else{instance.revokeConsent();writeOutbox([])}}catch(_){}
  });
  window.addEventListener('online',flush);
  window.addEventListener('pagehide',function(){readOutbox().forEach(function(row){deliver(row,true)})});
  setTimeout(function(){signals({});flush()},1500);
  setTimeout(function(){signals({});flush()},5000);

  // A tag individual é autossuficiente: carrega também o rastreador completo
  // da jornada. Instalações antigas que já possuem /t.js não baixam duplicado.
  if(!window.__roinadosLoaded&&!window.__roinadosTrackerRequested){
    window.__roinadosTrackerRequested=1;
    try{var tracker=document.createElement('script');tracker.src=API+'/t.js?px='+encodeURIComponent(TOKEN);tracker.defer=true;
      ['data-consent','data-advanced-matching','data-link-domains'].forEach(function(k){var v=script.getAttribute&&script.getAttribute(k);if(v!=null)tracker.setAttribute(k,v)});
      (document.head||document.documentElement).appendChild(tracker)
    }catch(_){}
  }
})();`;
}

module.exports = { TTQ_STUB, buildPixelClient };
