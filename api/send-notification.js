/**
 * Notification helper for Solare Checkout
 * Sends emails via Resend and SMS via Twilio
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_FROM = process.env.TWILIO_PHONE_FROM;
const FROM_EMAIL = process.env.FROM_EMAIL || '';
const SITE_URL = process.env.SITE_URL || '';
const SITE_HOSTNAME = SITE_URL.replace(/^https?:\/\//, '');
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '';

// ─────────────────────────────────────────────
// Email Templates
// ─────────────────────────────────────────────

function approvedEmailHTML({ customerName, totalPrice, shippingMethod, orderId }) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f7f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">

        <!-- Header -->
        <tr><td style="background:#1a3c34;padding:32px;text-align:center;">
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;letter-spacing:-0.5px;">🌞 Solare</h1>
          <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">${SITE_HOSTNAME}</p>
        </td></tr>

        <!-- Confirmed Badge -->
        <tr><td style="padding:32px 40px 0;text-align:center;">
          <div style="display:inline-block;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:50px;padding:10px 24px;margin-bottom:20px;">
            <span style="color:#16a34a;font-weight:700;font-size:14px;">✅ Pagamento Confirmado</span>
          </div>
          <h2 style="color:#1a1a1a;margin:0 0 8px;font-size:24px;">Pedido aprovado, ${escapeHtml(customerName.split(' ')[0])}! 🎉</h2>
          <p style="color:#6b7280;font-size:15px;margin:0 0 28px;line-height:1.6;">
            Recebemos o seu pagamento e seu pedido já está sendo preparado com carinho.
          </p>
        </td></tr>

        <!-- Order Details -->
        <tr><td style="padding:0 40px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid #e5e7eb;">
                <span style="font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Número do Pedido</span><br>
                <span style="font-size:15px;color:#1a1a1a;font-weight:700;">#${orderId}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid #e5e7eb;">
                <span style="font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Produto</span><br>
                <span style="font-size:15px;color:#1a1a1a;font-weight:700;">Luminária Solar Solare</span>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid #e5e7eb;">
                <span style="font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Método de Envio</span><br>
                <span style="font-size:15px;color:#1a1a1a;font-weight:700;">${shippingMethod || 'Envio Regular'}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 20px;">
                <span style="font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total Pago</span><br>
                <span style="font-size:20px;color:#1a3c34;font-weight:800;">R$ ${parseFloat(totalPrice).toFixed(2).replace('.', ',')}</span>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="padding:0 40px 40px;text-align:center;">
          <p style="color:#6b7280;font-size:14px;margin:0 0 20px;line-height:1.6;">
            Você receberá uma atualização assim que seu pedido for enviado.
            Em caso de dúvidas, entre em contato conosco.
          </p>
          <p style="color:#9ca3af;font-size:12px;margin:0;">© 2025 Solare · ${SITE_HOSTNAME}</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function orderPreparingEmailHTML({ customerName, orderId }) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f7f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">

        <tr><td style="background:#1a3c34;padding:32px;text-align:center;">
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">🌞 Solare</h1>
          <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">${SITE_HOSTNAME}</p>
        </td></tr>

        <tr><td style="padding:32px 40px;text-align:center;">
          <div style="font-size:48px;margin-bottom:16px;">📦</div>
          <h2 style="color:#1a1a1a;margin:0 0 12px;font-size:22px;">Seu pedido está sendo preparado, ${escapeHtml(customerName.split(' ')[0])}!</h2>
          <p style="color:#6b7280;font-size:15px;margin:0 0 16px;line-height:1.7;">
            Ótima notícia! Seu pedido <strong>#${orderId}</strong> já está sendo separado e embalado com todo cuidado pela nossa equipe.
          </p>
          <p style="color:#6b7280;font-size:15px;margin:0 0 28px;line-height:1.7;">
            Em breve você receberá uma nova atualização com o código de rastreamento. Fique de olho no seu e-mail! 😊
          </p>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;text-align:left;">
            <p style="margin:0;color:#16a34a;font-weight:700;font-size:14px;">✅ Status atual: Preparando seu pedido</p>
          </div>
        </td></tr>

        <tr><td style="padding:0 40px 40px;text-align:center;">
          <p style="color:#9ca3af;font-size:12px;margin:0;line-height:1.6;">
            © 2025 Solare · ${SITE_HOSTNAME}
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function orderShippingEmailHTML({ customerName, orderId }) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f7f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">

        <tr><td style="background:#1a3c34;padding:32px;text-align:center;">
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">🌞 Solare</h1>
          <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">${SITE_HOSTNAME}</p>
        </td></tr>

        <tr><td style="padding:32px 40px;text-align:center;">
          <div style="font-size:48px;margin-bottom:16px;">🚚</div>
          <h2 style="color:#1a1a1a;margin:0 0 12px;font-size:22px;">Seu pedido está a caminho, ${escapeHtml(customerName.split(' ')[0])}!</h2>
          <p style="color:#6b7280;font-size:15px;margin:0 0 16px;line-height:1.7;">
            Seu pedido <strong>#${orderId}</strong> foi processado com sucesso e já está sendo encaminhado para entrega. Logo você vai receber sua Luminária Solar Solare! 🌞
          </p>
          <p style="color:#6b7280;font-size:15px;margin:0 0 28px;line-height:1.7;">
            Qualquer dúvida sobre o seu pedido, nossa equipe está pronta para te ajudar!
          </p>
          <a href="https://wa.me/55${WHATSAPP_NUMBER}?text=Oi!%20Tenho%20uma%20d%C3%BAvida%20sobre%20meu%20pedido%20%23${orderId}"
             style="display:inline-block;background:#25D366;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;">
            💬 Falar com o Suporte no WhatsApp
          </a>
        </td></tr>

        <tr><td style="padding:0 40px 40px;text-align:center;">
          <p style="color:#9ca3af;font-size:12px;margin:0;line-height:1.6;">
            © 2025 Solare · ${SITE_HOSTNAME}
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function pixExpiredEmailHTML({ customerName }) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f7f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">

        <tr><td style="background:#1a3c34;padding:32px;text-align:center;">
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">🌞 Solare</h1>
          <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">${SITE_HOSTNAME}</p>
        </td></tr>

        <tr><td style="padding:32px 40px;text-align:center;">
          <div style="font-size:48px;margin-bottom:16px;">⏱️</div>
          <h2 style="color:#1a1a1a;margin:0 0 12px;font-size:22px;">Seu Pix expirou, ${escapeHtml(customerName.split(' ')[0])}.</h2>
          <p style="color:#6b7280;font-size:15px;margin:0 0 28px;line-height:1.7;">
            O código Pix gerado expirou sem pagamento confirmado.
            Mas fique tranquilo — seus produtos continuam disponíveis!
          </p>
          <a href="${SITE_URL}"
             style="display:inline-block;background:#4CAF50;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;">
            Finalizar Compra Novamente
          </a>
        </td></tr>

        <tr><td style="padding:0 40px 40px;text-align:center;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">© 2025 Solare · ${SITE_HOSTNAME}</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function pixReminderEmailHTML({ customerName, pixCode }) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f7f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">

        <tr><td style="background:#1a3c34;padding:28px 32px;text-align:center;">
          <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;">🌞 Solare</h1>
          <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">${SITE_HOSTNAME}</p>
        </td></tr>

        <tr><td style="padding:32px 40px;text-align:center;">
          <div style="font-size:44px;margin-bottom:12px;">⏳</div>
          <h2 style="color:#1a1a1a;margin:0 0 10px;font-size:22px;">
            Seu Pix está esperando, ${escapeHtml(customerName.split(' ')[0])}!
          </h2>
          <p style="color:#6b7280;font-size:15px;margin:0 0 24px;line-height:1.7;">
            Identificamos que você gerou um Pix mas ainda não concluiu o pagamento.<br>
            O código expira em <strong>30 minutos</strong> — não perca seu pedido!
          </p>
          ${pixCode ? `
          <div style="background:#f8fafc;border:1px dashed #d1d5db;border-radius:10px;padding:16px;margin-bottom:24px;word-break:break-all;font-size:12px;color:#374151;font-family:monospace;text-align:left;">
            <p style="margin:0 0 6px;font-size:11px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Código Pix Copia e Cola</p>
            ${pixCode}
          </div>
          ` : ''}
          <a href="${SITE_URL}"
             style="display:inline-block;background:#4CAF50;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;">
            Pagar Agora
          </a>
        </td></tr>

        <tr><td style="padding:0 40px 32px;text-align:center;">
          <p style="color:#9ca3af;font-size:12px;margin:0;line-height:1.6;">
            Se você já realizou o pagamento, por favor ignore este e-mail.<br>
            © 2025 Solare · ${SITE_HOSTNAME}
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function pixReminder2hEmailHTML({ customerName }) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f7f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">

        <tr><td style="background:#1a3c34;padding:28px 32px;text-align:center;">
          <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;">🌞 Solare</h1>
          <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">${SITE_HOSTNAME}</p>
        </td></tr>

        <tr><td style="padding:32px 40px;text-align:center;">
          <div style="font-size:44px;margin-bottom:12px;">🔔</div>
          <h2 style="color:#1a1a1a;margin:0 0 10px;font-size:22px;">
            ${escapeHtml(customerName.split(' ')[0])}, sua luminária ainda está te esperando!
          </h2>
          <p style="color:#6b7280;font-size:15px;margin:0 0 24px;line-height:1.7;">
            Você demonstrou interesse na nossa <strong>Luminária Solar Solare</strong> mas ainda não finalizou o pagamento.
            Não deixe ela escapar! O estoque é limitado e a promoção pode acabar a qualquer momento.
          </p>
          <a href="${SITE_URL}"
             style="display:inline-block;background:#4CAF50;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;">
            Garantir Meu Pedido Agora
          </a>
        </td></tr>

        <tr><td style="padding:0 40px 32px;text-align:center;">
          <p style="color:#9ca3af;font-size:12px;margin:0;line-height:1.6;">
            Se você já realizou o pagamento, por favor ignore este e-mail.<br>
            © 2025 Solare · ${SITE_HOSTNAME}
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function pixReminder4hEmailHTML({ customerName }) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f7f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">

        <tr><td style="background:#b91c1c;padding:28px 32px;text-align:center;">
          <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;">🌞 Solare</h1>
          <p style="color:rgba(255,255,255,0.8);margin:6px 0 0;font-size:13px;">${SITE_HOSTNAME}</p>
        </td></tr>

        <tr><td style="padding:32px 40px;text-align:center;">
          <div style="font-size:44px;margin-bottom:12px;">🚨</div>
          <h2 style="color:#b91c1c;margin:0 0 10px;font-size:22px;">
            Última chance, ${escapeHtml(customerName.split(' ')[0])}!
          </h2>
          <p style="color:#6b7280;font-size:15px;margin:0 0 16px;line-height:1.7;">
            Você está prestes a perder a promoção da <strong>Luminária Solar Solare</strong>.
          </p>
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:20px;margin-bottom:24px;">
            <p style="margin:0;color:#b91c1c;font-weight:700;font-size:15px;">⚠️ Estoque muito limitado</p>
            <p style="margin:8px 0 0;color:#6b7280;font-size:14px;">Não garantimos a disponibilidade por mais tempo.</p>
          </div>
          <a href="${SITE_URL}"
             style="display:inline-block;background:#b91c1c;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:15px;">
            Aproveitar Promoção Antes que Acabe
          </a>
        </td></tr>

        <tr><td style="padding:0 40px 32px;text-align:center;">
          <p style="color:#9ca3af;font-size:12px;margin:0;line-height:1.6;">
            Se você já realizou o pagamento, por favor ignore este e-mail.<br>
            © 2025 Solare · ${SITE_HOSTNAME}
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// Email Sender (Resend)
// ─────────────────────────────────────────────

export async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn('[Notifications] RESEND_API_KEY not set, skipping email.');
    return;
  }
  try {
    console.log(`[Resend] Attempting to send email from ${FROM_EMAIL} to ${to}...`);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[Resend Error Response]', JSON.stringify(data, null, 2));
    } else {
      console.log('[Resend Success]', data.id);
    }
  } catch (e) {
    console.error('[Resend Exception]', e.message);
  }
}

async function scheduleEmail({ to, subject, html, delayMs }) {
  if (!RESEND_API_KEY) return null;
  const scheduled_at = new Date(Date.now() + delayMs).toISOString();
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html, scheduled_at }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[Resend] Schedule error:', JSON.stringify(data));
      return null;
    }
    console.log(`[Resend] Scheduled email (${Math.round(delayMs/60000)}min) — id:`, data.id);
    return data.id;
  } catch (e) {
    console.error('[Resend] Schedule exception:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// SMS Sender (Twilio)
// ─────────────────────────────────────────────

export async function sendSMS({ to, message }) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_FROM) {
    console.warn('[Notifications] Twilio credentials not set, skipping SMS.');
    return;
  }
  try {
    const body = new URLSearchParams({
      From: TWILIO_PHONE_FROM,
      To: to,
      Body: message,
    });
    const credentials = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const err = await res.json();
      console.error('[Twilio Error]', err);
    } else {
      console.log('[Twilio] SMS sent to', to);
    }
  } catch (e) {
    console.error('[Twilio Exception]', e);
  }
}

// ─────────────────────────────────────────────
// High-Level Notification Functions
// ─────────────────────────────────────────────

export async function notifyPaymentApproved({ customerName, customerEmail, customerPhone, totalPrice, shippingMethod, orderId }) {
  const subject = `✅ Pedido confirmado — Solare #${orderId}`;
  const html = approvedEmailHTML({ customerName, totalPrice, shippingMethod, orderId });

  await sendEmail({ to: customerEmail, subject, html });

  if (customerPhone) {
    const phoneE164 = '+55' + customerPhone.replace(/\D/g, '');
    await sendSMS({
      to: phoneE164,
      message: `🌞 Solare: Pedido #${orderId} confirmado! Valor: R$ ${parseFloat(totalPrice).toFixed(2).replace('.', ',')}. Obrigado pela compra!`,
    });
  }
}

/**
 * Agenda emails pós-compra para compradores:
 * - 3 horas após a compra: "Pedido sendo preparado"
 * - 2 dias após a compra: "Pedido a caminho + WhatsApp suporte"
 */
export async function schedulePostPurchaseEmails({ customerName, customerEmail, orderId }) {
  const h3 = 3 * 60 * 60 * 1000;
  const d2 = 2 * 24 * 60 * 60 * 1000;

  await scheduleEmail({
    to: customerEmail,
    subject: `📦 Seu pedido #${orderId} está sendo preparado — Solare`,
    html: orderPreparingEmailHTML({ customerName, orderId }),
    delayMs: h3,
  }).catch(e => console.error('schedulePostPurchase 3h failed:', e));

  await scheduleEmail({
    to: customerEmail,
    subject: `🚚 Seu pedido #${orderId} está a caminho — Solare`,
    html: orderShippingEmailHTML({ customerName, orderId }),
    delayMs: d2,
  }).catch(e => console.error('schedulePostPurchase 2d failed:', e));
}

export async function notifyPixExpired({ customerName, customerEmail }) {
  const subject = `⏱️ Seu Pix expirou — finalize sua compra na Solare`;
  const html = pixExpiredEmailHTML({ customerName });
  await sendEmail({ to: customerEmail, subject, html });
}

// ─────────────────────────────────────────────
// Pix Reminders — para quem gerou Pix e não pagou
// ─────────────────────────────────────────────

/** 2 minutos após geração — inclui código Pix */
export async function schedulePixReminder({ customerName, customerEmail, pixCode }) {
  if (!RESEND_API_KEY) return null;
  return scheduleEmail({
    to: customerEmail,
    subject: `⏳ Você esqueceu de pagar seu Pix — Solare`,
    html: pixReminderEmailHTML({ customerName, pixCode }),
    delayMs: 2 * 60 * 1000,
  });
}

/** 2 horas após geração */
export async function schedulePixReminder2h({ customerName, customerEmail }) {
  if (!RESEND_API_KEY) return null;
  return scheduleEmail({
    to: customerEmail,
    subject: `🔔 ${customerName.split(' ')[0]}, sua luminária ainda está te esperando! — Solare`,
    html: pixReminder2hEmailHTML({ customerName }),
    delayMs: 2 * 60 * 60 * 1000,
  });
}

/** 4 horas após geração — urgência / "perderá a promoção" */
export async function schedulePixReminder4h({ customerName, customerEmail }) {
  if (!RESEND_API_KEY) return null;
  return scheduleEmail({
    to: customerEmail,
    subject: `🚨 Última chance! Você está prestes a perder a promoção — Solare`,
    html: pixReminder4hEmailHTML({ customerName }),
    delayMs: 4 * 60 * 60 * 1000,
  });
}

export async function cancelPixReminder(reminderId) {
  if (!RESEND_API_KEY || !reminderId) return;
  try {
    await fetch(`https://api.resend.com/emails/${reminderId}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` },
    });
    console.log('[Resend] Pix reminder cancelled — id:', reminderId);
  } catch (e) {
    console.error('[Resend] Cancel reminder failed:', e.message);
  }
}

export async function sendTrackingEmail({ to, customerName, trackingCode, totalPrice, quantity }) {
  const name = escapeHtml(customerName || 'Cliente');
  const code = escapeHtml(trackingCode || '');
  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f7f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">
        <tr><td style="background:#1a3c34;padding:32px;text-align:center;">
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">🌞 Solare</h1>
          <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">${SITE_HOSTNAME}</p>
        </td></tr>
        <tr><td style="padding:40px 40px 32px;">
          <h2 style="font-size:20px;font-weight:700;color:#1a1d2e;margin:0 0 8px;">🚚 Seu pedido está a caminho!</h2>
          <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 28px;">Olá, <strong>${name}</strong>! Seu pedido foi enviado e já está em trânsito. Acompanhe a entrega com o código abaixo:</p>

          <div style="background:#f0fdf4;border:2px dashed #16a34a;border-radius:12px;padding:24px;text-align:center;margin-bottom:28px;">
            <p style="margin:0 0 8px;font-size:13px;color:#16a34a;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Código de Rastreio</p>
            <p style="margin:0;font-size:22px;font-weight:800;color:#1a1d2e;letter-spacing:2px;">${code}</p>
          </div>

          <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0 0 28px;">Você pode usar este código para acompanhar sua entrega nos Correios ou na transportadora responsável.</p>

          <div style="background:#f9fafb;border-radius:12px;padding:20px;margin-bottom:28px;">
            <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Resumo do pedido</p>
            <p style="margin:0;font-size:14px;color:#1a1d2e;">💡 Luminária Solar Solare — <strong>${quantity || 1} unidade(s)</strong></p>
            <p style="margin:4px 0 0;font-size:14px;color:#1a1d2e;">💰 Total pago: <strong>R$ ${parseFloat(totalPrice || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></p>
          </div>

          <p style="color:#4b5563;font-size:14px;margin:0 0 16px;">Ficou com alguma dúvida? Fale com nosso suporte:</p>
          <a href="https://wa.me/5521975605337" style="display:inline-block;background:#25d366;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;font-size:15px;">💬 Falar no WhatsApp</a>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:24px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">Solare — ${SITE_HOSTNAME}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return sendEmail({
    to,
    subject: '🚚 Seu pedido Solare está a caminho!',
    html,
  });
}
