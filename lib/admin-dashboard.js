const { requireAdmin } = require('./admin-auth');
const { adminFetch, sendJson } = require('./shopify');
const {
  isSupabaseConfigured,
  listAdminAbandonedCheckouts,
  listAdminActivity,
  listAdminCheckoutDrafts,
  listAdminEmails,
  listAdminOrders,
  listAdminProfiles,
  listAdminSubscriptions,
  listAdminSupportTickets,
} = require('./supabase');

const ORDERS_QUERY = `
  query VersenAdminOrders($query: String) {
    orders(first: 80, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        email
        createdAt
        displayFinancialStatus
        displayFulfillmentStatus
        phone
        customer {
          id
          displayName
          email
          tags
        }
        shippingAddress {
          name
          address1
          address2
          zip
          city
          country
          phone
        }
        currentSubtotalPriceSet { shopMoney { amount currencyCode } }
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first: 20) {
          nodes {
            name
            quantity
            discountedTotalSet { shopMoney { amount currencyCode } }
            originalUnitPriceSet { shopMoney { amount currencyCode } }
            product { handle }
            variant { id sku title }
          }
        }
      }
    }
  }
`;

const CUSTOMERS_QUERY = `
  query VersenAdminCustomers($query: String) {
    customers(first: 80, query: $query, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        displayName
        firstName
        lastName
        email
        phone
        tags
        numberOfOrders
        amountSpent { amount currencyCode }
        createdAt
        updatedAt
      }
    }
  }
`;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

async function safeSupabase(label, loader) {
  if (!isSupabaseConfigured()) {
    return { label, ok: false, data: [], error: 'Supabase saknar konfiguration' };
  }

  try {
    return { label, ok: true, data: await loader(), error: null };
  } catch (error) {
    return { label, ok: false, data: [], error: error.message || 'Kunde inte läsa Supabase-tabellen' };
  }
}

async function safeShopify(label, query, variables = {}) {
  const result = await adminFetch(query, variables);

  if (!result.ok) {
    return { label, ok: false, data: null, error: result.body && result.body.error ? result.body.error : 'Shopify svarade med fel' };
  }

  return { label, ok: true, data: result.body.data, error: null };
}

function amountValue(money) {
  return Math.round(Number(money && money.amount ? money.amount : 0));
}

function moneyLabel(money, fallbackOre = 0) {
  if (money && money.amount !== undefined) {
    const currency = money.currencyCode === 'SEK' ? 'kr' : money.currencyCode;
    return `${Math.round(Number(money.amount) || 0)} ${currency || 'kr'}`;
  }

  return `${Math.round((Number(fallbackOre) || 0) / 100)} kr`;
}

function subscriptionMonthlyOre(subscription = {}) {
  const amount = Number(subscription.amount || subscription.price || 0) || 0;
  const interval = String(subscription.interval || '').toLowerCase();

  if (!amount) return 0;
  if (interval === 'year' || interval === 'annual' || interval === 'yearly') return Math.round(amount / 12);
  return amount;
}

function dateKey(value) {
  if (!value) return '';

  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Stockholm',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value));
  } catch (error) {
    return '';
  }
}

function isToday(value) {
  return dateKey(value) === dateKey(new Date().toISOString());
}

function normalizeShopifyOrder(order) {
  const totalMoney = order.currentTotalPriceSet && order.currentTotalPriceSet.shopMoney;
  const subtotalMoney = order.currentSubtotalPriceSet && order.currentSubtotalPriceSet.shopMoney;

  return {
    source: 'shopify',
    id: order.id,
    name: order.name,
    email: order.email || (order.customer && order.customer.email) || '',
    phone: order.phone || '',
    customerName: order.customer ? order.customer.displayName : '',
    customerId: order.customer ? order.customer.id : '',
    customerTags: order.customer ? order.customer.tags || [] : [],
    createdAt: order.createdAt,
    orderStatus: order.displayFulfillmentStatus || 'Unfulfilled',
    paymentStatus: order.displayFinancialStatus || '',
    fulfillmentStatus: order.displayFulfillmentStatus || '',
    totalValue: amountValue(totalMoney),
    total: moneyLabel(totalMoney),
    subtotal: moneyLabel(subtotalMoney),
    shippingAddress: order.shippingAddress || null,
    membershipStatus: order.customer && safeArray(order.customer.tags).some((tag) => String(tag).toLowerCase().includes('member')) ? 'member' : 'unknown',
    items: safeArray(order.lineItems && order.lineItems.nodes).map((item) => ({
      title: item.name,
      quantity: item.quantity,
      unitPrice: moneyLabel(item.originalUnitPriceSet && item.originalUnitPriceSet.shopMoney),
      total: moneyLabel(item.discountedTotalSet && item.discountedTotalSet.shopMoney),
      productHandle: item.product ? item.product.handle : '',
      sku: item.variant ? item.variant.sku : '',
    })),
    timeline: [
      { at: order.createdAt, label: 'Order skapad i Shopify' },
      order.displayFinancialStatus ? { at: order.createdAt, label: `Betalstatus: ${order.displayFinancialStatus}` } : null,
      order.displayFulfillmentStatus ? { at: order.createdAt, label: `Leveransstatus: ${order.displayFulfillmentStatus}` } : null,
    ].filter(Boolean),
  };
}

function normalizeSupabaseOrder(order) {
  const address = order.shipping_address || {};

  return {
    source: 'supabase',
    id: order.id,
    name: order.order_number || order.id,
    email: order.email || '',
    phone: order.phone || '',
    customerName: [address.first_name, address.last_name].filter(Boolean).join(' '),
    customerId: order.user_id || '',
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    orderStatus: order.order_status || 'pending',
    paymentStatus: order.payment_status || 'pending',
    fulfillmentStatus: order.order_status || 'pending',
    totalValue: Math.round((Number(order.total) || 0) / 100),
    total: moneyLabel(null, order.total),
    subtotal: moneyLabel(null, order.subtotal),
    shippingAddress: address,
    trackingUrl: order.tracking_url || '',
    trackingNumber: order.tracking_number || '',
    membershipStatus: 'unknown',
    items: safeArray(order.items).map((item) => ({
      title: item.title || item.product_title || 'Produkt',
      quantity: item.quantity || 1,
      unitPrice: moneyLabel(null, item.unit_price),
      total: moneyLabel(null, item.total_price),
      productHandle: item.handle || '',
      sku: item.sku || '',
    })),
    timeline: [
      { at: order.created_at, label: 'Order skapad i Versen checkout' },
      order.payment_status ? { at: order.updated_at || order.created_at, label: `Betalstatus: ${order.payment_status}` } : null,
      order.order_status ? { at: order.updated_at || order.created_at, label: `Orderstatus: ${order.order_status}` } : null,
    ].filter(Boolean),
  };
}

function normalizeCustomer(customer, profiles, subscriptions, orders, checkouts, tickets) {
  const email = String(customer.email || '').toLowerCase();
  const profile = profiles.find((item) => String(item.email || '').toLowerCase() === email);
  const profileSubscriptions = profile
    ? subscriptions.filter((item) => item.user_id === profile.id)
    : [];

  return {
    source: 'shopify',
    id: customer.id,
    profileId: profile ? profile.id : '',
    name: customer.displayName || email,
    firstName: customer.firstName || (profile && profile.first_name) || '',
    lastName: customer.lastName || (profile && profile.last_name) || '',
    email,
    phone: customer.phone || (profile && profile.phone) || '',
    tags: customer.tags || [],
    numberOfOrders: customer.numberOfOrders || orders.filter((order) => String(order.email || '').toLowerCase() === email).length,
    amountSpent: moneyLabel(customer.amountSpent),
    membershipStatus: profile ? profile.membership_status : (safeArray(customer.tags).some((tag) => String(tag).toLowerCase().includes('member')) ? 'member' : 'unknown'),
    subscriptions: profileSubscriptions,
    orders: orders.filter((order) => String(order.email || '').toLowerCase() === email).slice(0, 10),
    checkouts: checkouts.filter((checkout) => String(checkout.email || '').toLowerCase() === email).slice(0, 10),
    supportTickets: tickets.filter((ticket) => String(ticket.email || '').toLowerCase() === email || (profile && ticket.user_id === profile.id)).slice(0, 10),
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

function normalizeProfile(profile, subscriptions, orders, checkouts, tickets) {
  const email = String(profile.email || '').toLowerCase();

  return {
    source: 'supabase',
    id: profile.id,
    profileId: profile.id,
    name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || email,
    firstName: profile.first_name || '',
    lastName: profile.last_name || '',
    email,
    phone: profile.phone || '',
    tags: [],
    numberOfOrders: orders.filter((order) => String(order.email || '').toLowerCase() === email || order.customerId === profile.id).length,
    amountSpent: `${orders.filter((order) => String(order.email || '').toLowerCase() === email || order.customerId === profile.id).reduce((sum, order) => sum + (Number(order.totalValue) || 0), 0)} kr`,
    membershipStatus: profile.membership_status || 'inactive',
    subscriptions: subscriptions.filter((item) => item.user_id === profile.id),
    orders: orders.filter((order) => String(order.email || '').toLowerCase() === email || order.customerId === profile.id).slice(0, 10),
    checkouts: checkouts.filter((checkout) => String(checkout.email || '').toLowerCase() === email || checkout.userId === profile.id).slice(0, 10),
    supportTickets: tickets.filter((ticket) => String(ticket.email || '').toLowerCase() === email || ticket.user_id === profile.id).slice(0, 10),
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

function normalizeCheckout(row, source = 'checkout_drafts', orders = [], profiles = []) {
  const matchingOrder = orders.find((order) => (
    order.id === row.order_id
    || order.stripe_payment_intent_id === row.stripe_payment_intent_id
    || (row.email && String(order.email || '').toLowerCase() === String(row.email).toLowerCase() && new Date(order.created_at || order.createdAt).getTime() >= new Date(row.created_at).getTime())
  ));
  const profile = profiles.find((item) => String(item.email || '').toLowerCase() === String(row.email || '').toLowerCase() || item.id === row.user_id);

  return {
    source,
    id: row.id,
    userId: row.user_id || '',
    name: row.name || [row.shipping_address && row.shipping_address.first_name, row.shipping_address && row.shipping_address.last_name].filter(Boolean).join(' '),
    email: row.email || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cartValue: moneyLabel(null, row.total || row.cart_value),
    cartValueNumber: Math.round((Number(row.total || row.cart_value) || 0) / 100),
    status: row.status || (matchingOrder ? 'converted' : 'open'),
    contacted: Boolean(row.contacted_at || row.last_contacted_at || row.status === 'contacted'),
    member: Boolean(profile && ['active', 'trialing'].includes(String(profile.membership_status || '').toLowerCase())),
    latestActivity: row.latest_activity || row.updated_at || row.created_at,
    products: safeArray(row.items || row.products).map((item) => ({
      title: item.title || item.product_title || item.name || 'Produkt',
      quantity: item.quantity || 1,
      price: moneyLabel(null, item.total_price || item.price || item.unit_price),
    })),
  };
}

function normalizeSubscription(row, profiles = []) {
  const profile = profiles.find((item) => item.id === row.user_id || item.stripe_customer_id === row.stripe_customer_id);

  return {
    id: row.id || row.stripe_subscription_id,
    userId: row.user_id,
    email: profile ? profile.email : '',
    customerName: profile ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') : '',
    stripeCustomerId: row.stripe_customer_id || '',
    stripeSubscriptionId: row.stripe_subscription_id || '',
    status: row.status || 'unknown',
    amount: Number(row.amount || row.price || 0) || 0,
    currency: row.currency || 'sek',
    interval: row.interval || '',
    priceId: row.price_id || '',
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTicket(row) {
  return {
    id: row.id,
    userId: row.user_id || '',
    orderId: row.order_id || '',
    name: row.name || '',
    email: row.email || '',
    subject: row.subject || row.category || 'Supportärende',
    category: row.category || 'övrigt',
    status: row.status || 'open',
    unread: Boolean(row.unread),
    priority: row.priority || 'normal',
    message: row.message || '',
    messages: safeArray(row.messages),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function uniqueByEmail(items) {
  const seen = new Set();
  const result = [];

  items.forEach((item) => {
    const key = String(item.email || item.id || '').toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });

  return result;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  try {
    requireAdmin(req);
  } catch (error) {
    sendJson(res, error.status || 401, { error: error.message });
    return;
  }

  const url = new URL(req.url || '/', 'https://versen.local');
  const search = String(url.searchParams.get('q') || '').trim();
  const orderQuery = search ? `email:${search} OR name:${search}` : null;
  const customerQuery = search ? `email:${search}` : null;

  const [shopifyOrders, shopifyCustomers, ordersResult, profilesResult, subscriptionsResult, draftsResult, abandonedResult, ticketsResult, emailsResult, activityResult] = await Promise.all([
    safeShopify('shopify_orders', ORDERS_QUERY, { query: orderQuery }),
    safeShopify('shopify_customers', CUSTOMERS_QUERY, { query: customerQuery }),
    safeSupabase('orders', () => listAdminOrders(100)),
    safeSupabase('profiles', () => listAdminProfiles(120)),
    safeSupabase('subscriptions', () => listAdminSubscriptions(120)),
    safeSupabase('checkout_drafts', () => listAdminCheckoutDrafts(120)),
    safeSupabase('abandoned_checkouts', () => listAdminAbandonedCheckouts(120)),
    safeSupabase('support_tickets', () => listAdminSupportTickets(120)),
    safeSupabase('emails', () => listAdminEmails(120)),
    safeSupabase('activity', () => listAdminActivity(120)),
  ]);

  const supabaseOrdersRaw = ordersResult.data;
  const profiles = profilesResult.data;
  const subscriptionsRaw = subscriptionsResult.data;
  const tickets = ticketsResult.data.map(normalizeTicket);
  const shopifyOrderList = safeArray(shopifyOrders.data && shopifyOrders.data.orders && shopifyOrders.data.orders.nodes).map(normalizeShopifyOrder);
  const supabaseOrderList = supabaseOrdersRaw.map(normalizeSupabaseOrder);
  const orders = [...shopifyOrderList, ...supabaseOrderList]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  const checkouts = [
    ...abandonedResult.data.map((row) => normalizeCheckout(row, 'abandoned_checkouts', supabaseOrdersRaw, profiles)),
    ...draftsResult.data.map((row) => normalizeCheckout(row, 'checkout_drafts', supabaseOrdersRaw, profiles)),
  ].filter((checkout) => !['converted', 'cleared'].includes(String(checkout.status || '').toLowerCase()))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
  const subscriptions = subscriptionsRaw.map((row) => normalizeSubscription(row, profiles));
  const shopifyCustomersList = safeArray(shopifyCustomers.data && shopifyCustomers.data.customers && shopifyCustomers.data.customers.nodes)
    .map((customer) => normalizeCustomer(customer, profiles, subscriptionsRaw, orders, checkouts, tickets));
  const profileCustomers = profiles.map((profile) => normalizeProfile(profile, subscriptionsRaw, orders, checkouts, tickets));
  const users = uniqueByEmail([...shopifyCustomersList, ...profileCustomers])
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
  const todayOrders = orders.filter((order) => isToday(order.createdAt));
  const todayCheckouts = checkouts.filter((checkout) => isToday(checkout.createdAt || checkout.updatedAt));
  const todaySubscriptions = subscriptions.filter((subscription) => isToday(subscription.createdAt));
  const activeSubscriptions = subscriptions.filter((subscription) => ['active', 'trialing'].includes(String(subscription.status || '').toLowerCase()));
  const mrrOre = activeSubscriptions.reduce((sum, subscription) => sum + subscriptionMonthlyOre(subscription), 0);
  const packingStatuses = ['paid_pending_shopify_sync', 'paid_synced_shopify', 'unfulfilled', 'open', 'pending'];
  const shippedStatuses = ['fulfilled', 'shipped', 'delivered'];
  const resendConfigured = Boolean(process.env.RESEND_API_KEY && (process.env.VERSEN_EMAIL_FROM || process.env.RESEND_FROM_EMAIL || process.env.VERSEN_SUPPORT_EMAIL));

  sendJson(res, 200, {
    generatedAt: new Date().toISOString(),
    stats: {
      ordersToday: todayOrders.length,
      revenueToday: `${todayOrders.reduce((sum, order) => sum + (Number(order.totalValue) || 0), 0)} kr`,
      abandonedToday: todayCheckouts.length,
      membershipsToday: todaySubscriptions.length,
      membershipRevenueToday: subscriptionsRaw.some((item) => item.amount || item.price)
        ? `${subscriptionsRaw.filter((item) => isToday(item.created_at)).reduce((sum, item) => sum + Math.round((Number(item.amount || item.price) || 0) / 100), 0)} kr`
        : 'Data saknas',
      mrr: mrrOre ? moneyLabel(null, mrrOre) : 'Data saknas',
      arr: mrrOre ? moneyLabel(null, mrrOre * 12) : 'Data saknas',
      activeMemberships: activeSubscriptions.length,
      supportMessages: tickets.length,
      unreadSupportMessages: tickets.filter((ticket) => ticket.unread || ticket.status === 'unread').length,
      awaitingPacking: orders.filter((order) => packingStatuses.includes(String(order.fulfillmentStatus || order.orderStatus || '').toLowerCase())).length,
      shippedOrders: orders.filter((order) => shippedStatuses.includes(String(order.fulfillmentStatus || order.orderStatus || '').toLowerCase())).length,
      returns: tickets.filter((ticket) => String(ticket.category || '').toLowerCase().includes('retur') || String(ticket.status || '').toLowerCase().includes('return')).length,
    },
    lists: {
      orders,
      checkouts,
      subscriptions,
      users,
      support: tickets,
      emails: emailsResult.data,
      activity: activityResult.data,
    },
    settings: {
      orderStatuses: ['ny', 'betald', 'väntar på packning', 'packas', 'skickad', 'levererad', 'avbruten', 'återbetald', 'retur'],
      supportCategories: ['olästa', 'pågående', 'avslutade', 'returer', 'övrigt'],
      emailTemplates: ['abandoned_checkout_reminder', 'support_reply', 'order_status'],
    },
    diagnostics: {
      shopify: {
        orders: { ok: shopifyOrders.ok, error: shopifyOrders.error },
        customers: { ok: shopifyCustomers.ok, error: shopifyCustomers.error },
      },
      supabase: {
        configured: isSupabaseConfigured(),
        orders: { ok: ordersResult.ok, error: ordersResult.error },
        profiles: { ok: profilesResult.ok, error: profilesResult.error },
        subscriptions: { ok: subscriptionsResult.ok, error: subscriptionsResult.error },
        checkoutDrafts: { ok: draftsResult.ok, error: draftsResult.error },
        abandonedCheckouts: { ok: abandonedResult.ok, error: abandonedResult.error },
        supportTickets: { ok: ticketsResult.ok, error: ticketsResult.error },
        emails: { ok: emailsResult.ok, error: emailsResult.error },
        activity: { ok: activityResult.ok, error: activityResult.error },
      },
      resend: {
        configured: resendConfigured,
      },
    },
  });
};
