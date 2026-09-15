function overviewEmptyState(iconHtml,text){
  return '<div class="overview-empty">'+iconHtml+'<span>'+text+'</span></div>';
}
function renderOverviewLower(m){
  var countriesEl=document.getElementById('ov-top-countries');
  var purchasesEl=document.getElementById('ov-recent-purchases');
  var countryBadge=document.getElementById('hero-active-countries');
  var countries=(m&&m.countries?m.countries:[]).slice(0,5);
  if(countryBadge){
    var cn=m&&m.countries?m.countries.length:0;
    countryBadge.textContent=cn+(cn===1?' país monitorado':' países monitorados');
  }
  if(countriesEl){
    if(!countries.length){
      countriesEl.innerHTML=overviewEmptyState('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></svg>','Aguardando telemetria geográfica neste período');
    }else{
      var top=Math.max(1,countries[0].count||1);
      countriesEl.innerHTML=countries.map(function(c){
        var pct=Math.max(4,Math.round((c.count||0)/top*100));
        var conv=c.count?Math.round((c.purchased||0)/c.count*100):0;
        return '<div class="ov-country-row"><span class="ov-country-flag">'+flag(c.code)+'</span><div class="ov-country-name"><b>'+esc(c.name||c.code)+'</b><span>'+conv+'% conversão</span></div><span class="ov-country-track"><i style="width:'+pct+'%"></i></span><span class="ov-country-count">'+(c.count||0)+'</span></div>';
      }).join('');
    }
  }
  if(purchasesEl){
    var buys=(DATA.events||[]).filter(function(e){return e.type==='sale'&&inPeriod(e.at);}).sort(function(a,b){return new Date(b.at).getTime()-new Date(a.at).getTime();}).slice(0,6);
    if(!buys.length){
      purchasesEl.innerHTML=overviewEmptyState('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 7l-8 10-4-4-4 5"/><path d="M16 7h4v4"/></svg>','Nenhuma compra registrada neste período');
    }else{
      purchasesEl.innerHTML=buys.map(function(e){
        var where=[e.city,e.countryName||e.country].filter(Boolean).join(' · ')||'Origem rastreada';
        return '<div class="ov-purchase-row"><span class="ov-purchase-dot"></span><div class="ov-purchase-main"><b>'+esc(e.customer||e.email||'Venda aprovada')+'</b><span>'+esc(where)+'</span></div><span class="ov-purchase-value">'+money(e.amount||0,e.currency||m.mainCur||'EUR')+'</span><span class="ov-purchase-time">'+timeAgo(e.at)+'</span></div>';
      }).join('');
    }
  }
}
