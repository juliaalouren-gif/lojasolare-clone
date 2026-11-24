// Tabela de preços oficial (servidor). Ao mudar um kit nas páginas de produto,
// atualize aqui também — pedidos com valor diferente são recusados.
export const CATALOG = {
  solar:         { 2: 87.90, 4: 107.90 },
  led:           { 3: 79.90, 6: 139.90 },
  'lampada-led': { 2: 87.90, 4: 117.90 },
  jardim:        { 2: 87.90, 4: 107.90 }, // Luminária Solar Externa de Jardim (promo-liquidacao.html) — mesmos preços do kit "solar"
  promoupse:     { 2: 59.90, 4: 79.90 },  // Promo "Pague 1 Leve 2" (promoupse.html) — clone da home com preço reduzido
  refletor:      { 2: 107.90, 4: 167.90 }, // Refletor Solar com Sensor de Presença (refletor-solar-street-smart.html)
};

const SHIPPING_PRICES = [0, 19.90];

// Limite de kits iguais que o seletor "Quantos kits?" pode multiplicar numa
// única compra. Mantém alinhado com o que é razoável vender de uma vez.
const MAX_KIT_MULTIPLIER = 50;

// Confere se o total enviado pelo navegador bate com algum kit do catálogo,
// já considerando que o cliente pode comprar o mesmo kit várias vezes (o
// seletor "Quantos kits?" multiplica quantidade e preço do kit escolhido).
export function isValidOrderTotal({ productType, quantity, shippingPrice, bumpTotal, isPix, totalPrice }) {
  const catalog = CATALOG[productType];
  if (!catalog) return false;

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) return false;

  const ship = Number(shippingPrice) || 0;
  if (!SHIPPING_PRICES.some(p => Math.abs(p - ship) < 0.005)) return false;

  const bumps = Number(bumpTotal) || 0;
  const sentTotal = Number(totalPrice);

  for (const [baseQtyStr, basePrice] of Object.entries(catalog)) {
    const baseQty = Number(baseQtyStr);
    if (qty % baseQty !== 0) continue;
    const multiplier = qty / baseQty;
    if (multiplier < 1 || multiplier > MAX_KIT_MULTIPLIER) continue;

    const kitTotal = Math.round(basePrice * multiplier * 100) / 100;
    const total = isPix ? (kitTotal + ship) * 0.95 + bumps : kitTotal + ship + bumps;
    const expected = Math.round(total * 100) / 100;

    if (Math.abs(expected - sentTotal) <= 0.01) return true;
  }

  return false;
}
