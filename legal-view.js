// Páginas legais do ROI-NADOS (Privacidade e Termos) — exigidas na revisão de
// apps do TikTok for Business. Mesma identidade visual da LP.
// IMPORTANTE: template string — não usar crase nem ${ } dentro do HTML.

function legalShell(title, bodyHtml) {
  return '<!DOCTYPE html>' +
'<html lang="pt" class="dark">' +
'<head>' +
'<meta charset="utf-8" />' +
'<meta name="viewport" content="width=device-width, initial-scale=1" />' +
'<meta name="theme-color" content="#0a0a0b" />' +
'<title>' + title + ' — ROI-NADOS</title>' +
'<meta name="robots" content="index,follow" />' +
'<link rel="icon" href="/assets/roi-nados-logo.jpg" />' +
'<link rel="preconnect" href="https://fonts.googleapis.com" />' +
'<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />' +
'<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />' +
'<style>' +
':root{--bg:#0a0a0b;--card:#101013;--border:rgba(255,255,255,.07);--border2:rgba(255,255,255,.13);--text:#ededf0;--muted:#9d9da8;--muted2:#68686f;--cyan:#52a8ff}' +
'*{box-sizing:border-box}html,body{margin:0;padding:0}html{background:var(--bg)}' +
'body{background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.65;-webkit-font-smoothing:antialiased}' +
'a{color:var(--cyan);text-decoration:none}a:hover{text-decoration:underline}' +
'header{position:sticky;top:0;background:rgba(10,10,11,.85);backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}' +
'.hd{display:flex;align-items:center;gap:12px;padding:12px 24px;max-width:860px;margin:0 auto}' +
'.hd img{width:34px;height:34px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 2px rgba(255,255,255,.14)}' +
'.hd b{font-weight:800;font-size:17px;letter-spacing:.04em;background:linear-gradient(92deg,#ff3d7a,#6cb4ff 60%,#3ffcf6);-webkit-background-clip:text;background-clip:text;color:transparent}' +
'.hd .sp{flex:1}' +
'.hd a.back{color:var(--muted);font-size:13.5px;font-weight:600}' +
'main{max-width:860px;margin:0 auto;padding:48px 24px 80px}' +
'h1{font-size:clamp(26px,4vw,34px);letter-spacing:-.025em;margin:0 0 6px}' +
'.upd{color:var(--muted2);font-size:13px;margin:0 0 34px}' +
'h2{font-size:19px;letter-spacing:-.015em;margin:34px 0 10px}' +
'p,li{color:var(--muted);font-size:14.5px}' +
'ul{padding-left:22px;margin:8px 0}' +
'strong{color:var(--text)}' +
'.box{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin:24px 0}' +
'footer{border-top:1px solid var(--border);padding:26px 24px;text-align:center;color:var(--muted2);font-size:12.5px}' +
'</style></head><body>' +
'<header><div class="hd">' +
'<img src="/assets/roi-nados-logo.jpg" alt="Logo ROI-NADOS" />' +
'<b>ROI-NADOS</b><span class="sp"></span>' +
'<a class="back" href="/">&#8592; Voltar ao site</a>' +
'</div></header>' +
'<main>' + bodyHtml + '</main>' +
'<footer>&copy; 2026 ROI-NADOS &middot; Operado por PC Digital Ltda &middot; <a href="mailto:contact@roi-nados.top">contact@roi-nados.top</a></footer>' +
'</body></html>';
}

const privacyPage = legalShell('Pol\u00edtica de Privacidade',
'<h1>Pol\u00edtica de Privacidade</h1>' +
'<p class="upd">\u00daltima atualiza\u00e7\u00e3o: 1 de julho de 2026</p>' +
'<p>Esta Pol\u00edtica de Privacidade descreve como o <strong>ROI-NADOS</strong>, plataforma operada pela <strong>PC Digital Ltda</strong> ("n\u00f3s"), coleta, usa e protege informa\u00e7\u00f5es no dom\u00ednio <strong>roi-nados.top</strong> e em suas integra\u00e7\u00f5es com o TikTok for Business.</p>' +

'<h2>1. Quem somos</h2>' +
'<p>O ROI-NADOS \u00e9 uma ferramenta interna da PC Digital Ltda para monitoramento de contas de an\u00fancio do TikTok conectadas ao nosso Business Center e para rastreamento de convers\u00f5es das nossas pr\u00f3prias campanhas. Contato: <a href="mailto:contact@roi-nados.top">contact@roi-nados.top</a>.</p>' +

'<h2>2. Dados que coletamos</h2>' +
'<ul>' +
'<li><strong>Dados de contas de an\u00fancio (via TikTok Marketing API):</strong> saldos, status de contas, identificadores e informa\u00e7\u00f5es b\u00e1sicas do neg\u00f3cio, obtidos com autoriza\u00e7\u00e3o expressa via OAuth 2.0 nos escopos Ad Account Management e Ads Management.</li>' +
'<li><strong>Dados de navega\u00e7\u00e3o:</strong> p\u00e1ginas visitadas, pa\u00eds/cidade aproximados (derivados do IP), identificadores de campanha (UTM, ttclid) e eventos de funil (visita, checkout, compra).</li>' +
'<li><strong>Dados de convers\u00e3o:</strong> valor, moeda, identificador do pedido e e-mail informado ao gateway de pagamento, recebidos por webhook para atribui\u00e7\u00e3o de vendas.</li>' +
'</ul>' +

'<h2>3. Como usamos os dados</h2>' +
'<ul>' +
'<li>Monitorar as nossas pr\u00f3prias contas de an\u00fancio (saldo, status e sa\u00fade das contas) para gest\u00e3o e transpar\u00eancia internas.</li>' +
'<li>Mensurar convers\u00f5es das nossas campanhas via TikTok Events API, com dados pessoais transmitidos de forma <strong>hasheada (SHA-256)</strong>.</li>' +
'<li>Gerar m\u00e9tricas agregadas (funil, receita, aprova\u00e7\u00e3o) exibidas apenas no nosso painel interno, protegido por senha.</li>' +
'</ul>' +

'<div class="box"><p><strong>N\u00e3o vendemos, alugamos nem compartilhamos dados pessoais com terceiros.</strong> Os dados obtidos pela TikTok Marketing API s\u00e3o usados exclusivamente para operar as contas da pr\u00f3pria PC Digital Ltda e nunca s\u00e3o expostos publicamente.</p></div>' +

'<h2>4. Cookies e identificadores</h2>' +
'<p>Utilizamos um <strong>cookie primeiro-partido de identifica\u00e7\u00e3o de visitante</strong> (vid) nas p\u00e1ginas do funil, com a \u00fanica finalidade de costurar a jornada visita &rarr; checkout &rarr; compra para atribui\u00e7\u00e3o de convers\u00f5es. N\u00e3o usamos cookies de terceiros, cookies de publicidade cruzada entre sites nem fingerprinting para rastreamento entre dom\u00ednios. Par\u00e2metros de campanha (UTM, ttclid) s\u00e3o lidos da URL do pr\u00f3prio an\u00fancio. O painel administrativo usa um cookie de sess\u00e3o (HttpOnly, Secure, SameSite) exclusivamente para autentica\u00e7\u00e3o. Voc\u00ea pode bloquear ou apagar cookies no navegador; isso n\u00e3o impede a navega\u00e7\u00e3o, apenas a mensura\u00e7\u00e3o.</p>' +

'<h2>5. Base legal e reten\u00e7\u00e3o</h2>' +
'<p>Tratamos dados com base em leg\u00edtimo interesse (mensura\u00e7\u00e3o das pr\u00f3prias campanhas) e consentimento (autoriza\u00e7\u00e3o OAuth). <strong>Prazos:</strong> eventos de navega\u00e7\u00e3o e registros operacionais expiram automaticamente em at\u00e9 <strong>30 dias</strong> nos armazenamentos tempor\u00e1rios; dados de convers\u00e3o (pedido, valor, e-mail hasheado) s\u00e3o mantidos pelo per\u00edodo necess\u00e1rio \u00e0 an\u00e1lise e concilia\u00e7\u00e3o das campanhas. Endere\u00e7os IP s\u00e3o <strong>mascarados</strong> nos registros de auditoria e diagn\u00f3stico. Tokens de acesso s\u00e3o armazenados de forma segura e podem ser revogados a qualquer momento pelo titular da conta no TikTok for Business.</p>' +

'<h2>6. Seguran\u00e7a</h2>' +
'<p>Utilizamos comunica\u00e7\u00e3o HTTPS, segredos de webhook com compara\u00e7\u00e3o em tempo constante, hashing de dados pessoais antes de envio \u00e0 Events API e acesso ao painel restrito por senha.</p>' +

'<h2>7. Seus direitos</h2>' +
'<p>Voc\u00ea pode solicitar acesso, corre\u00e7\u00e3o ou exclus\u00e3o de dados pessoais escrevendo para <a href="mailto:contact@roi-nados.top">contact@roi-nados.top</a>. Responderemos em at\u00e9 15 dias \u00fateis.</p>' +

'<h2>8. Altera\u00e7\u00f5es</h2>' +
'<p>Podemos atualizar esta pol\u00edtica periodicamente. A vers\u00e3o vigente estar\u00e1 sempre dispon\u00edvel em <strong>roi-nados.top/privacidade</strong>.</p>');

const termsPage = legalShell('Termos de Servi\u00e7o',
'<h1>Termos de Servi\u00e7o</h1>' +
'<p class="upd">\u00daltima atualiza\u00e7\u00e3o: 1 de julho de 2026</p>' +
'<p>Estes Termos regem o uso da plataforma <strong>ROI-NADOS</strong> (roi-nados.top), operada pela <strong>PC Digital Ltda</strong>.</p>' +

'<h2>1. Natureza do servi\u00e7o</h2>' +
'<p>O ROI-NADOS \u00e9 uma ferramenta de uso <strong>interno</strong> da PC Digital Ltda destinada a: (a) monitorar contas de an\u00fancio do TikTok conectadas ao nosso Business Center por meio da TikTok Marketing API oficial; (b) rastrear convers\u00f5es das nossas pr\u00f3prias campanhas via TikTok Events API; e (c) consolidar m\u00e9tricas em painel administrativo protegido.</p>' +

'<h2>2. Uso da TikTok Marketing API</h2>' +
'<ul>' +
'<li>O acesso \u00e0s contas de an\u00fancio \u00e9 concedido exclusivamente pelo fluxo oficial de OAuth 2.0 do TikTok for Business.</li>' +
'<li>Utilizamos os escopos Ad Account Management e Ads Management apenas para consultar saldos, status e informa\u00e7\u00f5es b\u00e1sicas das contas autorizadas.</li>' +
'<li>Cumprimos os Termos de Servi\u00e7o do TikTok for Business e as pol\u00edticas da TikTok Marketing API.</li>' +
'<li>A autoriza\u00e7\u00e3o pode ser revogada a qualquer momento pelo titular da conta, sem preju\u00edzo.</li>' +
'</ul>' +

'<h2>3. Acesso ao painel</h2>' +
'<p>O painel administrativo \u00e9 restrito \u00e0 equipe da PC Digital Ltda mediante senha. \u00c9 vedado o compartilhamento de credenciais ou o uso da plataforma para monitorar contas de terceiros sem autoriza\u00e7\u00e3o.</p>' +

'<h2>4. Propriedade intelectual</h2>' +
'<p>Todo o conte\u00fado, marca e c\u00f3digo da plataforma pertencem \u00e0 PC Digital Ltda. "TikTok" \u00e9 marca de seus respectivos titulares; o ROI-NADOS n\u00e3o \u00e9 afiliado, endossado ou patrocinado pelo TikTok.</p>' +

'<h2>5. Limita\u00e7\u00e3o de responsabilidade</h2>' +
'<p>A plataforma \u00e9 fornecida "como est\u00e1". N\u00e3o nos responsabilizamos por indisponibilidades das APIs de terceiros (TikTok, gateways de pagamento) nem por decis\u00f5es tomadas com base nas m\u00e9tricas exibidas.</p>' +

'<h2>6. Contato e foro</h2>' +
'<p>D\u00favidas sobre estes Termos: <a href="mailto:contact@roi-nados.top">contact@roi-nados.top</a>. Estes Termos s\u00e3o regidos pelas leis brasileiras.</p>');

module.exports = { privacyPage, termsPage };
