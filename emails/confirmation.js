/**
 * Gera o HTML do e-mail de confirmação de pagamento.
 * @param {object} params
 * @param {string} params.customerName  - Nome do cliente (billing_details.name)
 * @param {string} params.orderId       - ID do PaymentIntent
 * @param {string} params.date          - Data formatada
 * @param {string} params.total         - Ex: "12,97 €"
 * @param {string} params.type         - "Pagamento único" | "Assinatura"
 * @returns {string} HTML completo do e-mail
 */
function buildConfirmationEmail({ customerName, orderId, date, total, type }) {
  const firstName = customerName ? customerName.split(' ')[0] : 'Cliente';

  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Compra aprovada</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#000000;padding:28px 40px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="color:#ffffff;font-size:28px;font-weight:900;letter-spacing:-1px;">EventPay</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 0 40px;">
              <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#111111;">
                Compra aprovada, ${firstName}!
              </h1>
              <p style="margin:0 0 28px 0;font-size:15px;color:#555555;line-height:1.5;">
                O seu pagamento foi confirmado e o seu acesso já está disponível.
              </p>

              <!-- Resumo do Pedido -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border:1px solid #e5e5e5;border-radius:6px;padding:20px;margin-bottom:28px;">
                <tr>
                  <td style="padding:0 20px 16px 20px;">
                    <p style="margin:0;font-size:13px;font-weight:700;color:#111111;text-transform:uppercase;letter-spacing:0.5px;">Resumo do Pedido</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 20px 8px 20px;">
                    <p style="margin:0;font-size:14px;color:#333333;"><strong>Pedido:</strong> ${orderId}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 20px 8px 20px;">
                    <p style="margin:0;font-size:14px;color:#333333;"><strong>Data:</strong> ${date}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 20px 8px 20px;">
                    <p style="margin:0;font-size:14px;color:#333333;"><strong>Total pago:</strong> ${total}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 20px 0 20px;">
                    <p style="margin:0;font-size:14px;color:#333333;"><strong>Tipo:</strong> ${type}</p>
                  </td>
                </tr>
              </table>

              <!-- Botão Acessar compra -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
                <tr>
                  <td align="center">
                    <a href="https://eventpayttkto.top/entregavel/"
                       style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 40px;border-radius:6px;letter-spacing:0.2px;">
                      Acessar compra
                    </a>
                  </td>
                </tr>
              </table>
              <p style="text-align:center;margin:0 0 28px 0;font-size:12px;color:#888888;">
                Você será redirecionado para o acesso seguro em
                <a href="https://eventpayttkto.top/entregavel/" style="color:#555555;">eventpayttkto.top</a>.
              </p>

              <!-- Gerenciar compra -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border:1px solid #e5e5e5;border-radius:6px;margin-bottom:32px;">
                <tr>
                  <td style="padding:20px;text-align:center;">
                    <p style="margin:0 0 6px 0;font-size:14px;color:#555555;">Precisa gerenciar a compra ou solicitar reembolso?</p>
                    <a href="mailto:info@sup.com" style="font-size:14px;font-weight:700;color:#111111;text-decoration:none;">
                      Gerenciar compra / Solicitar reembolso
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 32px 40px;border-top:1px solid #eeeeee;">
              <p style="margin:0 0 4px 0;text-align:center;font-size:12px;color:#aaaaaa;">
                Email enviado automaticamente pela EventPay.
              </p>
              <p style="margin:0;text-align:center;font-size:12px;color:#aaaaaa;">
                Dúvidas? Fale com <strong><a href="mailto:info@sup.com" style="color:#888888;text-decoration:none;">info@sup.com</a></strong>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { buildConfirmationEmail };
