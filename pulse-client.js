// Script injetado em todas as páginas do funil. Envia um "heartbeat" leve para
// o servidor saber quem está navegando AGORA (aba "Ao Vivo" da dashboard).
const PULSE_SCRIPT = `<script>(function(){
  try{
    var HB=12000; // 12s
    function ping(){
      try{
        fetch('/api/pulse',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},
          body:JSON.stringify({page:location.pathname+location.search,referrer:document.referrer||null})}).catch(function(){});
      }catch(e){}
    }
    function leave(){
      try{
        if(navigator.sendBeacon){navigator.sendBeacon('/api/pulse/leave');}
        else{fetch('/api/pulse/leave',{method:'POST',keepalive:true}).catch(function(){});}
      }catch(e){}
    }
    ping();
    var t=setInterval(function(){ if(document.visibilityState==='visible') ping(); },HB);
    document.addEventListener('visibilitychange',function(){ if(document.visibilityState==='visible') ping(); });
    window.addEventListener('pagehide',leave);
    window.addEventListener('beforeunload',leave);
  }catch(e){}
})();</script>`;

// Injeta o script antes de </body> (ou no fim, se não houver).
function injectPulse(html) {
  if (typeof html !== 'string') return html;
  if (html.indexOf('/api/pulse') !== -1) return html; // já injetado
  if (html.indexOf('</body>') !== -1) return html.replace('</body>', PULSE_SCRIPT + '</body>');
  return html + PULSE_SCRIPT;
}

module.exports = { PULSE_SCRIPT, injectPulse };
