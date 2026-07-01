/**
 * TikTok Pixel Events Tracking
 * Pixel: D4CD623C77UCD4LDVC2G
 * API oficial do TikTok Pixel (ttq)
 * Protecao contra disparos duplicados via event_id
 * Parametros otimizados com contents[] para melhor atribuicao
 */

// Registro de eventos disparados para evitar duplicatas
var _firedEvents = {};

// Produto padrao
var _defaultProduct = {
  content_id: 'tiktok_verificacao',
  content_name: 'Taxa de Verificacao TikTok',
  content_category: 'Verificacao',
  price: 12.97,
  quantity: 1
};

function _generateEventId(name, txId) {
  return txId ? name + '_' + txId : name + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

function _alreadyFired(name, txId) {
  if (!txId) return false;
  var key = name + '_' + txId;
  if (_firedEvents[key]) return true;
  _firedEvents[key] = true;
  return false;
}

/**
 * Dispara evento no TikTok Pixel via ttq
 */
function trackTikTokEvent(eventName, eventData) {
  if (typeof ttq !== 'undefined' && typeof ttq.track === 'function') {
    try {
      ttq.track(eventName, eventData || {});
    } catch (_) {}
  }
}

/**
 * Constroi o array contents[] padrao para otimizar atribuicao
 */
function _buildContents(overrides) {
  var product = {
    content_id: _defaultProduct.content_id,
    content_name: _defaultProduct.content_name,
    content_category: _defaultProduct.content_category,
    price: _defaultProduct.price,
    quantity: _defaultProduct.quantity
  };
  if (overrides) {
    for (var k in overrides) { product[k] = overrides[k]; }
  }
  return [product];
}

/**
 * ViewContent - quando a pagina carrega
 */
function trackPageView() {
  trackTikTokEvent('ViewContent', {
    content_type: 'product',
    content_id: _defaultProduct.content_id,
    content_name: _defaultProduct.content_name,
    contents: _buildContents(),
    value: _defaultProduct.price,
    currency: 'EUR'
  });
}

/**
 * Contact - quando o utilizador interage com o quiz (clica numa resposta)
 */
function trackContact() {
  trackTikTokEvent('Contact', {
    content_type: 'product',
    content_id: _defaultProduct.content_id,
    content_name: _defaultProduct.content_name,
    contents: _buildContents()
  });
}

/**
 * AddToCart - quando completa o quiz
 */
function trackAddToCart(totalReward) {
  trackTikTokEvent('AddToCart', {
    content_type: 'product',
    content_id: _defaultProduct.content_id,
    content_name: _defaultProduct.content_name,
    contents: _buildContents({ price: _defaultProduct.price }),
    value: _defaultProduct.price,
    currency: 'EUR',
    quantity: 1
  });
}

/**
 * InitiateCheckout - quando entra no checkout
 */
function trackInitiateCheckout(amount) {
  trackTikTokEvent('InitiateCheckout', {
    content_type: 'product',
    content_id: _defaultProduct.content_id,
    content_name: _defaultProduct.content_name,
    contents: _buildContents(),
    value: Number(amount) || _defaultProduct.price,
    currency: 'EUR',
    quantity: 1
  });
}

/**
 * GenerateLead - quando transacao e gerada
 */
function trackGenerateLead(method, amount, transactionId) {
  if (_alreadyFired('GenerateLead', transactionId)) return;
  trackTikTokEvent('GenerateLead', {
    content_type: 'product',
    content_id: _defaultProduct.content_id,
    content_name: _defaultProduct.content_name,
    contents: _buildContents(),
    value: Number(amount) || _defaultProduct.price,
    currency: 'EUR',
    description: method ? 'Metodo: ' + method : undefined
  });
}

/**
 * SubmitForm - quando submete o formulario de pagamento
 */
function trackSubmitForm(method) {
  trackTikTokEvent('SubmitForm', {
    content_type: 'product',
    content_id: _defaultProduct.content_id,
    content_name: _defaultProduct.content_name,
    contents: _buildContents(),
    description: method ? 'Metodo: ' + method : undefined
  });
}

/**
 * CompletePayment - quando pagamento e confirmado
 */
function trackCompletePayment(amount, transactionId) {
  if (_alreadyFired('CompletePayment', transactionId)) return;
  trackTikTokEvent('CompletePayment', {
    content_type: 'product',
    content_id: _defaultProduct.content_id,
    content_name: _defaultProduct.content_name,
    contents: _buildContents(),
    value: Number(amount) || _defaultProduct.price,
    currency: 'EUR',
    quantity: 1
  });
}

/**
 * Purchase - evento final de compra
 */
function trackPurchase(amount, transactionId) {
  if (_alreadyFired('Purchase', transactionId)) return;
  trackTikTokEvent('Purchase', {
    content_type: 'product',
    content_id: _defaultProduct.content_id,
    content_name: _defaultProduct.content_name,
    contents: _buildContents(),
    value: Number(amount) || _defaultProduct.price,
    currency: 'EUR',
    quantity: 1
  });
}

// Inicializar ViewContent quando DOM estiver pronto
(function() {
  var _contactFired = false;

  function init() {
    if (typeof ttq !== 'undefined' && typeof ttq.track === 'function') {
      trackPageView();
    } else {
      var attempts = 0;
      var iv = setInterval(function() {
        attempts++;
        if (typeof ttq !== 'undefined' && typeof ttq.track === 'function') {
          clearInterval(iv);
          trackPageView();
        } else if (attempts >= 15) {
          clearInterval(iv);
        }
      }, 400);
    }

    // Disparar Contact na primeira interacao com o quiz
    document.addEventListener('click', function handler(e) {
      if (_contactFired) return;
      var target = e.target;
      if (target.closest && (target.closest('.quiz-option') || target.closest('.quiz-answer') || target.closest('.option-btn'))) {
        _contactFired = true;
        trackContact();
        document.removeEventListener('click', handler);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
