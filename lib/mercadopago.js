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

// Dados reais de cada produto pro item do pagamento — id/título/descrição/
// foto específicos (em vez de genéricos) e uma foto hospedada no próprio
// site (nunca um domínio de terceiro, que pode cair) ajudam a análise de
// risco do Mercado Pago a aprovar a compra com mais confiança.
export const MP_PRODUCT_INFO = {
  solar:         { id: 'solare-luminaria-solar',   title: 'Luminária Solar de Parede Solare',     description: 'Luminária solar de parede com LED, recarregável por energia solar, resistente à água (IP65), sem fio. Acende automaticamente ao anoitecer.', picture: 'luminaria-warm.jpg' },
  promoupse:     { id: 'solare-luminaria-solar',   title: 'Luminária Solar de Parede Solare',     description: 'Luminária solar de parede com LED, recarregável por energia solar, resistente à água (IP65), sem fio. Acende automaticamente ao anoitecer.', picture: 'luminaria-warm.jpg' },
  led:           { id: 'solare-luminaria-led',     title: 'Luminária LED Sem Fio Solare',          description: 'Luminária LED recarregável sem fio, com controle remoto, ideal para armários, escadas e corredores.', picture: 'imgludd.webp' },
  jardim:        { id: 'solare-luminaria-jardim',  title: 'Luminária Solar Externa de Jardim',     description: 'Luminária solar com estaca para jardim, recarregável por energia solar, resistente à água (IP65), sem fio.', picture: 'jardim-principal.jpg' },
  'lampada-led': { id: 'solare-lampada-led',       title: 'Lâmpada LED Solar Max',                 description: 'Lâmpada LED portátil recarregável por energia solar e USB, com gancho, 3 modos de brilho.', picture: 'lampada-led-solar-max.png' },
  refletor:      { id: 'solare-refletor-solar',    title: 'Refletor Solar com Sensor de Presença', description: 'Refletor solar de luz branca forte, com sensor de presença e controle remoto, resistente à chuva (IP65), sem fio.', picture: 'refletor-solar.jpg' },
};

export function getMpProductInfo(productType) {
  return MP_PRODUCT_INFO[productType] || MP_PRODUCT_INFO.solar;
}

// Monta o "additional_info" — dados extras (telefone, endereço de entrega,
// IP) que não vão no "payer" principal, mas ajudam bastante a análise de
// risco/fraude do Mercado Pago a confiar na compra.
export function buildMpAdditionalInfo({ firstName, lastName, phone, address, ipAddress }) {
  const phoneDigits = String(phone || '').replace(/\D/g, '');
  const info = {
    payer: {
      first_name: firstName,
      last_name: lastName,
      address: {
        zip_code: String(address?.cep || '').replace(/\D/g, ''),
        street_name: address?.street || '',
        street_number: String(address?.number || ''),
      },
    },
    shipments: {
      receiver_address: {
        zip_code: String(address?.cep || '').replace(/\D/g, ''),
        state_name: address?.state || '',
        city_name: address?.city || '',
        street_name: address?.street || '',
        street_number: String(address?.number || ''),
      },
    },
  };
  if (phoneDigits.length >= 10) {
    info.payer.phone = { area_code: phoneDigits.slice(0, 2), number: phoneDigits.slice(2) };
  }
  if (ipAddress) info.ip_address = ipAddress;
  return info;
}

// IP de verdade do cliente, por trás do proxy da Vercel.
export function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || null;
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
