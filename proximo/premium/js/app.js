/**
 * Main application initialization
 */

// Session timer
var sessionTimerSeconds = 720; // 12 minutes
var sessionTimerInterval = null;

function startSessionTimer() {
  var timerEl = document.getElementById('session-timer');
  if (!timerEl) return;
  sessionTimerInterval = setInterval(function() {
    sessionTimerSeconds--;
    if (sessionTimerSeconds <= 0) {
      clearInterval(sessionTimerInterval);
      sessionTimerSeconds = 0;
    }
    var mins = Math.floor(sessionTimerSeconds / 60);
    var secs = sessionTimerSeconds % 60;
    timerEl.textContent = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
    if (sessionTimerSeconds < 180) {
      timerEl.parentElement.classList.add('timer-critical');
    }
  }, 1000);
}

// Quiz toast social proof
var quizToastNames = [
  'María L.', 'Ana S.', 'Juan R.', 'Pedro M.', 'Sofía C.',
  'Diego F.', 'Inés P.', 'Miguel A.', 'Laura V.', 'Carlos T.',
  'Carmen N.', 'Pablo G.', 'Lucía D.', 'Javier H.', 'Elena B.',
  'Andrés K.', 'Marta O.', 'Francisco J.', 'Sara E.', 'Álvaro W.'
];
var quizToastInterval = null;

function startQuizToasts() {
  var container = document.getElementById('quiz-toast-container');
  if (!container) return;
  function showToast() {
    var name = quizToastNames[Math.floor(Math.random() * quizToastNames.length)];
    var amount = (Math.random() * 2500 + 800).toFixed(2).replace('.', ',');
    var toast = document.createElement('div');
    toast.className = 'quiz-toast';
    toast.innerHTML = '<span class="quiz-toast-icon">✅</span> <strong>' + name + '</strong> acaba de recibir €' + amount;
    container.appendChild(toast);
    setTimeout(function() {
      toast.classList.add('quiz-toast-out');
      setTimeout(function() { toast.remove(); }, 400);
    }, 4000);
  }
  // First toast after 8s, then every 15-20s
  setTimeout(function() {
    showToast();
    quizToastInterval = setInterval(function() {
      showToast();
    }, 15000 + Math.random() * 5000);
  }, 8000);
}

function stopQuizToasts() {
  if (quizToastInterval) clearInterval(quizToastInterval);
}

// Exit-intent popup
var exitIntentShown = false;

function setupExitIntent() {
  // Desktop: mouseleave on top of page
  document.addEventListener('mouseleave', function(e) {
    if (e.clientY < 10 && !exitIntentShown) {
      showExitIntent();
    }
  });
}

function showExitIntent() {
  exitIntentShown = true;
  var overlay = document.getElementById('exit-intent-overlay');
  if (!overlay) return;
  var balanceText = typeof totalEarned !== 'undefined' && totalEarned > 0 ? formatCurrency(totalEarned) : '3.247,83';
  document.getElementById('exit-intent-balance').textContent = balanceText;
  overlay.style.display = 'flex';
  requestAnimationFrame(function() {
    overlay.classList.add('active');
  });
}

function hideExitIntent() {
  var overlay = document.getElementById('exit-intent-overlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  setTimeout(function() { overlay.style.display = 'none'; }, 300);
}

// Initialize the quiz
document.addEventListener('DOMContentLoaded', () => {
  // Start with the first question
  renderQuestion(0);

  // Welcome bonus popup (you already earned €97 just for entering)
  showWelcomeBonus();

  // Initialize pages navigation
  initializePages();

  // Create the withdraw popup (once)
  createWithdrawPopup();

  // Start session timer
  startSessionTimer();

  // Start quiz toasts
  startQuizToasts();

  // Setup exit-intent
  setupExitIntent();

  // Exit-intent close handlers
  var exitContinueBtn = document.getElementById('exit-intent-continue');
  if (exitContinueBtn) exitContinueBtn.addEventListener('click', hideExitIntent);
  var exitOverlay = document.getElementById('exit-intent-overlay');
  if (exitOverlay) exitOverlay.addEventListener('click', function(e) { if (e.target === exitOverlay) hideExitIntent(); });

  // Setup withdraw button in header
  const headerWithdrawBtn = document.getElementById('header-withdraw-btn');
  if (headerWithdrawBtn) {
    headerWithdrawBtn.classList.add('disabled');
    headerWithdrawBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      showWithdrawPopup();
    });
  }
});

// Professional popup for withdraw button
function createWithdrawPopup() {
  const overlay = document.createElement('div');
  overlay.id = 'withdraw-popup-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:10000;display:none;align-items:center;justify-content:center;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);';

  const popup = document.createElement('div');
  popup.id = 'withdraw-popup';
  popup.style.cssText = 'background:#fff;border-radius:20px;padding:28px 24px;width:85%;max-width:320px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.15);transform:scale(0.92);opacity:0;transition:all 0.3s cubic-bezier(0.22,1,0.36,1);';

  popup.innerHTML = `
    <div style="width:48px;height:48px;border-radius:50%;background:rgba(254,44,85,0.08);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fe2c55" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    </div>
    <p style="font-size:15px;font-weight:700;color:#111;margin-bottom:8px;line-height:1.4;">Debes completar todas las tareas para poder retirar el dinero.</p>
    <p style="font-size:13px;color:#9ca3af;margin-bottom:20px;line-height:1.4;">Responde a todas las preguntas del cuestionario para desbloquear el retiro.</p>
    <button id="withdraw-popup-close" style="background:#fe2c55;color:#fff;border:none;padding:12px 24px;border-radius:12px;font-weight:600;font-size:14px;cursor:pointer;width:100%;font-family:inherit;transition:background 0.2s ease;">Entendido</button>
  `;

  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  // Close handlers
  const closeBtn = document.getElementById('withdraw-popup-close');
  closeBtn.addEventListener('click', hideWithdrawPopup);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) hideWithdrawPopup();
  });
}

function showWithdrawPopup() {
  const overlay = document.getElementById('withdraw-popup-overlay');
  const popup = document.getElementById('withdraw-popup');
  if (!overlay) return;
  overlay.style.display = 'flex';
  requestAnimationFrame(() => {
    popup.style.transform = 'scale(1)';
    popup.style.opacity = '1';
  });
}

function hideWithdrawPopup() {
  const overlay = document.getElementById('withdraw-popup-overlay');
  const popup = document.getElementById('withdraw-popup');
  if (!overlay) return;
  popup.style.transform = 'scale(0.92)';
  popup.style.opacity = '0';
  setTimeout(() => {
    overlay.style.display = 'none';
  }, 250);
}
