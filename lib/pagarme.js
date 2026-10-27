// Helpers compartilhados para a integração com a Pagar.me/Stone (API v5).
// Doc: https://docs.pagar.me/reference

export const PAGARME_BASE = 'https://api.pagar.me/core/v5';

export function pagarmeAuthHeader() {
  const secret = process.env.PAGARME_SECRET_KEY;
  const basic = Buffer.from(`${secret}:`).toString('base64');
  return { Authorization: `Basic ${basic}` };
}

// Status da cobrança (charge) na Pagar.me -> status interno usado nas "orders"
// do Supabase. Pix fica "pending" até o campo last_transaction.status virar
// "paid" (ver charge.status, que é o que de fato muda pra "paid").
const STATUS_MAP = {
  paid:             'approved',
  failed:           'rejected',
  processing:       'pending',
  pending:          'pending',
  waiting_payment:  'pending',
  canceled:         'cancelled',
  refunded:         'cancelled',
  chargedback:      'cancelled',
};

export function mapChargeStatus(pagarmeStatus) {
  return STATUS_MAP[pagarmeStatus] || 'pending';
}

// Monta o payload de "customer" exigido pela Pagar.me a partir dos campos do
// nosso checkout.
export function buildPagarmeCustomer({ name, email, cpf, phone, address }) {
  const digits = String(cpf || '').replace(/\D/g, '');
  const phoneDigits = String(phone || '').replace(/\D/g, '');
  const areaCode = phoneDigits.slice(0, 2) || '00';
  const number = phoneDigits.slice(2) || '000000000';

  const customer = {
    name,
    email,
    type: 'individual',
    document: digits,
    document_type: 'cpf',
    phones: {
      mobile_phone: { country_code: '55', area_code: areaCode, number },
    },
  };

  if (address?.cep) {
    customer.address = {
      line_1: `${address.number || 'S/N'}, ${address.street || ''}, ${address.neighborhood || ''}`,
      zip_code: String(address.cep).replace(/\D/g, ''),
      city: address.city || '',
      state: address.state || '',
      country: 'BR',
    };
  }

  return customer;
}
