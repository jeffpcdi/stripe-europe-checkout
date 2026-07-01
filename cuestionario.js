/**
 * Lógica compartilhada das páginas de pergunta extra (cooud/1..4).
 * - Saldo persistido em localStorage (cresce a cada pergunta respondida).
 * - Recompensa ao responder: confete + reward modal + saldo subindo.
 * - Animações de entrada, glitch do logo, pulse no CTA, timer.
 * - Social proof toasts periódicos.
 * - Exit-intent overlay.
 * - Dismiss redireciona para /proximo/premium.
 * Depende de utils.js (getRandomNumber/animateElement/haptic) e confetti.js.
 */
(function () {
  var CFG = window.CQ || {};
  var REWARD = typeof CFG.reward === 'number' ? CFG.reward : 0;
  var BASE = 3247.83;
  var KEY = 'cq_saldo';

  function fmt(n) {
    return Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function getSaldo() {
    var v = parseFloat(localStorage.getItem(KEY));
    return (isFinite(v) && v > 0) ? v : BASE;
  }
  function setSaldo(v) {
    try { localStorage.setItem(KEY, String(v)); } catch (_) {}
  }
  function animateValue(el, start, end, duration, formatter) {
    var t0 = null;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / duration, 1);
      var cur = start + (end - start) * p;
      el.textContent = formatter ? formatter(cur) : cur.toFixed(2);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  var rewarded = false;
  var saldo = getSaldo();

  function injectStyles() {
    var s = document.createElement('style');
    s.textContent = [
      '.tiktok-logo svg{animation:tiktokGlitch 4.5s infinite}',
      '[data-cooud-flow-primary]{animation:ctaPulse 2.5s ease-in-out infinite}',
      '#cq-reward-modal .reward-amount{color:#16a34a}',
      '.session-timer.timer-critical span{color:#dc2626;animation:blink 1s infinite}',
      '@keyframes blink{50%{opacity:0.4}}',
      '.quiz-toast{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 14px;font-size:13px;color:#374151;box-shadow:0 4px 12px rgba(0,0,0,0.08);animation:quizToastIn 0.4s ease}',
      '.quiz-toast-out{animation:quizToastOut 0.4s ease forwards}',
      '.quiz-toast-icon{margin-right:4px}',
      '@keyframes quizToastIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}',
      '@keyframes quizToastOut{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-10px)}}',
      '@media (prefers-reduced-motion:reduce){.tiktok-logo svg,[data-cooud-flow-primary]{animation:none}}'
    ].join('');
    document.head.appendChild(s);
  }

  function buildRewardModal() {
    var m = document.createElement('div');
    m.id = 'cq-reward-modal';
    m.className = 'modal';
    m.innerHTML =
      '<div class="modal-content">' +
        '<div class="reward-header">¡Saldo aumentado!</div>' +
        '<div class="reward-message">Has ganado</div>' +
        '<div class="reward-amount">+€<span id="cq-reward-value">0,00</span></div>' +
        '<button id="cq-reward-btn" class="continue-reward-btn">Continuar</button>' +
      '</div>';
    document.body.appendChild(m);
    document.getElementById('cq-reward-btn').addEventListener('click', function () {
      m.classList.remove('active');
      if (typeof stopConfetti === 'function') stopConfetti();
    });
    return m;
  }

  function giveReward() {
    if (rewarded || !REWARD) return;
    rewarded = true;
    var modal = document.getElementById('cq-reward-modal') || buildRewardModal();
    var valEl = document.getElementById('cq-reward-value');
    var balEl = document.getElementById('current-balance');
    var old = saldo;
    saldo = Math.round((saldo + REWARD) * 100) / 100;
    setSaldo(saldo);

    valEl.textContent = '0,00';
    modal.classList.add('active');
    if (typeof haptic === 'function') haptic([0, 25, 35, 40]);
    setTimeout(function () {
      if (typeof startConfetti === 'function') startConfetti();
      animateValue(valEl, 0, REWARD, 800, fmt);
    }, 150);
    if (typeof animateElement === 'function') animateElement(modal.querySelector('.reward-amount'), 'reward-pop');
    if (balEl) animateValue(balEl, old, saldo, 1000, fmt);
  }

  // Global para o onclick="selectOpt(this)" das opções
  window.selectOpt = function (el) {
    var opts = document.querySelectorAll('.option');
    for (var i = 0; i < opts.length; i++) opts[i].classList.remove('selected');
    el.classList.add('selected');
    if (typeof haptic === 'function') haptic(12);
    giveReward();
  };

  function startTimer() {
    var t = 12 * 60;
    var el = document.getElementById('session-timer');
    (function tick() {
      var mm = Math.floor(t / 60), ss = t % 60;
      if (el) el.textContent = (mm < 10 ? '0' + mm : mm) + ':' + (ss < 10 ? '0' + ss : ss);
      if (el && t < 180) el.parentElement.classList.add('timer-critical');
      if (t > 0) { t--; setTimeout(tick, 1000); }
    })();
  }

  /* ── Social proof toasts ─────────────────────────────────────── */
  var TOAST_NAMES = [
    'María L.', 'Ana S.', 'Juan R.', 'Pedro M.', 'Sofía C.',
    'Diego F.', 'Inés P.', 'Miguel A.', 'Laura V.', 'Carlos T.',
    'Carmen N.', 'Pablo G.', 'Lucía D.', 'Javier H.', 'Elena B.',
    'Andrés K.', 'Marta O.', 'Francisco J.', 'Sara E.', 'Álvaro W.'
  ];

  function buildToastContainer() {
    if (document.getElementById('quiz-toast-container')) return;
    var c = document.createElement('div');
    c.id = 'quiz-toast-container';
    c.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9000;display:flex;flex-direction:column;gap:8px;width:90%;max-width:360px;pointer-events:none;';
    document.body.appendChild(c);
  }

  function showToast() {
    var container = document.getElementById('quiz-toast-container');
    if (!container) return;
    var name = TOAST_NAMES[Math.floor(Math.random() * TOAST_NAMES.length)];
    var amount = (Math.random() * 2500 + 800).toFixed(2).replace('.', ',');
    var toast = document.createElement('div');
    toast.className = 'quiz-toast';
    toast.innerHTML = '<span class="quiz-toast-icon">✅</span> <strong>' + name + '</strong> acaba de recibir €' + amount;
    container.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('quiz-toast-out');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 400);
    }, 4000);
  }

  function startToasts() {
    buildToastContainer();
    setTimeout(function () {
      showToast();
      setInterval(function () { showToast(); }, 15000 + Math.random() * 5000);
    }, 8000);
  }

  /* ── Exit-intent overlay ─────────────────────────────────────── */
  var exitShown = false;

  function buildExitIntent() {
    if (document.getElementById('cq-exit-overlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'cq-exit-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:11000;display:none;align-items:center;justify-content:center;backdrop-filter:blur(4px);opacity:0;transition:opacity 0.3s ease;';
    overlay.innerHTML =
      '<div style="background:#fff;border-radius:20px;padding:32px 24px;width:85%;max-width:320px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.2);">' +
        '<div style="font-size:36px;margin-bottom:12px;">💰</div>' +
        '<div style="font-size:18px;font-weight:700;color:#111;margin-bottom:8px;">¡Tienes dinero esperándote!</div>' +
        '<div style="font-size:32px;font-weight:800;color:#16a34a;margin:8px 0 12px;">€<span id="cq-exit-balance">' + fmt(saldo) + '</span></div>' +
        '<div style="font-size:13px;color:#6b7280;margin-bottom:20px;line-height:1.5;">Si sales ahora, pierdes todo el saldo acumulado. Completa el cuestionario y retira tu dinero.</div>' +
        '<button id="cq-exit-continue" style="background:#fe2c55;color:#fff;border:none;padding:14px 24px;border-radius:12px;font-weight:600;font-size:15px;cursor:pointer;width:100%;font-family:inherit;">Continuar y recibir</button>' +
      '</div>';
    document.body.appendChild(overlay);

    document.getElementById('cq-exit-continue').addEventListener('click', hideExitIntent);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) hideExitIntent(); });
  }

  function showExitIntent() {
    if (exitShown) return;
    exitShown = true;
    var overlay = document.getElementById('cq-exit-overlay');
    if (!overlay) return;
    var balEl = document.getElementById('cq-exit-balance');
    if (balEl) balEl.textContent = fmt(saldo);
    overlay.style.display = 'flex';
    requestAnimationFrame(function () { overlay.style.opacity = '1'; });
  }

  function hideExitIntent() {
    var overlay = document.getElementById('cq-exit-overlay');
    if (!overlay) return;
    overlay.style.opacity = '0';
    setTimeout(function () { overlay.style.display = 'none'; }, 300);
  }

  function setupExitIntent() {
    buildExitIntent();
    document.addEventListener('mouseleave', function (e) {
      if (e.clientY < 10) showExitIntent();
    });
  }

  /* ── Dismiss → redirect para /proximo/premium ────────────────── */
  function setupDismissRedirect() {
    var btn = document.querySelector('[data-cooud-flow-dismiss]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      setTimeout(function () {
        window.location.href = '../proximo/premium/';
      }, 600);
    }, { once: true });
  }

  function init() {
    injectStyles();
    var balEl = document.getElementById('current-balance');
    if (balEl) balEl.textContent = fmt(saldo);

    var app = document.querySelector('.app-container');
    if (app) app.classList.add('fade-in');
    var qc = document.querySelector('.quiz-container');
    if (qc) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { qc.classList.add('quiz-enter'); });
      });
    }
    startTimer();
    startToasts();
    setupExitIntent();
    setupDismissRedirect();

    if (CFG.popup) {
      var sm = document.getElementById('saldo-modal');
      if (sm) {
        var amt = sm.querySelector('.reward-amount span');
        if (amt) amt.textContent = fmt(saldo);
        sm.classList.add('active');
        var b = document.getElementById('saldo-continue-btn');
        if (b) b.addEventListener('click', function () { sm.classList.remove('active'); });
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
