// Vision UI — dashboard dark servida como HTML estático em /vision.
// IMPORTANTE: este arquivo é uma template string — não usar crase nem ${ } no conteúdo.
module.exports = `<!DOCTYPE html>
<html lang="en" class="bg-vision">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0f123b" />
<meta name="color-scheme" content="dark" />
<title>Vision UI — Dashboard</title>
<link rel="icon" href="/assets/roi-nados-logo.jpg" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
:root{
  --bg-1:#0f123b; --bg-2:#090d2e; --bg-3:#020515;
  --card:linear-gradient(127deg, rgba(6,11,40,.94) 20%, rgba(10,14,35,.49) 100%);
  --card-solid:#0a0e37;
  --sidebar:linear-gradient(112deg, #0b1437 0%, #070b28 100%);
  --accent:#0075ff; --accent-2:#2cd9ff;
  --text:#ffffff; --text-sub:#a0aec0; --text-muted:#718096;
  --success:#01b574; --error:#e31a1a;
  --border:rgba(226,232,240,.10);
  --radius:20px; --radius-sm:12px; --radius-item:15px;
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{min-height:100%}
body{
  font-family:'Plus Jakarta Sans',system-ui,sans-serif;
  background:radial-gradient(ellipse at 10% 0%, var(--bg-1) 0%, var(--bg-2) 45%, var(--bg-3) 100%);
  background-attachment:fixed;
  color:var(--text);
  line-height:1.5;
}
a{color:inherit;text-decoration:none}
button{font-family:inherit;cursor:pointer}

/* ═══ LAYOUT ═══ */
.shell{display:flex;min-height:100vh}
.main{flex:1;min-width:0;padding:24px 28px;display:flex;flex-direction:column;gap:24px}

/* ═══ SIDEBAR ═══ */
.sidebar{
  width:264px;flex-shrink:0;
  background:var(--sidebar);
  border-radius:0 var(--radius) var(--radius) 0;
  padding:32px 16px 16px;
  display:flex;flex-direction:column;
  position:sticky;top:0;height:100vh;overflow-y:auto;
  scrollbar-width:none;
}
.sidebar::-webkit-scrollbar{display:none}
.brand{
  text-align:center;
  font-size:14px;font-weight:600;letter-spacing:.35em;
  background:linear-gradient(94deg, #ffffff 0%, #ffffff 55%, rgba(255,255,255,.25) 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  padding:0 8px 26px;
}
.brand-rule{
  height:1px;margin:0 4px 26px;
  background:linear-gradient(90deg, rgba(224,225,226,0) 0%, rgba(224,225,226,.45) 50%, rgba(224,225,226,0) 100%);
}
.nav{display:flex;flex-direction:column;gap:6px;flex:1}
.nav-label{
  font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--text);padding:16px 14px 8px;
}
.nav-item{
  display:flex;align-items:center;gap:14px;
  padding:10px 14px;border-radius:var(--radius-item);
  font-size:15px;font-weight:600;color:var(--text-sub);
  transition:background .2s ease, color .2s ease;
}
.nav-item:hover{color:var(--text);background:rgba(26,31,68,.55)}
.nav-item.active{
  background:#1a1f44;color:var(--text);
  box-shadow:0 4px 12px rgba(2,5,21,.35);
}
.nav-icon{
  width:36px;height:36px;flex-shrink:0;
  border-radius:var(--radius-sm);
  display:flex;align-items:center;justify-content:center;
  background:#111845;color:var(--accent);
  transition:background .2s ease, color .2s ease;
}
.nav-item.active .nav-icon{background:var(--accent);color:#ffffff}
.nav-icon svg{width:16px;height:16px}

/* help card */
.help-card{
  margin-top:24px;border-radius:var(--radius);
  padding:20px 16px 16px;position:relative;overflow:hidden;
  background:url('/assets/vision-help-bg.png') center/cover no-repeat, #0075ff;
}
.help-icon{
  width:38px;height:38px;border-radius:var(--radius-sm);
  background:#ffffff;color:var(--accent);
  display:flex;align-items:center;justify-content:center;
  margin-bottom:36px;box-shadow:0 4px 10px rgba(2,5,21,.3);
}
.help-icon svg{width:18px;height:18px}
.help-card h4{font-size:15px;font-weight:700;color:#ffffff}
.help-card p{font-size:12.5px;color:rgba(255,255,255,.85);margin:2px 0 12px}
.help-btn{
  display:block;width:100%;text-align:center;
  padding:10px 12px;border:0;border-radius:var(--radius-sm);
  background:rgba(6,11,40,.5);backdrop-filter:blur(8px);
  color:#ffffff;font-size:11px;font-weight:700;letter-spacing:.06em;
  transition:background .2s ease;
}
.help-btn:hover{background:rgba(6,11,40,.72)}

/* ═══ TOPBAR ═══ */
.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.crumbs{font-size:12.5px;color:var(--text-sub)}
.crumbs strong{display:block;font-size:15px;font-weight:700;color:var(--text);margin-top:2px}
.top-actions{display:flex;align-items:center;gap:16px}
.search{
  display:flex;align-items:center;gap:8px;
  background:rgba(15,18,59,.6);border:1px solid var(--border);
  border-radius:var(--radius-item);padding:9px 14px;color:var(--text-sub);
}
.search svg{width:14px;height:14px;flex-shrink:0}
.search input{
  background:transparent;border:0;outline:0;color:var(--text);
  font-family:inherit;font-size:13px;width:140px;
}
.search input::placeholder{color:var(--text-muted)}
.top-link{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--text-sub)}
.top-link:hover{color:var(--text)}
.top-link svg{width:15px;height:15px}

/* ═══ STAT CARDS ═══ */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:20px}
.stat{
  background:var(--card);border-radius:var(--radius);
  padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;
}
.stat .lbl{font-size:12.5px;font-weight:600;color:var(--text-sub)}
.stat .val{font-size:19px;font-weight:800;margin-top:2px}
.stat .val small{font-size:13px;font-weight:700;margin-left:6px}
.up{color:var(--success)} .down{color:var(--error)}
.stat-icon{
  width:44px;height:44px;flex-shrink:0;border-radius:var(--radius-sm);
  background:var(--accent);color:#ffffff;
  display:flex;align-items:center;justify-content:center;
}
.stat-icon svg{width:20px;height:20px}

/* ═══ CARDS GRID ═══ */
.grid-2{display:grid;grid-template-columns:1fr 1.3fr;gap:20px}
.card{background:var(--card);border-radius:var(--radius);padding:24px}
.card h3{font-size:16px;font-weight:700}
.card .sub{font-size:13px;color:var(--text-sub);margin-top:2px}
.card .sub b{color:var(--success);font-weight:700}

/* welcome */
.welcome{
  position:relative;overflow:hidden;min-height:220px;
  display:flex;flex-direction:column;justify-content:center;gap:4px;
  background:url('/assets/vision-help-bg.png') right center/cover no-repeat, var(--card-solid);
  border-radius:var(--radius);padding:28px;
}
.welcome::before{content:'';position:absolute;inset:0;background:linear-gradient(90deg, rgba(6,11,40,.85) 30%, rgba(6,11,40,.2) 100%)}
.welcome > *{position:relative}
.welcome .hi{font-size:13px;font-weight:600;color:var(--text-sub)}
.welcome h2{font-size:26px;font-weight:800;margin:2px 0 6px}
.welcome p{font-size:13.5px;color:var(--text-sub);max-width:280px}
.welcome a{display:inline-flex;align-items:center;gap:6px;margin-top:18px;font-size:12px;font-weight:700;color:#ffffff}
.welcome a svg{width:14px;height:14px;transition:transform .2s ease}
.welcome a:hover svg{transform:translateX(3px)}

/* chart */
.chart{display:flex;align-items:flex-end;gap:10px;height:180px;margin-top:22px}
.bar-w{flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;height:100%;justify-content:flex-end}
.bar{
  width:100%;max-width:34px;border-radius:8px 8px 4px 4px;
  background:linear-gradient(180deg, var(--accent-2) 0%, var(--accent) 100%);
  min-height:8px;
}
.bar-w span{font-size:11px;color:var(--text-muted);font-weight:600}

/* table */
.tbl{width:100%;border-collapse:collapse;margin-top:18px}
.tbl th{
  text-align:left;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
  color:var(--text-muted);padding:10px 12px;border-bottom:1px solid var(--border);
}
.tbl td{padding:14px 12px;font-size:13.5px;font-weight:600;border-bottom:1px solid var(--border)}
.tbl tr:last-child td{border-bottom:0}
.tbl .muted{color:var(--text-sub);font-weight:500}
.pct{display:flex;align-items:center;gap:10px}
.pct .track{flex:1;height:4px;border-radius:99px;background:rgba(255,255,255,.12);min-width:70px}
.pct .fill{height:100%;border-radius:99px;background:var(--accent)}
.pct b{font-size:12.5px;color:var(--accent-2);min-width:36px}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:8px;vertical-align:1px}

/* ═══ MOBILE ═══ */
.menu-btn{
  display:none;border:0;background:rgba(15,18,59,.6);border:1px solid var(--border);
  color:var(--text);width:40px;height:40px;border-radius:var(--radius-sm);
  align-items:center;justify-content:center;
}
.menu-btn svg{width:18px;height:18px}
.overlay{display:none;position:fixed;inset:0;background:rgba(2,5,21,.6);z-index:40}
@media (max-width: 1100px){ .grid-2{grid-template-columns:1fr} }
@media (max-width: 860px){
  .sidebar{
    position:fixed;left:0;top:0;z-index:50;height:100dvh;
    transform:translateX(-105%);transition:transform .3s cubic-bezier(.32,.72,.24,1.06);
    border-radius:0 var(--radius) var(--radius) 0;
  }
  .sidebar.open{transform:translateX(0)}
  .overlay.show{display:block}
  .menu-btn{display:flex}
  .main{padding:18px 16px}
  .search input{width:90px}
}
</style>
</head>
<body>
<div class="shell">

  <!-- ═══ SIDEBAR ═══ -->
  <aside class="sidebar" id="sidebar" aria-label="Main navigation">
    <div class="brand">VISION UI FREE</div>
    <div class="brand-rule" role="presentation"></div>

    <nav class="nav">
      <a class="nav-item active" href="#" aria-current="page">
        <span class="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.1 2.7 11a1 1 0 0 0 .65 1.76H5v7.24c0 .55.45 1 1 1h4.2v-5.3c0-.55.45-1 1-1h1.6c.55 0 1 .45 1 1V21H18c.55 0 1-.45 1-1v-7.24h1.65A1 1 0 0 0 21.3 11L12 3.1Z"/></svg>
        </span>
        Dashboard
      </a>
      <a class="nav-item" href="#">
        <span class="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 9.5c0-.55.45-1 1-1h1.5c.55 0 1 .45 1 1V20h-3.5V9.5Zm5.25-5c0-.55.45-1 1-1h1.5c.55 0 1 .45 1 1V20h-3.5V4.5Zm5.25 8c0-.55.45-1 1-1H18c.55 0 1 .45 1 1V20h-3.5v-7.5Z"/></svg>
        </span>
        Tables
      </a>
      <a class="nav-item" href="#">
        <span class="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1H3V7Zm0 4h18v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6Zm3 4.25c0 .41.34.75.75.75h3.5a.75.75 0 0 0 0-1.5h-3.5a.75.75 0 0 0-.75.75Z"/></svg>
        </span>
        Billing
      </a>
      <a class="nav-item" href="#">
        <span class="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.7 6.9a5.4 5.4 0 0 1-6.32 7.06l-6.68 6.68a2.3 2.3 0 0 1-3.25-3.25l6.68-6.68A5.4 5.4 0 0 1 19.19 4.4l-3.1 3.1 2.5 2.5 3.11-3.1Z"/></svg>
        </span>
        RTL
      </a>

      <div class="nav-label">Account Pages</div>

      <a class="nav-item" href="#">
        <span class="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.87 0-7 2.13-7 4.75 0 .69.56 1.25 1.25 1.25h11.5c.69 0 1.25-.56 1.25-1.25C19 16.13 15.87 14 12 14Z"/></svg>
        </span>
        Profile
      </a>
      <a class="nav-item" href="#">
        <span class="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-4.5h-2V19H6V5h8v4.5h2V5a2 2 0 0 0-2-2H6Zm8.5 6.25 2.75 2.75-2.75 2.75-1.06-1.06.94-.94H9v-1.5h5.38l-.94-.94 1.06-1.06Z"/></svg>
        </span>
        Sign In
      </a>
      <a class="nav-item" href="#">
        <span class="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.2 3.1c2.9-1 6.1-.44 7.7 1.16 1.6 1.6 2.16 4.8 1.16 7.7-.97 2.8-3.2 5.6-6.9 7.42l-1.87-3.44-2.05-2.05L7.8 12l-3.44-1.87C6.16 6.42 8.96 4.2 11.76 3.22l1.44-.12ZM7 15.5c.83.83.83 2.67 0 3.5-.62.62-2.5 1-4 1 0-1.5.38-3.38 1-4 .83-.83 2.17-.83 3 0Zm9.25-8.75a1.5 1.5 0 1 0-2.12 2.12 1.5 1.5 0 0 0 2.12-2.12Z"/></svg>
        </span>
        Sign Up
      </a>
    </nav>

    <div class="help-card">
      <div class="help-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm.1 15.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm1.9-6.1c-.63.5-1 .85-1 1.6v.5h-1.9v-.65c0-1.4.75-2.05 1.4-2.55.57-.44.93-.73.93-1.35 0-.8-.65-1.3-1.43-1.3-.83 0-1.5.53-1.65 1.4l-1.85-.4C8.83 6.9 10.2 5.8 12.05 5.8c1.95 0 3.4 1.2 3.4 3 0 1.35-.75 2.05-1.45 2.6Z"/></svg>
      </div>
      <h4>Need help?</h4>
      <p>Please check our docs</p>
      <button class="help-btn" type="button">DOCUMENTATION</button>
    </div>
  </aside>

  <div class="overlay" id="overlay"></div>

  <!-- ═══ MAIN ═══ -->
  <main class="main">
    <header class="topbar">
      <div style="display:flex;align-items:center;gap:14px">
        <button class="menu-btn" id="menuBtn" aria-label="Open menu" aria-expanded="false">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z"/></svg>
        </button>
        <div class="crumbs">Pages&nbsp;/&nbsp;Dashboard<strong>Dashboard</strong></div>
      </div>
      <div class="top-actions">
        <label class="search">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 2a8 8 0 1 0 4.9 14.32l4.4 4.39 1.4-1.42-4.38-4.39A8 8 0 0 0 10 2Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z"/></svg>
          <input type="text" placeholder="Type here..." aria-label="Search" />
        </label>
        <a class="top-link" href="#">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.87 0-7 2.13-7 4.75 0 .69.56 1.25 1.25 1.25h11.5c.69 0 1.25-.56 1.25-1.25C19 16.13 15.87 14 12 14Z"/></svg>
          Sign In
        </a>
      </div>
    </header>

    <!-- stat cards -->
    <section class="stats" aria-label="Key metrics">
      <div class="stat">
        <div>
          <div class="lbl">Today&apos;s Money</div>
          <div class="val">$53,000<small class="up">+55%</small></div>
        </div>
        <div class="stat-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1H4V6Zm0 3h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9Zm10 4.5a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/></svg>
        </div>
      </div>
      <div class="stat">
        <div>
          <div class="lbl">Today&apos;s Users</div>
          <div class="val">2,300<small class="up">+3%</small></div>
        </div>
        <div class="stat-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 11a3.5 3.5 0 1 0-3.4-4.35A5 5 0 0 1 14.5 10c0 .28-.02.55-.07.82.48.12.98.18 1.57.18Zm-7 1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0 2c-3.3 0-6 1.8-6 4v1c0 .55.45 1 1 1h10c.55 0 1-.45 1-1v-1c0-2.2-2.7-4-6-4Zm7 0c-.35 0-.68.02-1 .06 1.2.94 2 2.24 2 3.94v1c0 .35-.06.68-.17 1H20c.55 0 1-.45 1-1v-1c0-2.2-2.7-4-5-4Z"/></svg>
        </div>
      </div>
      <div class="stat">
        <div>
          <div class="lbl">New Clients</div>
          <div class="val">+3,462<small class="down">-2%</small></div>
        </div>
        <div class="stat-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.87 0-7 2.13-7 4.75 0 .69.56 1.25 1.25 1.25h11.5c.69 0 1.25-.56 1.25-1.25C17 16.13 13.87 14 10 14Zm9-8v2h2v2h-2v2h-2v-2h-2V8h2V6h2Z"/></svg>
        </div>
      </div>
      <div class="stat">
        <div>
          <div class="lbl">Total Sales</div>
          <div class="val">$103,430<small class="up">+5%</small></div>
        </div>
        <div class="stat-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 18c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2Zm10 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2ZM6.2 13.5 5.3 15c-.37.67.1 1.5.87 1.5H19v-2H7.42l.93-1.5h7.45c.75 0 1.41-.41 1.75-1.03l3.24-5.88A1 1 0 0 0 19.92 4H6.21l-.94-2H2v2h2l3.6 7.59-1.4 1.91Z"/></svg>
        </div>
      </div>
    </section>

    <!-- welcome + chart -->
    <section class="grid-2">
      <div class="welcome">
        <div class="hi">Welcome back,</div>
        <h2>Mark Johnson</h2>
        <p>Glad to see you again! Ask me anything.</p>
        <a href="#">Tap to record
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.17 5.17 11.76 6.6 16.17 11H4v2h12.17l-4.41 4.41 1.41 1.42L20 12l-6.83-6.83Z"/></svg>
        </a>
      </div>

      <div class="card">
        <h3>Sales Overview</h3>
        <div class="sub"><b>(+5) more</b> in 2026</div>
        <div class="chart" role="img" aria-label="Bar chart of monthly sales, peaking in July">
          <div class="bar-w"><div class="bar" style="height:38%"></div><span>Jan</span></div>
          <div class="bar-w"><div class="bar" style="height:55%"></div><span>Feb</span></div>
          <div class="bar-w"><div class="bar" style="height:42%"></div><span>Mar</span></div>
          <div class="bar-w"><div class="bar" style="height:68%"></div><span>Apr</span></div>
          <div class="bar-w"><div class="bar" style="height:52%"></div><span>May</span></div>
          <div class="bar-w"><div class="bar" style="height:80%"></div><span>Jun</span></div>
          <div class="bar-w"><div class="bar" style="height:100%"></div><span>Jul</span></div>
          <div class="bar-w"><div class="bar" style="height:72%"></div><span>Aug</span></div>
          <div class="bar-w"><div class="bar" style="height:60%"></div><span>Sep</span></div>
          <div class="bar-w"><div class="bar" style="height:84%"></div><span>Oct</span></div>
          <div class="bar-w"><div class="bar" style="height:64%"></div><span>Nov</span></div>
          <div class="bar-w"><div class="bar" style="height:90%"></div><span>Dec</span></div>
        </div>
      </div>
    </section>

    <!-- projects table -->
    <section class="card">
      <h3>Projects</h3>
      <div class="sub"><b>30 done</b> this month</div>
      <div style="overflow-x:auto">
        <table class="tbl">
          <thead>
            <tr><th>Company</th><th>Members</th><th>Budget</th><th>Completion</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="dot" style="background:#0075ff"></span>Chakra Vision UI Version</td>
              <td class="muted">Ryan, Estela, +3</td>
              <td>$14,000</td>
              <td><div class="pct"><b>60%</b><div class="track"><div class="fill" style="width:60%"></div></div></div></td>
            </tr>
            <tr>
              <td><span class="dot" style="background:#2cd9ff"></span>Add Progress Track</td>
              <td class="muted">Alexander, Laurent</td>
              <td>$3,000</td>
              <td><div class="pct"><b>10%</b><div class="track"><div class="fill" style="width:10%"></div></div></div></td>
            </tr>
            <tr>
              <td><span class="dot" style="background:#01b574"></span>Fix Platform Errors</td>
              <td class="muted">Michael, Richard</td>
              <td>Not set</td>
              <td><div class="pct"><b>100%</b><div class="track"><div class="fill" style="width:100%"></div></div></div></td>
            </tr>
            <tr>
              <td><span class="dot" style="background:#ffb547"></span>Launch our Mobile App</td>
              <td class="muted">Nathan, Jessica, +2</td>
              <td>$32,000</td>
              <td><div class="pct"><b>100%</b><div class="track"><div class="fill" style="width:100%"></div></div></div></td>
            </tr>
            <tr>
              <td><span class="dot" style="background:#e31a1a"></span>Add the New Pricing Page</td>
              <td class="muted">Miriam, Wilson</td>
              <td>$400</td>
              <td><div class="pct"><b>25%</b><div class="track"><div class="fill" style="width:25%"></div></div></div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</div>

<script>
(function(){
  var sb = document.getElementById('sidebar');
  var ov = document.getElementById('overlay');
  var btn = document.getElementById('menuBtn');
  function setOpen(open){
    sb.classList.toggle('open', open);
    ov.classList.toggle('show', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  btn.addEventListener('click', function(){ setOpen(!sb.classList.contains('open')); });
  ov.addEventListener('click', function(){ setOpen(false); });
})();
</script>
</body>
</html>`;
