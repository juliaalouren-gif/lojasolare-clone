// Tabela de preços oficial (servidor). Ao mudar um kit nas páginas de produto,
// atualize aqui também — pedidos com valor diferente são recusados.
export const CATALOG = {
  solar:         { 2: 87.90, 4: 107.90 },
  led:           { 3: 79.90, 6: 139.90 },
  'lampada-led': { 2: 87.90, 4: 117.90 },
};

const SHIPPING_PRICES = [0, 19.90];

// Total esperado (mesma fórmula do checkout). Retorna null se produto,
// quantidade ou frete não existirem no catálogo.
export function expectedOrderTotal({ productType, quantity, shippingPrice, bumpTotal, isPix }) {
  if (!Object.prototype.hasOwnProperty.call(CATALOG, productType)) return null;
  const kit = CATALOG[productType][quantity];
  if (kit === undefined) return null;

  const ship = Number(shippingPrice) || 0;
  if (!SHIPPING_PRICES.some(p => Math.abs(p - ship) < 0.005)) return null;

  const total = isPix ? (kit + ship) * 0.95 + bumpTotal : kit + ship + bumpTotal;
  return Math.round(total * 100) / 100;
}
