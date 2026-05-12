function supabaseUrl() {
  return String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
}

function supabaseSecretKey() {
  return process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET
    || '';
}

function isSupabaseConfigured() {
  return Boolean(supabaseUrl() && supabaseSecretKey());
}

function headers(extra = {}) {
  const key = supabaseSecretKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function encode(value) {
  return encodeURIComponent(String(value || ''));
}

function tableName(key, fallback) {
  return process.env[key] || fallback;
}

async function supabaseRequest(pathname, options = {}) {
  if (!isSupabaseConfigured()) {
    const error = new Error('Supabase saknar konfiguration');
    error.status = 503;
    throw error;
  }

  const response = await fetch(`${supabaseUrl()}/rest/v1/${pathname}`, {
    ...options,
    headers: headers(options.headers || {}),
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(data && data.message ? data.message : 'Supabase svarade med ett fel');
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

function orderRecord(order) {
  return {
    id: order.id,
    user_id: order.user_id,
    email: order.email,
    phone: order.phone || null,
    shipping_address: order.shipping_address || {},
    items: order.items || [],
    subtotal: Number(order.subtotal) || 0,
    discount: Number(order.discount) || 0,
    shipping: Number(order.shipping) || 0,
    tax: Number(order.tax) || 0,
    total: Number(order.total) || 0,
    currency: order.currency || 'sek',
    stripe_payment_intent_id: order.stripe_payment_intent_id || null,
    payment_status: order.payment_status || 'pending',
    order_status: order.order_status || 'pending',
    shopify_order_id: order.shopify_order_id || null,
    order_number: order.order_number || null,
    shopify_sync_error: order.shopify_sync_error || null,
    created_at: order.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function draftRecord(draft) {
  return {
    id: draft.id,
    user_id: draft.user_id,
    email: draft.email,
    phone: draft.phone || null,
    shipping_address: draft.shipping_address || {},
    items: draft.items || [],
    subtotal: Number(draft.subtotal) || 0,
    discount: Number(draft.discount) || 0,
    shipping: Number(draft.shipping) || 0,
    tax: Number(draft.tax) || 0,
    total: Number(draft.total) || 0,
    currency: draft.currency || 'sek',
    cart_id: draft.cart_id || null,
    discount_codes: draft.discount_codes || [],
    stripe_payment_intent_id: draft.stripe_payment_intent_id || null,
    site_url: draft.site_url || null,
    created_at: draft.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function itemRecord(orderId, item) {
  return {
    order_id: orderId,
    shopify_product_id: item.shopify_product_id || '',
    shopify_variant_id: item.shopify_variant_id || '',
    title: item.title || item.product_title || 'Produkt',
    quantity: Number(item.quantity) || 1,
    unit_price: Number(item.unit_price) || 0,
    total_price: Number(item.total_price) || 0,
  };
}

async function upsertDraft(draft) {
  const rows = await supabaseRequest(`${tableName('SUPABASE_CHECKOUT_DRAFTS_TABLE', 'checkout_drafts')}?on_conflict=id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(draftRecord(draft)),
  });

  return Array.isArray(rows) ? rows[0] : rows;
}

async function getDraft(id) {
  const rows = await supabaseRequest(`${tableName('SUPABASE_CHECKOUT_DRAFTS_TABLE', 'checkout_drafts')}?id=eq.${encode(id)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertOrder(order) {
  const ordersTable = tableName('SUPABASE_ORDERS_TABLE', 'orders');
  const orderItemsTable = tableName('SUPABASE_ORDER_ITEMS_TABLE', 'order_items');
  const rows = await supabaseRequest(`${ordersTable}?on_conflict=id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(orderRecord(order)),
  });
  const saved = Array.isArray(rows) ? rows[0] : rows;

  await supabaseRequest(`${orderItemsTable}?order_id=eq.${encode(order.id)}`, {
    method: 'DELETE',
  });

  const items = (order.items || []).map((item) => itemRecord(order.id, item));
  if (items.length) {
    await supabaseRequest(orderItemsTable, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(items),
    });
  }

  return saved;
}

async function getOrder(id) {
  const rows = await supabaseRequest(`${tableName('SUPABASE_ORDERS_TABLE', 'orders')}?id=eq.${encode(id)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getOrderByPaymentIntent(paymentIntentId) {
  const rows = await supabaseRequest(`${tableName('SUPABASE_ORDERS_TABLE', 'orders')}?stripe_payment_intent_id=eq.${encode(paymentIntentId)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function listOrdersForCustomer(userId, email) {
  const filters = [];
  if (userId) filters.push(`user_id.eq.${encode(userId)}`);
  if (email) filters.push(`email.eq.${encode(String(email).toLowerCase())}`);

  if (!filters.length) return [];

  const query = `${tableName('SUPABASE_ORDERS_TABLE', 'orders')}?or=(${filters.join(',')})&order=created_at.desc`;
  const rows = await supabaseRequest(query);
  return Array.isArray(rows) ? rows : [];
}

module.exports = {
  getDraft,
  getOrder,
  getOrderByPaymentIntent,
  isSupabaseConfigured,
  listOrdersForCustomer,
  upsertDraft,
  upsertOrder,
};
