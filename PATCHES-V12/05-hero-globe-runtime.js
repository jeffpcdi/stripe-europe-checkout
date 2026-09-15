function heroGlobeZoom(factor){
  if(!globoHero) return;
  try{
    var pov=globoHero.pointOfView();
    var alt=Math.max(0.55,Math.min(3.2,(pov.altitude||1.95)*factor));
    globoHero.pointOfView({lat:pov.lat,lng:pov.lng,altitude:alt},360);
  }catch(_){}
}
function heroGlobeReset(){
  if(!globoHero) return;
  try{ globoHero.pointOfView({lat:24,lng:-12,altitude:1.95},560); }catch(_){}
}
function heroGlobeFullscreen(){
  var frame=document.getElementById('overview-globe-frame'); if(!frame) return;
  try{
    if(document.fullscreenElement){ document.exitFullscreen(); }
    else if(frame.requestFullscreen){ frame.requestFullscreen(); }
  }catch(_){}
}
function sizeHeroGlobe(){
  var el=document.getElementById('globe-hero'); if(!el||!globoHero) return;
  try{ globoHero.width(el.clientWidth).height(el.clientHeight||520); }catch(_){}
}
function wireHeroGlobeTools(){
  var zi=document.getElementById('hero-globe-zoom-in'),zo=document.getElementById('hero-globe-zoom-out'),rs=document.getElementById('hero-globe-reset'),fs=document.getElementById('hero-globe-fs');
  if(zi&&!zi.dataset.wired){zi.dataset.wired='1';zi.onclick=function(){heroGlobeZoom(.76);};}
  if(zo&&!zo.dataset.wired){zo.dataset.wired='1';zo.onclick=function(){heroGlobeZoom(1.32);};}
  if(rs&&!rs.dataset.wired){rs.dataset.wired='1';rs.onclick=heroGlobeReset;}
  if(fs&&!fs.dataset.wired){fs.dataset.wired='1';fs.onclick=heroGlobeFullscreen;}
}
// Globo hero na Visão Geral: mapa operacional, sem aparência de satélite cru.
// Verde representa compras e ciano representa leads que chegaram ao checkout.
function renderGlobeHero(m){
  var el=document.getElementById('globe-hero'), skel=document.getElementById('ov-globe-skel');
  if(!el) return;
  if(typeof Globe==='undefined'){ ensureGlobeLib(function(ok){ if(ok) renderGlobeHero(m); }); return; }
  m=m||metrics();
  var flow={};
  (DATA.leads||[]).forEach(function(l){
    if(l.orphan||!l.country||!inPeriod(l.at)||!GEO[l.country]) return;
    if(!flow[l.country]) flow[l.country]={code:l.country,name:l.countryName||l.country,checkout:0,sales:0};
    if(l.stage==='checkout') flow[l.country].checkout++;
    if(l.stage==='purchased') flow[l.country].sales++;
  });
  var pts=[];
  Object.keys(flow).forEach(function(code){
    var d=flow[code],g=GEO[code];
    if(d.checkout>0) pts.push({lat:g[0]+.18,lng:g[1]-.18,type:'checkout',count:d.checkout,name:d.name,code:code});
    if(d.sales>0) pts.push({lat:g[0]-.18,lng:g[1]+.18,type:'sale',count:d.sales,name:d.name,code:code});
  });
  if(!pts.length){
    ((LIVE.summary&&LIVE.summary.countries)||[]).forEach(function(c){
      if(!GEO[c.code]) return; var g=GEO[c.code];
      pts.push({lat:g[0],lng:g[1],type:'checkout',count:c.count||1,name:c.name,code:c.code});
    });
  }
  var max=1; pts.forEach(function(d){if(d.count>max)max=d.count;});
  pts.forEach(function(d){d.size=Math.max(.22,Math.min(1,d.count/max));});
  try{
    if(!globoHero){
      if(skel)skel.hidden=true; el.hidden=false;
      globoHero=makeGlobe(el,el.clientHeight||520);
      globoHero.pointAltitude(function(d){return 0.018+d.size*0.05;})
        .pointRadius(function(d){return 0.20+d.size*0.30;})
        .pointColor(function(d){return d.type==='sale'?'#22c55e':'#25f4ee';})
        .pointLabel(function(d){
          var c=d.type==='sale'?'#22c55e':'#25f4ee',lbl=d.type==='sale'?'compras':'checkouts';
          return '<div style="background:rgba(7,10,15,.92);border:1px solid rgba(255,255,255,.09);padding:9px 11px;border-radius:10px;font-family:Inter,system-ui,sans-serif;box-shadow:0 14px 34px rgba(0,0,0,.68);backdrop-filter:blur(12px)">'+
            '<div style="font-size:11.5px;color:#fff;font-weight:650">'+flag(d.code)+' '+esc(d.name)+'</div>'+ 
            '<div style="font-size:10.5px;color:#8b93a3;margin-top:4px"><b style="color:'+c+'">'+d.count+'</b> '+lbl+'</div></div>';
        })
        .ringColor(function(d){return function(t){var c=d.type==='sale'?'34,197,94':'37,244,238';return 'rgba('+c+','+((1-t)*.72)+')';};})
        .ringMaxRadius(function(d){return d.type==='sale'?3.8:3.0;})
        .ringPropagationSpeed(function(d){return d.type==='sale'?1.35:1.75;})
        .ringRepeatPeriod(function(d){return d.type==='sale'?1050:1320;});
      wireHeroGlobeTools();
      window.addEventListener('resize',sizeHeroGlobe);
      document.addEventListener('fullscreenchange',function(){setTimeout(sizeHeroGlobe,80);});
    }
    if(skel)skel.hidden=true; el.hidden=false;
    sizeHeroGlobe();
    globoHero.pointsData(pts);
    globoHero.ringsData(pts);
  }catch(e){ if(skel)skel.hidden=false; el.hidden=true; }
}

var globoHero=null;
