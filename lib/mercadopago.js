// Helpers compartilhados para a integração com o Mercado Pago (API de Payments).
// Doc: https://www.mercadopago.com.br/developers/pt/reference

import crypto from 'crypto';

export const MP_BASE = 'https://api.mercadopago.com';

export function mpAuthHeader() {
  return { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` };
}

// Status do pagamento no Mercado Pago -> status interno usado nas "orders" do Supabase.
const STATUS_MAP = {
  approved:    'approved',
  rejected:    'rejected',
  pending:     'pending',
  in_process:  'pending',
  cancelled:   'cancelled',
  refunded:    'cancelled',
  charged_back: 'cancelled',
};

export function mapPaymentStatus(mpStatus) {
  return STATUS_MAP[mpStatus] || 'pending';
}

// Monta o "payer" exigido pelo Mercado Pago a partir dos campos do nosso checkout.
export function buildMpPayer({ email, cpf, firstName, lastName, address }) {
  return {
    email: String(email || '').trim().toLowerCase(),
    first_name: firstName,
    last_name: lastName,
    identification: {
      type: 'CPF',
      number: String(cpf || '').replace(/\D/g, ''),
    },
    address: {
      zip_code: String(address?.cep || '').replace(/\D/g, ''),
      street_name: address?.street || '',
      street_number: String(address?.number || ''),
    },
  };
}

// Verifica a assinatura HMAC do webhook (header x-signature), conforme
// documentado pelo Mercado Pago: manifest "id:{id};request-id:{request-id};ts:{ts}".
export function verifyMpSignature(req, paymentId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true; // sem segredo configurado, não há o que validar

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  if (!xSignature || !xRequestId) return false;

  const parts = {};
  xSignature.split(',').forEach(part => {
    const idx = part.indexOf('=');
    if (idx !== -1) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k && v) parts[k] = v;
    }
  });

  const { ts, v1: hash } = parts;
  if (!ts || !hash) return false;

  const manifest = `id:${paymentId};request-id:${xRequestId};ts:${ts}`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
