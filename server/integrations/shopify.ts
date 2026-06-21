import axios from 'axios';

export interface ShopifyConfig {
  storeDomain: string; // e.g. mystore.myshopify.com
  accessToken: string;
  apiVersion?: string;
}

function client(config: ShopifyConfig) {
  const version = config.apiVersion ?? '2024-01';
  const base = `https://${config.storeDomain}/admin/api/${version}`;
  const headers = { 'X-Shopify-Access-Token': config.accessToken, 'Content-Type': 'application/json' };
  return { base, headers };
}

export async function getShopInfo(config: ShopifyConfig) {
  const { base, headers } = client(config);
  const res = await axios.get(`${base}/shop.json`, { headers });
  return res.data.shop;
}

export async function getProducts(config: ShopifyConfig, limit = 20) {
  const { base, headers } = client(config);
  const res = await axios.get(`${base}/products.json`, { headers, params: { limit } });
  return res.data.products;
}

export async function getOrders(config: ShopifyConfig, status = 'open', limit = 20) {
  const { base, headers } = client(config);
  const res = await axios.get(`${base}/orders.json`, { headers, params: { status, limit } });
  return res.data.orders;
}

export async function getCustomers(config: ShopifyConfig, limit = 20) {
  const { base, headers } = client(config);
  const res = await axios.get(`${base}/customers.json`, { headers, params: { limit } });
  return res.data.customers;
}

export async function testShopify(config: ShopifyConfig): Promise<{ ok: boolean; shopName?: string }> {
  try {
    const shop = await getShopInfo(config);
    return { ok: true, shopName: shop.name };
  } catch {
    return { ok: false };
  }
}
