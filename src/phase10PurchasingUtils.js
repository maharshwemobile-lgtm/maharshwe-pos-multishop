import { apiFetch } from './phase2Api';

export const money = (value) => `${Number(value || 0).toLocaleString('en-US')} MMK`;
export const today = () => new Date().toISOString().slice(0, 10);
export const shortDate = (value) => String(value || '').slice(0, 10) || '-';

export async function loadAllOrders() {
  const all = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await apiFetch(`/api/purchasing/orders?page=${page}&limit=100`);
    all.push(...(data.orders || []));
    totalPages = Math.max(1, Number(data.totalPages || 1));
    page += 1;
  } while (page <= totalPages && page <= 100);
  return all;
}

export async function loadAllVariants() {
  const all = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await apiFetch(`/api/stock?page=${page}&limit=100`);
    all.push(...(data.items || []));
    totalPages = Math.max(1, Number(data.totalPages || 1));
    page += 1;
  } while (page <= totalPages && page <= 100);
  return all.filter((item) => item.active !== false).map((item) => ({
    ...item,
    productName: item.product && item.product.name ? item.product.name : 'Product',
    quantity: Number(item.inventory && item.inventory.quantity ? item.inventory.quantity : 0),
    costPrice: Number(item.costPrice || 0),
  }));
}

export function normalizeQuantity(value) {
  const number = Number.parseInt(value || '0', 10);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}
