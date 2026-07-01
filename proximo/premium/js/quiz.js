/**
 * Quiz questions and logic - 7 questions with pre-conditioning
 */

// Monoline icon set (TikTok-style line icons) used in place of emojis
const OPTION_ICONS = {
  laugh: '<circle cx="12" cy="12" r="9"/><path d="M8 13a4 4 0 0 0 8 0"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14c1 1 2.2 1.5 3.5 1.5s2.5-.5 3.5-1.5"/><line x1="9" y1="9.5" x2="9.01" y2="9.5"/><line x1="15" y1="9.5" x2="15.01" y2="9.5"/>',
  meh: '<circle cx="12" cy="12" r="9"/><line x1="8.5" y1="15" x2="15.5" y2="15"/><line x1="9" y1="9.5" x2="9.01" y2="9.5"/><line x1="15" y1="9.5" x2="15.01" y2="9.5"/>',
  frown: '<circle cx="12" cy="12" r="9"/><path d="M15.5 16c-1-1-2.2-1.5-3.5-1.5s-2.5.5-3.5 1.5"/><line x1="9" y1="9.5" x2="9.01" y2="9.5"/><line x1="15" y1="9.5" x2="15.01" y2="9.5"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
  broadcast: '<circle cx="12" cy="12" r="2.5"/><path d="M16.5 7.5a6 6 0 0 1 0 9"/><path d="M7.5 16.5a6 6 0 0 1 0-9"/><path d="M19.5 4.5a10 10 0 0 1 0 15"/><path d="M4.5 19.5a10 10 0 0 1 0-15"/>',
  music: '<circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><line x1="9" y1="18" x2="9" y2="7"/><line x1="21" y1="16" x2="21" y2="5"/><path d="M9 7l12-2"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.3 1 2.5h6c0-1.2.4-1.9 1-2.5A6 6 0 0 0 12 3z"/>',
  sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 14.5l.6 1.8 1.9.6-1.9.6-.6 1.8-.6-1.8-1.9-.6 1.9-.6z"/>',
  party: '<path d="M4 20l5-13 9 9z"/><line x1="11.5" y1="9.5" x2="13.5" y2="7.5"/><circle cx="18" cy="6" r="1"/><circle cx="14" cy="4" r="1"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h6v16H6a2 2 0 0 0-2 2z"/><path d="M20 5a2 2 0 0 0-2-2h-6v16h6a2 2 0 0 1 2 2z"/>',
  heart: '<path d="M12 20s-7-4.5-9-9a4.5 4.5 0 0 1 9-2 4.5 4.5 0 0 1 9 2c-2 4.5-9 9-9 9z"/>',
  zap: '<polygon points="13 2 4 14 11 14 11 22 20 10 13 10 13 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  ban: '<circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/>',
  gradCap: '<path d="M2 9l10-4 10 4-10 4z"/><path d="M6 11v4c0 1.2 2.7 2.5 6 2.5s6-1.3 6-2.5v-4"/>',
  briefcase: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><line x1="3" y1="13" x2="21" y2="13"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>'
};

// Icon key per question/option (replaces the emojis visually)
const QUESTION_ICONS = [
  ['laugh', 'smile', 'meh', 'frown'],
  ['video', 'film', 'clock', 'broadcast'],
  ['clock', 'clock', 'clock', 'clock', 'clock'],
  ['laugh', 'music', 'bulb', 'video', 'sparkles'],
  ['party', 'book', 'heart', 'zap', 'calendar'],
  ['checkCircle', 'calendar', 'clock', 'moon', 'ban'],
  ['gradCap', 'party', 'briefcase', 'user']
];

function optionIcon(key) {
  var inner = OPTION_ICONS[key] || OPTION_ICONS.clock;
  return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
}

const quizQuestions = [
  {
    id: 1,
    question: "\u00BFC\u00F3mo eval\u00FAas tu experiencia general en TikTok?",
    options: [
      { emoji: "\uD83D\uDE0D", text: "Excelente" },
      { emoji: "\uD83D\uDE0A", text: "Buena" },
      { emoji: "\uD83D\uDE10", text: "Regular" },
      { emoji: "\uD83D\uDE12", text: "Mala" }
    ]
  },
  {
    id: 2,
    question: "\u00BFCu\u00E1l es tu formato de v\u00EDdeo favorito en TikTok?",
    options: [
      { emoji: "\uD83C\uDFA5", text: "V\u00EDdeo corto" },
      { emoji: "\uD83D\uDCF9", text: "V\u00EDdeo medio" },
      { emoji: "\u23F3", text: "V\u00EDdeo largo" },
      { emoji: "\uD83D\uDCFA", text: "Directo" }
    ]
  },
  {
    id: 3,
    question: "\u00BFCu\u00E1ntas horas al d\u00EDa pasas en TikTok?",
    options: [
      { emoji: "\u23F3", text: "Menos de 1 hora" },
      { emoji: "\u23F3", text: "1 a 2 horas" },
      { emoji: "\u23F3", text: "2 a 4 horas" },
      { emoji: "\u23F3", text: "4 a 6 horas" },
      { emoji: "\u23F3", text: "M\u00E1s de 6 horas" }
    ]
  },
  {
    id: 4,
    question: "\u00BFCu\u00E1l de estos temas de contenido te gusta m\u00E1s ver en TikTok?",
    options: [
      { emoji: "\uD83D\uDE02", text: "Comedia" },
      { emoji: "\uD83D\uDC83", text: "Baile" },
      { emoji: "\u2139\uFE0F", text: "Tutoriales y consejos" },
      { emoji: "\uD83D\uDCF9", text: "Vlogs diarios" },
      { emoji: "\uD83D\uDC84", text: "Moda y belleza" }
    ]
  },
  {
    id: 5,
    question: "\u00BFQu\u00E9 te hace seguir a un creador en TikTok?",
    options: [
      { emoji: "\uD83C\uDF89", text: "Contenido divertido" },
      { emoji: "\uD83D\uDCDA", text: "Contenido educativo" },
      { emoji: "\uD83E\uDD1D", text: "Conexi\u00F3n personal" },
      { emoji: "\uD83D\uDD25", text: "Participaci\u00F3n en desaf\u00EDos" },
      { emoji: "\uD83D\uDCC5", text: "Frecuencia de publicaciones" }
    ]
  },
  {
    id: 6,
    question: "\u00BFCon qu\u00E9 frecuencia comentas en v\u00EDdeos de TikTok?",
    options: [
      { emoji: "\uD83D\uDD04", text: "Siempre" },
      { emoji: "\uD83D\uDCC6", text: "Frecuentemente" },
      { emoji: "\u23F3", text: "A veces" },
      { emoji: "\uD83C\uDF27\uFE0F", text: "Raramente" },
      { emoji: "\uD83D\uDEAB", text: "Nunca" }
    ]
  },
  {
    id: 7,
    question: "\u00BFCu\u00E1l es tu rango de edad?",
    options: [
      { emoji: "\uD83E\uDDD1\u200D\uD83C\uDF93", text: "13-17 a\u00F1os" },
      { emoji: "\uD83C\uDF89", text: "18-24 a\u00F1os" },
      { emoji: "\uD83D\uDC69\u200D\uD83D\uDCBC", text: "25-34 a\u00F1os" },
      { emoji: "\uD83D\uDC75", text: "35 a\u00F1os o m\u00E1s" }
    ]
  }
];

// Pre-conditioning messages shown at specific questions
var preconditionMessages = {
  3: {
    type: 'info',
    text: 'Tu saldo ha superado \u20AC1.000 \u2014 para retiros superiores a este valor, es necesaria una verificaci\u00F3n de identidad.'
  },
  5: {
    type: 'warning',
    text: 'Saldo superior a \u20AC2.500 \u2014 por regulaci\u00F3n europea, se aplicar\u00E1 una tasa \u00FAnica de confirmaci\u00F3n (reembolsable) para procesar el retiro.'
  }
};

// Quiz state
let currentQuestionIndex = 0;
let selectedOption = null;
const quizContainer = document.getElementById('quiz-container');

// Render a question
function renderQuestion(questionIndex) {
  const question = quizQuestions[questionIndex];

  // Update progress
  updateProgressBar(questionIndex, quizQuestions.length);

  // Update verification bar
  var verifyPercent = Math.round(((questionIndex) / quizQuestions.length) * 100);
  var verifyEl = document.getElementById('verify-bar-fill');
  var verifyText = document.getElementById('verify-bar-text');
  if (verifyEl) verifyEl.style.width = verifyPercent + '%';
  if (verifyText) verifyText.textContent = verifyPercent + '% verificado';

  // Pre-conditioning banner
  var precondition = preconditionMessages[questionIndex];
  var bannerHTML = '';
  if (precondition) {
    var bannerClass = precondition.type === 'warning' ? 'precondition-banner warning' : 'precondition-banner';
    bannerHTML = '<div class="' + bannerClass + '">' + precondition.text + '</div>';
  }

  // Saldo em risco after question 4
  var riskHTML = '';
  if (questionIndex >= 4) {
    riskHTML = '<div class="saldo-risk-notice">Tu saldo de \u20AC' + (typeof totalEarned !== 'undefined' ? formatCurrency(totalEarned) : '0.00') + ' expira si no completas el cuestionario.</div>';
  }

  // Create the question HTML
  const questionHTML =
    '<div class="quiz-question-wrapper">' +
      bannerHTML +
      '<div class="quiz-question-number">Pregunta ' + (questionIndex + 1) + ' de ' + quizQuestions.length + '</div>' +
      '<div class="quiz-title">' + question.question + '</div>' +
      '<div class="quiz-subtitle">Selecciona una opci\u00F3n para continuar:</div>' +
      '<div class="options-container">' +
        question.options.map(function(option, index) {
          return '<div class="option" data-index="' + index + '">' +
            '<div class="option-content">' +
              '<div class="option-emoji">' + optionIcon((QUESTION_ICONS[questionIndex] || [])[index]) + '</div>' +
              '<div class="option-text">' + option.text + '</div>' +
            '</div>' +
            '<div class="custom-checkbox"></div>' +
          '</div>';
        }).join('') +
      '</div>' +
      riskHTML +
      '<button id="continue-btn" class="continue-btn" disabled>Continuar</button>' +
    '</div>';

  const mountQuestion = () => {
    quizContainer.innerHTML = questionHTML;
    setupQuestionListeners(question, questionIndex);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        quizContainer.classList.add('quiz-enter');
      });
    });

    const handleEnterEnd = (event) => {
      if (event.target !== quizContainer || event.animationName !== 'quizFadeIn') return;
      quizContainer.classList.remove('quiz-enter');
      quizContainer.removeEventListener('animationend', handleEnterEnd);
    };
    quizContainer.addEventListener('animationend', handleEnterEnd);
  };

  if (questionIndex > 0) {
    quizContainer.classList.remove('quiz-enter');
    quizContainer.classList.add('quiz-exit');

    const handleExitEnd = (event) => {
      if (event.target !== quizContainer || event.animationName !== 'quizFadeOut') return;
      quizContainer.classList.remove('quiz-exit');
      quizContainer.removeEventListener('animationend', handleExitEnd);
      mountQuestion();
    };
    quizContainer.addEventListener('animationend', handleExitEnd);
  } else {
    mountQuestion();
  }
}

// Setup event listeners for question options
function setupQuestionListeners(question, questionIndex) {
  const options = document.querySelectorAll('.option');
  options.forEach(option => {
    option.addEventListener('click', () => {
      options.forEach(opt => opt.classList.remove('selected'));
      option.classList.add('selected');
      document.getElementById('continue-btn').disabled = false;
      selectedOption = parseInt(option.dataset.index);
      if (typeof haptic === 'function') haptic(12);

      if (typeof trackContact === 'function') trackContact();
    });
  });

  const continueBtn = document.getElementById('continue-btn');
  continueBtn.addEventListener('click', () => {
    if (selectedOption === null || continueBtn.disabled) return;
    if (typeof haptic === 'function') haptic(18);

    continueBtn.disabled = true;
    const selectedAnswer = question.options[selectedOption].text;
    if (typeof notifyQuestionAnswered === 'function') notifyQuestionAnswered(questionIndex + 1, selectedAnswer);
    if (typeof playCashRegisterSound === 'function') playCashRegisterSound();
    showReward(currentQuestionIndex);
  });
}

// Move to the next question
function nextQuestion() {
  currentQuestionIndex++;
  selectedOption = null;

  if (currentQuestionIndex < quizQuestions.length) {
    renderQuestion(currentQuestionIndex);
  } else {
    showFinalReward();
  }
}

// Reset the quiz
function resetQuiz() {
  currentQuestionIndex = 0;
  selectedOption = null;
  totalEarned = STARTING_BONUS;
  rewards = generateRewards();
  currentBalance.textContent = String(STARTING_BONUS);
  renderQuestion(currentQuestionIndex);
}
