/**
 * Integração com a SuperFrete — cotação (Jadlog x Loggi, sempre a mais
 * barata), geração e pagamento de etiqueta via saldo da conta.
 */

const SUPERFRETE_BASE = 'https://api.superfrete.com/api/v0';

function headers() {
  return {
    'Authorization': `Bearer ${process.env.SUPERFRETE_API_TOKEN}`,
    'User-Agent': 'Loja Solare (integracao@solarelojas.com.br)',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
}

// Endereço de remetente — fixo, sempre o mesmo depósito da loja.
export const SENDER = {
  name: 'Loja Solare',
  address: 'Rua Herminia Soares',
  number: '191',
  district: 'Parque Ulisses',
  city: 'Nova Iguaçu',
  state_abbr: 'RJ',
  postal_code: '26011060',
};

// Só Jadlog (3) e Loggi (31) — nunca outra transportadora.
const SERVICES = '3,31';

/**
 * Dimensões de caixa conhecidas por quantidade de luminárias no pedido.
 * Acima de 8 unidades ainda não tem medida cadastrada — null sinaliza que
 * a etiqueta precisa ser gerada manualmente pelo lojista.
 */
export function packageForQuantity(qty) {
  const n = Number(qty);
  if (n === 2) return { height: 6, width: 7, length: 12, weight: 0.3 };
  if ([4, 6, 8].includes(n)) return { height: 6, width: 12, length: 16, weight: 0.3 };
  return null;
}

/** Cota Jadlog e Loggi e retorna a opção mais barata entre as duas. */
export async function quoteCheapest({ toPostalCode, pkg }) {
  const res = await fetch(`${SUPERFRETE_BASE}/calculator`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      from: { postal_code: SENDER.postal_code },
      to: { postal_code: String(toPostalCode).replace(/\D/g, '') },
      services: SERVICES,
      package: pkg,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || 'Falha ao cotar frete na SuperFrete.');

  const valid = (Array.isArray(data) ? data : []).filter(q => !q.has_error);
  if (!valid.length) {
    throw new Error('Nem Jadlog nem Loggi atendem esse CEP de destino.');
  }
  valid.sort((a, b) => a.price - b.price);
  return valid[0];
}

/** Cria o item no "carrinho" da SuperFrete (ainda não paga/gera etiqueta). */
export async function createCartItem({ to, service, pkg, products }) {
  const res = await fetch(`${SUPERFRETE_BASE}/cart`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      from: SENDER,
      to,
      service,
      volumes: pkg,
      products,
      platform: 'Loja Solare',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || JSON.stringify(data));
  return data; // { id, price, status: 'pending' }
}

/** Paga com o saldo da conta e gera a etiqueta de verdade. */
export async function checkoutOrders(orderIds) {
  const res = await fetch(`${SUPERFRETE_BASE}/checkout`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ orders: orderIds }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || JSON.stringify(data));
  return data; // { success, purchase: { status, orders: [{ id, price, tracking, print:{url} }] } }
}

/** Consulta o status atual de uma etiqueta (pending/released/posted/delivered/canceled). */
export async function getOrderInfo(id) {
  const res = await fetch(`${SUPERFRETE_BASE}/order/info/${id}`, { headers: headers() });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || JSON.stringify(data));
  return data;
}

/** Cadastra o webhook de eventos (chamado uma única vez, na configuração inicial). */
export async function registerWebhook(url) {
  const res = await fetch(`${SUPERFRETE_BASE}/webhook`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      name: 'Loja Solare — rastreio',
      url,
      events: ['order.generated', 'order.posted', 'order.delivered', 'order.cancelled'],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || JSON.stringify(data));
  return data; // inclui secret_token
}
