const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  getDraft: getSupabaseDraft,
  getOrder: getSupabaseOrder,
  getOrderByPaymentIntent: getSupabaseOrderByPaymentIntent,
  getOrderByShopifyOrderId: getSupabaseOrderByShopifyOrderId,
  isSupabaseConfigured,
  listOrdersForCustomer: listSupabaseOrdersForCustomer,
  updateOrderStatusByShopifyId: updateSupabaseOrderStatusByShopifyId,
  upsertDraft,
  upsertOrder,
} = require('./supabase');

const STORE_PATH = process.env.VERSEN_ORDER_STORE_PATH || path.join(os.tmpdir(), 'versen-orders.json');

function emptyStore() {
  return {
    drafts: {},
    orders: {},
    byPaymentIntent: {},
  };
}

function readStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return { ...emptyStore(), ...JSON.parse(raw) };
  } catch (error) {
    return emptyStore();
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

async function saveDraft(draft) {
  if (isSupabaseConfigured()) {
    return upsertDraft(draft);
  }

  const store = readStore();
  store.drafts[draft.id] = {
    ...draft,
    updated_at: new Date().toISOString(),
  };
  writeStore(store);
  return store.drafts[draft.id];
}

async function getDraft(id) {
  if (!id) return null;

  if (isSupabaseConfigured()) {
    return getSupabaseDraft(id);
  }

  return readStore().drafts[id] || null;
}

async function saveOrder(order) {
  if (isSupabaseConfigured()) {
    return upsertOrder(order);
  }

  const store = readStore();
  const next = {
    ...order,
    updated_at: new Date().toISOString(),
  };
  store.orders[next.id] = next;
  if (next.stripe_payment_intent_id) {
    store.byPaymentIntent[next.stripe_payment_intent_id] = next.id;
  }
  writeStore(store);
  return next;
}

async function getOrder(id) {
  if (!id) return null;

  if (isSupabaseConfigured()) {
    return getSupabaseOrder(id);
  }

  return readStore().orders[id] || null;
}

async function getOrderByPaymentIntent(paymentIntentId) {
  if (!paymentIntentId) return null;

  if (isSupabaseConfigured()) {
    return getSupabaseOrderByPaymentIntent(paymentIntentId);
  }

  const store = readStore();
  const orderId = store.byPaymentIntent[paymentIntentId];
  return orderId ? store.orders[orderId] || null : null;
}

async function listOrdersForCustomer(userId, email) {
  if (isSupabaseConfigured()) {
    return listSupabaseOrdersForCustomer(userId, email);
  }

  const normalizedEmail = String(email || '').toLowerCase();
  return Object.values(readStore().orders)
    .filter((order) => (
      (userId && order.user_id === userId)
      || (normalizedEmail && String(order.email || '').toLowerCase() === normalizedEmail)
    ))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

async function getOrderByShopifyOrderId(shopifyOrderId) {
  if (!shopifyOrderId) return null;

  if (isSupabaseConfigured()) {
    return getSupabaseOrderByShopifyOrderId(shopifyOrderId);
  }

  return Object.values(readStore().orders).find((order) => String(order.shopify_order_id || '') === String(shopifyOrderId)) || null;
}

async function updateOrderStatusByShopifyId(shopifyOrderId, update) {
  if (isSupabaseConfigured()) {
    return updateSupabaseOrderStatusByShopifyId(shopifyOrderId, update);
  }

  const store = readStore();
  const order = Object.values(store.orders).find((item) => String(item.shopify_order_id || '') === String(shopifyOrderId));
  if (!order) return null;
  const next = { ...order, ...update, updated_at: new Date().toISOString() };
  store.orders[next.id] = next;
  writeStore(store);
  return next;
}

module.exports = {
  getDraft,
  getOrder,
  getOrderByPaymentIntent,
  getOrderByShopifyOrderId,
  listOrdersForCustomer,
  saveDraft,
  saveOrder,
  updateOrderStatusByShopifyId,
};
