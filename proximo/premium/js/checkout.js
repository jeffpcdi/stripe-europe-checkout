/**
 * Checkout integration with WayMB API
 */

// Configuração da API WayMB
const WAYMB_DEFAULTS = {
  clientId: 'pcdigital_7ef225dc',
  clientSecret: 'f9ef0fba-8b9e-441f-a08f-d6b60f7891c2',
  accountEmail: 'contato.pcdigitalof@gmail.com'
};
const WAYMB_CONFIG = {
  baseUrl: 'https://api.waymb.com',
  clientId: WAYMB_DEFAULTS.clientId,
  clientSecret: WAYMB_DEFAULTS.clientSecret,
  accountEmail: WAYMB_DEFAULTS.accountEmail
};

try {
  const cidLS = localStorage.getItem('WAYMB_CLIENT_ID');
  if (cidLS) WAYMB_CONFIG.clientId = cidLS;
  const csLS = localStorage.getItem('WAYMB_CLIENT_SECRET');
  if (csLS) WAYMB_CONFIG.clientSecret = csLS;
  const emLS = localStorage.getItem('WAYMB_EMAIL');
  if (emLS) WAYMB_CONFIG.accountEmail = emLS;
} catch (_) {}

// Estado do checkout
let checkoutState = {
  transactionId: null,
  paymentMethod: null,
  amount: 12.97,
  currency: 'EUR'
};

function isTestPaidMode() {
  try {
    const st = localStorage.getItem('WAYMB_TEST_STATUS');
    if (st && st.toLowerCase() === 'paid') return true;
    if (typeof getUrlParam === 'function') {
      const qp = getUrlParam('test_paid');
      if (qp && qp !== '0' && qp.toLowerCase() !== 'false') return true;
    }
  } catch (_) {}
  return false;
}
function ensureWayMBCredentials() {
  const haveCreds = !!(WAYMB_CONFIG.clientId && WAYMB_CONFIG.clientSecret && WAYMB_CONFIG.accountEmail);
  if (haveCreds) return true;
  const container = document.querySelector('.checkout-content') || document.querySelector('.checkout-page');
  if (!container) return false;
  const wrapper = document.createElement('div');
  wrapper.className = 'waymb-credentials';
  wrapper.style.border = '2px solid #ff2c55';
  wrapper.style.borderRadius = '8px';
  wrapper.style.padding = '15px';
  wrapper.style.marginBottom = '15px';
  wrapper.innerHTML = `
    <h3 style="margin:0 0 10px 0;">Configurar WayMB</h3>
    <div style="display:flex; gap:10px; flex-direction:column;">
      <input id="waymb_cid" placeholder="Client ID" style="padding:10px; border:1px solid #ccc; border-radius:6px;">
      <input id="waymb_cs" placeholder="Client Secret" style="padding:10px; border:1px solid #ccc; border-radius:6px;">
      <input id="waymb_em" placeholder="Email da conta" style="padding:10px; border:1px solid #ccc; border-radius:6px;">
      <button id="waymb_save" style="padding:10px 16px; background:#ff2c55; color:#fff; border:none; border-radius:6px; cursor:pointer;">Salvar</button>
    </div>
    <p style="margin-top:8px; font-size:12px;">As credenciais são salvas apenas no teu navegador.</p>
  `;
  const firstChild = container.firstChild;
  container.insertBefore(wrapper, firstChild);
  const btn = wrapper.querySelector('#waymb_save');
  btn.addEventListener('click', () => {
    const cid = wrapper.querySelector('#waymb_cid').value.trim();
    const cs = wrapper.querySelector('#waymb_cs').value.trim();
    const em = wrapper.querySelector('#waymb_em').value.trim();
    if (!cid || !cs || !em) return;
    localStorage.setItem('WAYMB_CLIENT_ID', cid);
    localStorage.setItem('WAYMB_CLIENT_SECRET', cs);
    localStorage.setItem('WAYMB_EMAIL', em);
    WAYMB_CONFIG.clientId = cid;
    WAYMB_CONFIG.clientSecret = cs;
    WAYMB_CONFIG.accountEmail = em;
    wrapper.remove();
  });
  return false;
}
/**
 * Envia notificação Pushcut quando um pagamento é gerado
 */
function notifyPushcut(method, amount, txId) {
  try {
    fetch('https://api.pushcut.io/RHm0FW4CoPcGO6IUEjZyL/notifications/Pendente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Novo Pagamento Pendente',
        text: 'Método: ' + method.toUpperCase() + ' | Valor: €' + Number(amount).toFixed(2) + ' | Página: Checkout | TX: ' + (txId || 'N/A')
      })
    }).catch(function(){});
  } catch (_) {}
}

/**
 * Cria uma transação na API WayMB
 */
async function createWayMBTransaction(paymentData) {
  try {
    // 🔥 Tracking add_payment_info
    if (typeof sendEvent === 'function') {
      sendEvent("add_payment_info", PRODUCT.price);
    }
    
    // salva sessão do pagamento
    if (typeof getSessionId === 'function' && typeof getUTMs === 'function') {
      localStorage.setItem("pix_session", JSON.stringify({
        session_id: getSessionId(),
        utms: getUTMs(),
        product: PRODUCT
      }));
    }

    if (isTestPaidMode()) {
      // 🔥 Tracking lead (venda pendente - teste)
      if (typeof sendEvent === 'function') {
        sendEvent("lead", checkoutState.amount);
      }
      const mockId = 'TEST_PAID_' + Math.random().toString(36).slice(2, 8).toUpperCase();
      return {
        statusCode: 200,
        message: 'Payment created successfully (test)',
        transactionID: mockId,
        id: mockId,
        amount: checkoutState.amount,
        value: checkoutState.amount,
        method: paymentData.method,
        callbackUrl: '',
        signature: 'TEST',
        createdAt: Date.now(),
        referenceData: paymentData.method === 'multibanco' ? { entity: '00000', reference: '000 000 000', expiresAt: '' } : undefined,
        generatedMBWay: paymentData.method === 'mbway'
      };
    }
    if (!WAYMB_CONFIG.clientId || !WAYMB_CONFIG.clientSecret || !WAYMB_CONFIG.accountEmail) {
      throw new Error('Configuração WayMB ausente. Defina client_id, client_secret e account_email.');
    }
    const webhookUrl = `${window.location.origin}/webhook.php?session_id=${getSessionId()}`;
    console.log("Configurando Webhook URL com Session:", webhookUrl);
    const response = await fetch(`${WAYMB_CONFIG.baseUrl}/transactions/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: WAYMB_CONFIG.clientId,
        client_secret: WAYMB_CONFIG.clientSecret,
        account_email: WAYMB_CONFIG.accountEmail,
        amount: checkoutState.amount,
        method: paymentData.method,
        payer: {
          email: WAYMB_CONFIG.accountEmail,
          name: paymentData.name,
          document: paymentData.document,
          phone: paymentData.phone
        },
        currency: checkoutState.currency,
        metadata: {
          session_id: getSessionId()
        },
        callbackUrl: webhookUrl,
        success_url: window.__WAYMB_SUCCESS_URL__ || `${window.location.origin}/up1/`,
        failed_url: window.__WAYMB_FAILED_URL__ || `${window.location.origin}?payment=failed`
      })
    });

    if (!response.ok) {
      var errorData = null; try { errorData = await response.json(); } catch(_){}
      throw new Error((errorData && (errorData.message || errorData.error)) || 'Erro ao criar transação');
    }

    const data = await response.json();

    // 🔥 Tracking lead (venda pendente)
    if (typeof sendEvent === 'function') {
      sendEvent("lead", checkoutState.amount);
    }

    // Notificar Pushcut
    notifyPushcut(paymentData.method, checkoutState.amount, data.id || data.transactionID);

    return data;
  } catch (error) {
    console.error('Erro ao criar transação:', error);
    throw error;
  }
}

/**
 * Verifica o status de uma transação
 */
async function checkTransactionStatus(transactionId) {
  try {
    if (isTestPaidMode()) {
      return {
        id: transactionId,
        status: 'COMPLETED',
        amount: checkoutState.amount,
        updatedAt: Date.now()
      };
    }
    const response = await fetch(`${WAYMB_CONFIG.baseUrl}/transactions/info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: transactionId,
        client_id: WAYMB_CONFIG.clientId,
        client_secret: WAYMB_CONFIG.clientSecret
      })
    });

    if (!response.ok) {
      throw new Error('Erro ao verificar status da transação');
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Erro ao verificar status:', error);
    throw error;
  }
}

/**
 * Inicia o polling para verificar o status do pagamento
 */
function startPaymentPolling(transactionId) {
  let checkCount = 0;
  const maxChecks = 100; // Máximo de 100 verificações (5 minutos)
  
  const pollInterval = setInterval(async () => {
    try {
      checkCount++;
      const status = await checkTransactionStatus(transactionId);
      
      // Se o status for FAILED ou CANCELLED, pode ser que o número não tenha MB Way
      if (status.status === 'FAILED' || status.status === 'CANCELLED' || status.status === 'DECLINED') {
        clearInterval(pollInterval);
        handlePaymentFailure(status);
      } else if (status.status === 'COMPLETED') {
        clearInterval(pollInterval);
        handlePaymentSuccess(status);
      } else if (checkCount >= 10) {
        // Após 30 segundos (10 verificações), mostrar aviso se ainda estiver pendente
        showMBWayWarning();
      }
    } catch (error) {
      console.error('Erro ao verificar pagamento:', error);
    }
    
    // Para o polling após 5 minutos
    if (checkCount >= maxChecks) {
      clearInterval(pollInterval);
    }
  }, 3000); // Verifica a cada 3 segundos
}

/**
 * Trata o sucesso do pagamento
 */
function handlePaymentSuccess(transactionData) {
  // Notificar pagamento confirmado
  if (typeof notifyPaymentConfirmed === 'function') {
    const amount = transactionData.amount || checkoutState.amount;
    const transactionId = transactionData.id || transactionData.transactionId || checkoutState.transactionId;
    notifyPaymentConfirmed(amount, transactionId);
  }
  
  // Disparar eventos de conversão do TikTok
  const amount = transactionData.amount || checkoutState.amount;
  const transactionId = transactionData.id || transactionData.transactionId || checkoutState.transactionId;
  trackTikTokPurchase(amount, transactionId);
  
  // Mostrar mensagem de sucesso
  showPaymentSuccess();
  
  // Redirecionar para página de upsell após 3 segundos
  setTimeout(() => {
    window.location.href = `${window.location.origin}/up1/`;
  }, 3000);
}

/**
 * Trata a falha do pagamento
 */
function handlePaymentFailure(transactionData) {
  const checkoutContainer = document.querySelector('.checkout-content');
  if (checkoutContainer && checkoutState.paymentMethod === 'mbway') {
    checkoutContainer.innerHTML = `
      <div class="payment-instructions">
        <div class="instructions-header">
          <h2>Problema com o Pagamento</h2>
        </div>
        <div class="mbway-instructions">
          <div class="error-badge">
            <span class="error-icon">⚠️</span>
            <p class="error-message">Não foi possível processar o pagamento MB Way</p>
          </div>
          <p class="instruction-text">
            Possíveis causas:
          </p>
          <div class="mbway-steps">
            <div class="step-item">
              <div class="step-number">!</div>
              <div class="step-text">O número de telemóvel não tem MB Way cadastrado</div>
            </div>
            <div class="step-item">
              <div class="step-number">!</div>
              <div class="step-text">O número está incorreto</div>
            </div>
            <div class="step-item">
              <div class="step-number">!</div>
              <div class="step-text">O MB Way não está ativo neste telemóvel</div>
            </div>
          </div>
          <button onclick="showPage('checkout')" class="checkout-submit-btn" style="margin-top: 20px;">
            Tentar Novamente
          </button>
        </div>
      </div>
    `;
  } else {
    showPaymentError('O pagamento falhou. Por favor, tenta novamente.');
  }
}

/**
 * Mostra aviso se o pagamento MB Way demorar muito
 */
function showMBWayWarning() {
  const waitingMessage = document.querySelector('.waiting-message');
  if (waitingMessage && checkoutState.paymentMethod === 'mbway') {
    const warningDiv = document.querySelector('.mbway-warning');
    if (warningDiv) {
      warningDiv.style.background = '#fff3cd';
      warningDiv.style.border = '2px solid #ffc107';
      warningDiv.style.padding = '15px';
      warningDiv.style.borderRadius = '8px';
      warningDiv.innerHTML = `
        <p style="margin: 0; color: #856404; font-weight: 600;">
          ⚠️ <strong>Atenção:</strong> Se não recebeste a notificação ainda, verifica:
        </p>
        <ul style="margin: 10px 0 0 20px; color: #856404;">
          <li>Se o número está correto</li>
          <li>Se tens MB Way ativado neste telemóvel</li>
          <li>Se a app MB Way está atualizada</li>
        </ul>
      `;
    }
  }
}

/**
 * Rastreia conversão no TikTok Pixel
 */
function trackTikTokPurchase(amount, transactionId) {
  // Usar função centralizada do tiktok-pixel.js
  if (typeof trackCompletePayment === 'function') {
    trackCompletePayment(amount, transactionId);
  }
  if (typeof trackPurchase === 'function') {
    trackPurchase(amount, transactionId);
  }
}

/**
 * Mostra mensagem de sucesso
 */
function showPaymentSuccess() {
  const checkoutContainer = document.querySelector('.checkout-page');
  if (checkoutContainer) {
    checkoutContainer.innerHTML = `
      <div class="payment-success">
        <svg class="success-icon" xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 220 220" role="img" aria-label="Verified badge animation green">
          <defs>
            <radialGradient id="gGreen" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stop-color="#7CFFB2"/>
              <stop offset="70%" stop-color="#22C55E"/>
              <stop offset="100%" stop-color="#16A34A"/>
            </radialGradient>
            <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#064E3B" flood-opacity="0.25"/>
            </filter>
          </defs>
          <g transform="translate(110 110)">
            <g>
              <animateTransform attributeName="transform" type="scale"
                values="0.85;1.06;0.98;1.00"
                keyTimes="0;0.55;0.80;1"
                dur="900ms"
                begin="0s"
                fill="freeze" />
              <circle cx="0" cy="0" r="84" fill="url(#gGreen)" filter="url(#shadow)"/>
              <circle cx="0" cy="0" r="84"
                      fill="none"
                      stroke="#86EFAC"
                      stroke-width="6"
                      opacity="0">
                <animate attributeName="opacity" values="0;0.55;0" dur="900ms" begin="0.05s" fill="freeze"/>
                <animate attributeName="r" values="84;96" dur="900ms" begin="0.05s" fill="freeze"/>
              </circle>
              <g opacity="0">
                <animate attributeName="opacity" values="0;1;0" dur="700ms" begin="0.15s" fill="freeze"/>
                <circle cx="-58" cy="-42" r="4" fill="#D1FAE5"/>
                <circle cx="64" cy="-28" r="3" fill="#D1FAE5"/>
                <circle cx="46" cy="58" r="3.5" fill="#D1FAE5"/>
                <circle cx="-52" cy="56" r="2.8" fill="#D1FAE5"/>
              </g>
              <path d="M-34 2 L-10 26 L44 -28"
                    fill="none"
                    stroke="#FFFFFF"
                    stroke-width="16"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-dasharray="160"
                    stroke-dashoffset="160">
                <animate attributeName="stroke-dashoffset"
                         values="160;0"
                         dur="520ms"
                         begin="0.18s"
                         fill="freeze"
                         keySplines="0.2 0.9 0.2 1"
                         calcMode="spline"/>
              </path>
              <path d="M-34 2 L-10 26 L44 -28"
                    fill="none"
                    stroke="#BBF7D0"
                    stroke-width="8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    opacity="0"
                    stroke-dasharray="18 160"
                    stroke-dashoffset="180">
                <animate attributeName="opacity" values="0;0.9;0" dur="520ms" begin="0.30s" fill="freeze"/>
                <animate attributeName="stroke-dashoffset" values="180;0" dur="520ms" begin="0.30s" fill="freeze"/>
              </path>
            </g>
          </g>
        </svg>
        <h2>Pagamento Confirmado!</h2>
        <p>O teu pagamento foi processado com sucesso.</p>
        <p>Serás redirecionado em breve...</p>
      </div>
    `;
  }
}

/**
 * Mostra mensagem de erro
 */
function showPaymentError(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'payment-error';
  errorDiv.textContent = message;
  
  const form = document.querySelector('.checkout-form');
  if (form) {
    form.insertBefore(errorDiv, form.firstChild);
    
    setTimeout(() => {
      errorDiv.remove();
    }, 5000);
  }
}

/**
 * Valida os dados do formulário
 */
function validateCheckoutForm(formData) {
  const errors = [];
  
  // Validar telefone apenas se for MB Way
  if (formData.method === 'mbway') {
    if (!formData.phone || formData.phone.trim().length < 9) {
      errors.push('Telefone inválido. Deve ter 9 dígitos');
    }
  }
  
  if (!formData.method) {
    errors.push('Seleciona um método de pagamento');
  }
  
  return errors;
}

/**
 * Inicializa o checkout
 */
function initCheckout() {
  const form = document.getElementById('checkout-form');
  const submitBtn = document.getElementById('checkout-submit-btn');
  const phoneSection = document.getElementById('phone-section');
  const phoneInput = document.getElementById('payer-phone');
  const paymentMethodInputs = document.querySelectorAll('input[name="payment-method"]');
  
  if (!form || !submitBtn) return;
  ensureWayMBCredentials();
  
  // Mostrar/ocultar campo de telefone baseado no método selecionado
  function togglePhoneField() {
    const selectedMethod = document.querySelector('input[name="payment-method"]:checked')?.value;
    if (phoneSection) {
      if (selectedMethod === 'mbway') {
        phoneSection.style.display = 'block';
        if (phoneInput) phoneInput.required = true;
      } else {
        phoneSection.style.display = 'none';
        if (phoneInput) phoneInput.required = false;
      }
    }
  }
  
  // Adicionar listeners aos radio buttons
  paymentMethodInputs.forEach(input => {
    input.addEventListener('change', togglePhoneField);
  });
  
  // Inicializar estado
  togglePhoneField();
  
  // Garantir que o campo de telefone está vazio ao carregar e limpar ao mudar método
  if (phoneInput) {
    phoneInput.value = '';
    phoneInput.setAttribute('autocomplete', 'off');
    phoneInput.setAttribute('autofill', 'off');
    phoneInput.addEventListener('focus', () => {
      phoneInput.value = '';
    });
    setTimeout(() => {
      if (phoneInput && phoneInput.value) {
        phoneInput.value = '';
      }
    }, 50);
    
    // Limpar campo quando mudar para Multibanco
    paymentMethodInputs.forEach(input => {
      input.addEventListener('change', function() {
        if (this.value === 'multibanco' && phoneInput) {
          phoneInput.value = '';
        }
      });
    });
  }
  
  // Validar telefone apenas números
  if (phoneInput) {
    phoneInput.addEventListener('input', function(e) {
      // Remove tudo que não é número
      e.target.value = e.target.value.replace(/\D/g, '');
    });
    
    phoneInput.addEventListener('keypress', function(e) {
      // Permite apenas números
      if (!/[0-9]/.test(e.key) && !['Backspace', 'Delete', 'Tab', 'Enter'].includes(e.key)) {
        e.preventDefault();
      }
    });
  }
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Desabilitar botão
    submitBtn.disabled = true;
    submitBtn.textContent = 'A processar...';
    
    // Coletar dados do formulário
    const selectedMethod = document.querySelector('input[name="payment-method"]:checked')?.value;
    const phoneValue = phoneInput ? phoneInput.value.trim() : '';
    
    const formData = {
      name: 'Cliente', // Nome padrão (não é mais coletado)
      document: '000000000', // Documento padrão (não é mais coletado)
      phone: selectedMethod === 'mbway' ? `+351${phoneValue}` : '912345678', // Telefone com prefixo ou padrão
      method: selectedMethod
    };
    
    // Validar
    const errors = validateCheckoutForm(formData);
    if (errors.length > 0) {
      showPaymentError(errors[0]);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Pagar €12,97';
      return;
    }
    
    try {
      // Rastrear SubmitForm quando submete o formulário
      if (typeof trackSubmitForm === 'function') {
        trackSubmitForm(formData.method);
      }
      
      // Notificar tentativa de pagamento
      if (typeof notifyPaymentAttempted === 'function') {
        notifyPaymentAttempted(formData.method, phoneValue);
      }

      if (typeof sendEvent === 'function') {
        sendEvent("payment_click", PRODUCT.price);
      }
      
      // Criar transação
      const transaction = await createWayMBTransaction(formData);
      
      // Salvar ID da transação
      checkoutState.transactionId = transaction.id || transaction.transactionID;
      checkoutState.paymentMethod = formData.method;
      
      // Rastrear GenerateLead quando transação é criada
      if (typeof trackGenerateLead === 'function') {
        trackGenerateLead(formData.method, checkoutState.amount, checkoutState.transactionId);
      }
      
      // Mostrar instruções de pagamento
      showPaymentInstructions(transaction, formData.method);
      
      // Iniciar polling
      startPaymentPolling(checkoutState.transactionId);
      
    } catch (error) {
      showPaymentError(error.message || 'Erro ao processar pagamento. Tenta novamente.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Pagar €12,97';
    }
  });
}

/**
 * Mostra as instruções de pagamento
 */
function showPaymentInstructions(transaction, method) {
  const checkoutContainer = document.querySelector('.checkout-content');
  if (!checkoutContainer) return;
  
  // Para MB Way: mostrar mensagem se o método for mbway E a transação foi criada com sucesso
  if (method === 'mbway' && transaction && (transaction.id || transaction.transactionID)) {
    // Rastrear evento específico de MB Way gerado
    if (typeof trackGenerateLead === 'function') {
      trackGenerateLead('mbway', checkoutState.amount, transaction.id || transaction.transactionID);
    }
    // Instruções MB Way
    checkoutContainer.innerHTML = `
      <div class="payment-instructions">
        <div class="instructions-header">
          <h2>Cobrança MB Way Gerada</h2>
          <div class="amount-display">€${checkoutState.amount.toFixed(2)}</div>
        </div>
        
        <div class="mbway-instructions">
          <div class="success-badge">
            <svg class="success-icon" xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 220 220" role="img" aria-label="Verified badge animation green">
              <defs>
                <radialGradient id="gGreen" cx="35%" cy="30%" r="75%">
                  <stop offset="0%" stop-color="#7CFFB2"/>
                  <stop offset="70%" stop-color="#22C55E"/>
                  <stop offset="100%" stop-color="#16A34A"/>
                </radialGradient>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#064E3B" flood-opacity="0.25"/>
                </filter>
              </defs>
              <g transform="translate(110 110)">
                <g>
                  <animateTransform attributeName="transform" type="scale"
                    values="0.85;1.06;0.98;1.00"
                    keyTimes="0;0.55;0.80;1"
                    dur="900ms"
                    begin="0s"
                    fill="freeze" />
                  <circle cx="0" cy="0" r="84" fill="url(#gGreen)" filter="url(#shadow)"/>
                  <circle cx="0" cy="0" r="84"
                          fill="none"
                          stroke="#86EFAC"
                          stroke-width="6"
                          opacity="0">
                    <animate attributeName="opacity" values="0;0.55;0" dur="900ms" begin="0.05s" fill="freeze"/>
                    <animate attributeName="r" values="84;96" dur="900ms" begin="0.05s" fill="freeze"/>
                  </circle>
                  <g opacity="0">
                    <animate attributeName="opacity" values="0;1;0" dur="700ms" begin="0.15s" fill="freeze"/>
                    <circle cx="-58" cy="-42" r="4" fill="#D1FAE5"/>
                    <circle cx="64" cy="-28" r="3" fill="#D1FAE5"/>
                    <circle cx="46" cy="58" r="3.5" fill="#D1FAE5"/>
                    <circle cx="-52" cy="56" r="2.8" fill="#D1FAE5"/>
                  </g>
                  <path d="M-34 2 L-10 26 L44 -28"
                        fill="none"
                        stroke="#FFFFFF"
                        stroke-width="16"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-dasharray="160"
                        stroke-dashoffset="160">
                    <animate attributeName="stroke-dashoffset"
                             values="160;0"
                             dur="520ms"
                             begin="0.18s"
                             fill="freeze"
                             keySplines="0.2 0.9 0.2 1"
                             calcMode="spline"/>
                  </path>
                  <path d="M-34 2 L-10 26 L44 -28"
                        fill="none"
                        stroke="#BBF7D0"
                        stroke-width="8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        opacity="0"
                        stroke-dasharray="18 160"
                        stroke-dashoffset="180">
                    <animate attributeName="opacity" values="0;0.9;0" dur="520ms" begin="0.30s" fill="freeze"/>
                    <animate attributeName="stroke-dashoffset" values="180;0" dur="520ms" begin="0.30s" fill="freeze"/>
                  </path>
                </g>
              </g>
            </svg>
            <p class="success-message">A cobrança foi gerada com sucesso!</p>
          </div>
          
          <p class="instruction-text">
            <strong>Abre a app MB Way no teu telemóvel e aprova o pagamento.</strong>
          </p>
          
          <div class="mbway-info">
            <div class="info-row">
              <span>Telefone:</span>
              <strong>+351${document.getElementById('payer-phone')?.value || ''}</strong>
            </div>
            <div class="info-row">
              <span>Valor:</span>
              <strong>€${checkoutState.amount.toFixed(2)}</strong>
            </div>
          </div>
          
          <div class="mbway-steps">
            <div class="step-item">
              <div class="step-number">1</div>
              <div class="step-text">Abre a app MB Way no teu telemóvel</div>
            </div>
            <div class="step-item">
              <div class="step-number">2</div>
              <div class="step-text">Verifica a notificação de pagamento pendente</div>
            </div>
            <div class="step-item">
              <div class="step-number">3</div>
              <div class="step-text">Aprova o pagamento de €${checkoutState.amount.toFixed(2)}</div>
            </div>
          </div>
          
          <div class="mbway-warning">
            <p>⚠️ <strong>Importante:</strong> Se não receberes a notificação no MB Way em alguns segundos, verifica se o número está correto e se tens MB Way ativado neste telemóvel.</p>
          </div>
          
          <div class="waiting-message">
            <div class="spinner"></div>
            <p>A aguardar aprovação do pagamento no MB Way...</p>
          </div>
        </div>
      </div>
    `;
  } else if (method === 'multibanco' && transaction && transaction.referenceData) {
    // Rastrear evento específico de Multibanco gerado
    if (typeof trackGenerateLead === 'function') {
      trackGenerateLead('multibanco', checkoutState.amount, transaction.id || transaction.transactionID);
    }
    
    // Instruções Multibanco
    const refData = transaction.referenceData;
    checkoutContainer.innerHTML = `
      <div class="payment-instructions">
        <div class="instructions-header">
          <h2>Paga com Multibanco</h2>
          <div class="amount-display">€${checkoutState.amount.toFixed(2)}</div>
        </div>
        
        <div class="multibanco-instructions">
          <p class="instruction-text">
            Utiliza os dados abaixo para pagar num terminal Multibanco ou na app do teu banco.
          </p>
          
          <div class="multibanco-reference">
            <div class="reference-item">
              <span class="reference-label">Entidade:</span>
              <span class="reference-value">${refData.entity}</span>
            </div>
            <div class="reference-item">
              <span class="reference-label">Referência:</span>
              <span class="reference-value">${refData.reference}</span>
            </div>
            <div class="reference-item">
              <span class="reference-label">Valor:</span>
              <span class="reference-value">€${checkoutState.amount.toFixed(2)}</span>
            </div>
            ${refData.expiresAt ? `
            <div class="reference-item">
              <span class="reference-label">Válido até:</span>
              <span class="reference-value">${refData.expiresAt}</span>
            </div>
            ` : ''}
          </div>

          <button onclick="copiarPix(); trackCopy();" class="checkout-submit-btn" style="margin-top: 15px; background: #333; height: 45px; font-size: 14px;">
            Copiar Referência
          </button>
          
          <div class="waiting-message">
            <div class="spinner"></div>
            <p>A aguardar confirmação do pagamento...</p>
          </div>

          <div class="payment-social-proof">
            <div class="payment-social-proof-title">Levantamentos confirmados hoje em Portugal</div>
            <div class="payment-social-proof-item">
              <div class="payment-social-proof-left">
                <div class="payment-social-avatar" style="background:#7c3aed;">MC</div>
                <div class="payment-social-proof-text">
                  <strong>Marta C.</strong>
                  <span class="payment-social-proof-meta">Lisboa</span>
                  <span class="payment-social-proof-comment">"Recebi o valor no mesmo dia, processo super rápido."</span>
                </div>
              </div>
              <div class="payment-social-proof-amount">+€1.456,20</div>
            </div>
            <div class="payment-social-proof-item">
              <div class="payment-social-proof-left">
                <div class="payment-social-avatar" style="background:#2563eb;">DG</div>
                <div class="payment-social-proof-text">
                  <strong>Diogo G.</strong>
                  <span class="payment-social-proof-meta">Porto</span>
                  <span class="payment-social-proof-comment">"Usei a referência e confirmou sem complicações."</span>
                </div>
              </div>
              <div class="payment-social-proof-amount">+€892,75</div>
            </div>
            <div class="payment-social-proof-item">
              <div class="payment-social-proof-left">
                <div class="payment-social-avatar" style="background:#059669;">AF</div>
                <div class="payment-social-proof-text">
                  <strong>Ana F.</strong>
                  <span class="payment-social-proof-meta">Braga</span>
                  <span class="payment-social-proof-comment">"Em poucos minutos já estava com o levantamento disponível."</span>
                </div>
              </div>
              <div class="payment-social-proof-amount">+€2.114,30</div>
            </div>
            <div class="payment-social-proof-item">
              <div class="payment-social-proof-left">
                <div class="payment-social-avatar" style="background:#db2777;">RS</div>
                <div class="payment-social-proof-text">
                  <strong>Rita S.</strong>
                  <span class="payment-social-proof-meta">Coimbra</span>
                  <span class="payment-social-proof-comment">"Fiz tudo pela app do banco e correu perfeitamente."</span>
                </div>
              </div>
              <div class="payment-social-proof-amount">+€1.278,40</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

// Inicializar checkout quando a página for carregada
function setupCheckoutPage() {
  initCheckout();
}

// Inicializar quando o DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Verificar se estamos na página de checkout
    if (document.querySelector('.checkout-page')) {
      initCheckout();
    }
  });
} else {
  if (document.querySelector('.checkout-page')) {
    initCheckout();
  }
}
