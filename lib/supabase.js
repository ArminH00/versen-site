function supabaseUrl() {
  return String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
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
    tracking_url: order.tracking_url || null,
    tracking_number: order.tracking_number || null,
    created_at: order.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function profileRecord(profile) {
  return {
    id: profile.id,
    email: String(profile.email || '').toLowerCase(),
    phone: profile.phone || null,
    first_name: profile.first_name || profile.firstName || null,
    last_name: profile.last_name || profile.lastName || null,
    stripe_customer_id: profile.stripe_customer_id || null,
    shopify_customer_id: profile.shopify_customer_id || null,
    membership_status: profile.membership_status || 'inactive',
    membership_subscription_id: profile.membership_subscription_id || null,
    updated_at: new Date().toISOString(),
  };
}

function subscriptionRecord(subscription) {
  return {
    id: subscription.id,
    user_id: subscription.user_id,
    stripe_customer_id: subscription.stripe_customer_id || null,
    stripe_subscription_id: subscription.stripe_subscription_id,
    status: subscription.status || 'incomplete',
    amount: Number(subscription.amount) || 0,
    currency: subscription.currency || 'sek',
    interval: subscription.interval || null,
    price_id: subscription.price_id || null,
    current_period_start: subscription.current_period_start || null,
    current_period_end: subscription.current_period_end || null,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    created_at: subscription.created_at || new Date().toISOString(),
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

function supportTicketRecord(ticket) {
  const now = new Date().toISOString();
  return {
    id: ticket.id,
    user_id: ticket.user_id || null,
    order_id: ticket.order_id || null,
    email: String(ticket.email || '').toLowerCase() || null,
    name: ticket.name || null,
    subject: ticket.subject || null,
    category: ticket.category || 'övrigt',
    status: ticket.status || 'open',
    priority: ticket.priority || 'normal',
    unread: ticket.unread !== false,
    message: ticket.message || null,
    messages: ticket.messages || [],
    metadata: ticket.metadata || {},
    created_at: ticket.created_at || now,
    updated_at: now,
  };
}

function abandonedCheckoutRecord(checkout) {
  const now = new Date().toISOString();
  return {
    id: checkout.id,
    user_id: checkout.user_id || null,
    email: String(checkout.email || '').toLowerCase(),
    name: checkout.name || null,
    phone: checkout.phone || null,
    items: checkout.items || [],
    cart_value: Number(checkout.cart_value || checkout.total) || 0,
    currency: checkout.currency || 'sek',
    status: checkout.status || 'open',
    latest_activity: checkout.latest_activity || null,
    contacted_at: checkout.contacted_at || null,
    last_contacted_at: checkout.last_contacted_at || null,
    metadata: checkout.metadata || {},
    created_at: checkout.created_at || now,
    updated_at: now,
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

async function upsertAbandonedCheckout(checkout) {
  const rows = await supabaseRequest(`${tableName('SUPABASE_ABANDONED_CHECKOUTS_TABLE', 'abandoned_checkouts')}?on_conflict=id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(abandonedCheckoutRecord(checkout)),
  });

  return Array.isArray(rows) ? rows[0] : rows;
}

async function upsertSupportTicket(ticket) {
  const rows = await supabaseRequest(`${tableName('SUPABASE_SUPPORT_TICKETS_TABLE', 'support_tickets')}?on_conflict=id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(supportTicketRecord(ticket)),
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

async function upsertProfile(profile) {
  const rows = await supabaseRequest(`${tableName('SUPABASE_PROFILES_TABLE', 'profiles')}?on_conflict=id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(profileRecord(profile)),
  });

  return Array.isArray(rows) ? rows[0] : rows;
}

async function updateProfileMembership(userId, membership) {
  const body = {
    membership_status: membership.membership_status || membership.status || 'inactive',
    membership_subscription_id: membership.membership_subscription_id || membership.subscriptionId || null,
    stripe_customer_id: membership.stripe_customer_id || null,
    updated_at: new Date().toISOString(),
  };

  const rows = await supabaseRequest(`${tableName('SUPABASE_PROFILES_TABLE', 'profiles')}?id=eq.${encode(userId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });

  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function getProfileById(id) {
  const rows = await supabaseRequest(`${tableName('SUPABASE_PROFILES_TABLE', 'profiles')}?id=eq.${encode(id)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getProfileByEmail(email) {
  const rows = await supabaseRequest(`${tableName('SUPABASE_PROFILES_TABLE', 'profiles')}?email=eq.${encode(String(email || '').toLowerCase())}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertSubscription(subscription) {
  const rows = await supabaseRequest(`${tableName('SUPABASE_SUBSCRIPTIONS_TABLE', 'subscriptions')}?on_conflict=stripe_subscription_id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(subscriptionRecord(subscription)),
  });

  return Array.isArray(rows) ? rows[0] : rows;
}

async function getSubscriptionByStripeId(stripeSubscriptionId) {
  const rows = await supabaseRequest(`${tableName('SUPABASE_SUBSCRIPTIONS_TABLE', 'subscriptions')}?stripe_subscription_id=eq.${encode(stripeSubscriptionId)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getLatestSubscriptionForUser(userId) {
  const rows = await supabaseRequest(`${tableName('SUPABASE_SUBSCRIPTIONS_TABLE', 'subscriptions')}?user_id=eq.${encode(userId)}&order=created_at.desc&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function updateProfilePreferences(userId, preferences) {
  const rows = await supabaseRequest(`${tableName('SUPABASE_PROFILES_TABLE', 'profiles')}?id=eq.${encode(userId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      preferences: preferences || {},
      updated_at: new Date().toISOString(),
    }),
  });

  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function appendProductSuggestion(userId, suggestion) {
  const profile = await getProfileById(userId);
  if (!profile) {
    return null;
  }

  const existing = Array.isArray(profile.product_suggestions) ? profile.product_suggestions : [];
  const next = [suggestion, ...existing].slice(0, 50);
  const rows = await supabaseRequest(`${tableName('SUPABASE_PROFILES_TABLE', 'profiles')}?id=eq.${encode(userId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      product_suggestions: next,
      updated_at: new Date().toISOString(),
    }),
  });

  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function logEmail(email) {
  const rows = await supabaseRequest(tableName('SUPABASE_EMAILS_TABLE', 'emails'), {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: email.user_id || null,
      order_id: email.order_id || null,
      type: email.type,
      resend_email_id: email.resend_email_id || null,
      status: email.status || 'sent',
      created_at: new Date().toISOString(),
    }),
  });

  return Array.isArray(rows) ? rows[0] : rows;
}

async function logAdminActivity(activity) {
  const rows = await supabaseRequest(tableName('SUPABASE_ADMIN_ACTIVITY_TABLE', 'admin_activity_log'), {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      actor: activity.actor || 'admin',
      action: activity.action,
      target_type: activity.target_type || null,
      target_id: activity.target_id || null,
      message: activity.message || null,
      metadata: activity.metadata || {},
      created_at: new Date().toISOString(),
    }),
  });

  return Array.isArray(rows) ? rows[0] : rows;
}

async function adminListTable(envKey, fallback, query = 'order=created_at.desc&limit=100') {
  const separator = query ? '?' : '';
  const rows = await supabaseRequest(`${tableName(envKey, fallback)}${separator}${query}`);
  return Array.isArray(rows) ? rows : [];
}

async function listAdminOrders(limit = 100) {
  return adminListTable('SUPABASE_ORDERS_TABLE', 'orders', `order=created_at.desc&limit=${Number(limit) || 100}`);
}

async function listAdminProfiles(limit = 100) {
  return adminListTable('SUPABASE_PROFILES_TABLE', 'profiles', `order=updated_at.desc&limit=${Number(limit) || 100}`);
}

async function listAdminSubscriptions(limit = 100) {
  return adminListTable('SUPABASE_SUBSCRIPTIONS_TABLE', 'subscriptions', `order=created_at.desc&limit=${Number(limit) || 100}`);
}

async function listAdminCheckoutDrafts(limit = 100) {
  return adminListTable('SUPABASE_CHECKOUT_DRAFTS_TABLE', 'checkout_drafts', `order=updated_at.desc&limit=${Number(limit) || 100}`);
}

async function listAdminAbandonedCheckouts(limit = 100) {
  return adminListTable('SUPABASE_ABANDONED_CHECKOUTS_TABLE', 'abandoned_checkouts', `order=updated_at.desc&limit=${Number(limit) || 100}`);
}

async function listAdminSupportTickets(limit = 100) {
  return adminListTable('SUPABASE_SUPPORT_TICKETS_TABLE', 'support_tickets', `order=updated_at.desc&limit=${Number(limit) || 100}`);
}

async function listAdminEmails(limit = 100) {
  return adminListTable('SUPABASE_EMAILS_TABLE', 'emails', `order=created_at.desc&limit=${Number(limit) || 100}`);
}

async function listAdminActivity(limit = 100) {
  return adminListTable('SUPABASE_ADMIN_ACTIVITY_TABLE', 'admin_activity_log', `order=created_at.desc&limit=${Number(limit) || 100}`);
}

async function patchAdminTable(envKey, fallback, id, update) {
  const rows = await supabaseRequest(`${tableName(envKey, fallback)}?id=eq.${encode(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      ...update,
      updated_at: new Date().toISOString(),
    }),
  });

  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function updateOrderStatus(orderId, update) {
  return patchAdminTable('SUPABASE_ORDERS_TABLE', 'orders', orderId, {
    order_status: update.order_status,
    tracking_url: update.tracking_url || null,
    tracking_number: update.tracking_number || null,
  });
}

async function updateSupportTicket(ticketId, update) {
  return patchAdminTable('SUPABASE_SUPPORT_TICKETS_TABLE', 'support_tickets', ticketId, {
    status: update.status,
    category: update.category,
  });
}

async function markAbandonedCheckoutContacted(checkoutId) {
  return patchAdminTable('SUPABASE_ABANDONED_CHECKOUTS_TABLE', 'abandoned_checkouts', checkoutId, {
    status: 'contacted',
    last_contacted_at: new Date().toISOString(),
  });
}

async function markAbandonedCheckoutConverted(checkoutId, orderId) {
  return patchAdminTable('SUPABASE_ABANDONED_CHECKOUTS_TABLE', 'abandoned_checkouts', checkoutId, {
    status: 'converted',
    metadata: {
      converted_order_id: orderId || null,
      converted_at: new Date().toISOString(),
    },
  });
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

async function getOrderByShopifyOrderId(shopifyOrderId) {
  const rows = await supabaseRequest(`${tableName('SUPABASE_ORDERS_TABLE', 'orders')}?shopify_order_id=eq.${encode(shopifyOrderId)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function updateOrderStatusByShopifyId(shopifyOrderId, update) {
  const rows = await supabaseRequest(`${tableName('SUPABASE_ORDERS_TABLE', 'orders')}?shopify_order_id=eq.${encode(shopifyOrderId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      order_status: update.order_status,
      tracking_url: update.tracking_url || null,
      tracking_number: update.tracking_number || null,
      updated_at: new Date().toISOString(),
    }),
  });

  return Array.isArray(rows) ? rows[0] || null : rows;
}

module.exports = {
  appendProductSuggestion,
  getDraft,
  getOrder,
  getOrderByPaymentIntent,
  getOrderByShopifyOrderId,
  getLatestSubscriptionForUser,
  getProfileByEmail,
  getProfileById,
  getSubscriptionByStripeId,
  isSupabaseConfigured,
  listAdminAbandonedCheckouts,
  listAdminActivity,
  listAdminCheckoutDrafts,
  listAdminEmails,
  listAdminOrders,
  listAdminProfiles,
  listAdminSubscriptions,
  listAdminSupportTickets,
  listOrdersForCustomer,
  logAdminActivity,
  logEmail,
  markAbandonedCheckoutContacted,
  markAbandonedCheckoutConverted,
  updateOrderStatus,
  updateProfileMembership,
  updateProfilePreferences,
  updateSupportTicket,
  updateOrderStatusByShopifyId,
  upsertDraft,
  upsertAbandonedCheckout,
  upsertOrder,
  upsertProfile,
  upsertSubscription,
  upsertSupportTicket,
};
