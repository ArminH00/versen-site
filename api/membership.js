const { adminFetch, getCookie, sendJson, shopifyFetch } = require('./shopify');

const CUSTOMER_QUERY = `
  query VersenCustomer($customerAccessToken: String!) {
    customer(customerAccessToken: $customerAccessToken) {
      id
      displayName
      firstName
      lastName
      email
      tags
      numberOfOrders
      orders(first: 8, sortKey: PROCESSED_AT, reverse: true) {
        nodes {
          id
          name
          processedAt
          statusUrl
          totalPrice {
            amount
            currencyCode
          }
          lineItems(first: 4) {
            nodes {
              title
              quantity
            }
          }
        }
      }
    }
  }
`;

const CUSTOMER_ORDERS_QUERY = `
  query VersenCustomerOrders($query: String!) {
    orders(first: 50, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        email
        createdAt
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        lineItems(first: 4) {
          nodes {
            name
            quantity
          }
        }
      }
    }
  }
`;

const CUSTOMER_MEMBERSHIP_META_QUERY = `
  query VersenCustomerMembershipMeta($id: ID!) {
    customer(id: $id) {
      membershipCancellation: metafield(namespace: "versen", key: "membership_cancellation") {
        value
      }
      preferences: metafield(namespace: "versen", key: "preferences") {
        value
      }
    }
  }
`;

function membershipTags() {
  return (process.env.VERSEN_MEMBER_TAG || 'versen_member,member,medlem')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

function emailList(value, fallback = '') {
  return String(value || fallback)
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function formatPrice(price) {
  if (!price) return '';

  const amount = Number(price.amount);
  const currency = price.currencyCode === 'SEK' ? 'kr' : price.currencyCode;

  if (Number.isNaN(amount)) {
    return '';
  }

  return `${Math.round(amount)} ${currency}`;
}

function normalizeStorefrontOrders(customer) {
  return ((customer.orders && customer.orders.nodes) || []).map((order) => ({
    id: order.id,
    name: order.name,
    processedAt: order.processedAt,
    statusUrl: order.statusUrl,
    total: formatPrice(order.totalPrice),
    items: order.lineItems.nodes.map((item) => `${item.quantity} x ${item.title}`),
  }));
}

function normalizeAdminOrders(orders) {
  return (orders || []).map((order) => ({
    id: order.id,
    name: order.name,
    processedAt: order.createdAt,
    statusUrl: '',
    total: formatPrice(order.currentTotalPriceSet && order.currentTotalPriceSet.shopMoney),
    items: order.lineItems.nodes.map((item) => `${item.quantity} x ${item.name}`),
  }));
}

function parseJson(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function dateTime(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function isFutureOrToday(value) {
  if (!value) return false;

  const end = dateTime(value);
  if (!end) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end >= today.getTime();
}

function orderAmount(order) {
  const amount = order
    && order.currentTotalPriceSet
    && order.currentTotalPriceSet.shopMoney
    && order.currentTotalPriceSet.shopMoney.amount;
  const value = Number(amount);

  return Number.isNaN(value) ? 0 : value;
}

function normalizeRechargeSubscription(subscription) {
  if (!subscription) {
    return null;
  }

  return {
    id: subscription.id,
    status: subscription.status || '',
    productTitle: subscription.product_title || subscription.product_name || 'Medlemskap',
    nextChargeScheduledAt: subscription.next_charge_scheduled_at || null,
  };
}

function addOneMonth(value) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setMonth(date.getMonth() + 1);
  return date.toISOString();
}

function isMembershipOrder(order) {
  const lines = order && order.lineItems && order.lineItems.nodes ? order.lineItems.nodes : [];

  return lines.some((line) => /medlemskap/i.test(String(line.name || line.title || '')));
}

function inferMembershipDate(adminOrders, subscription, member) {
  if (subscription && subscription.nextChargeScheduledAt) {
    return subscription.nextChargeScheduledAt;
  }

  const membershipOrder = (adminOrders || []).find(isMembershipOrder);

  if (membershipOrder && membershipOrder.createdAt) {
    return addOneMonth(membershipOrder.createdAt);
  }

  return member ? addOneMonth(new Date().toISOString()) : null;
}

async function getCustomerMeta(customerId) {
  if (!customerId) {
    return {
      cancellation: null,
      preferences: {},
    };
  }

  const result = await adminFetch(CUSTOMER_MEMBERSHIP_META_QUERY, { id: customerId });

  if (!result.ok) {
    return {
      cancellation: null,
      preferences: {},
    };
  }

  const customer = result.body.data.customer || {};
  const cancellationValue = customer.membershipCancellation && customer.membershipCancellation.value;
  const preferencesValue = customer.preferences && customer.preferences.value;

  return {
    cancellation: parseJson(cancellationValue, null),
    preferences: parseJson(preferencesValue, {}) || {},
  };
}

function normalizeCustomer(customer, rechargeInfo = {}, adminOrders = null, meta = {}) {
  const cancellation = meta.cancellation || null;
  const tags = customer.tags || [];
  const tagMatch = tags.some((tag) => membershipTags().includes(String(tag).toLowerCase()));
  const email = String(customer.email || '').toLowerCase();
  const forcedMembers = emailList(process.env.VERSEN_TEST_MEMBER_EMAILS);
  const forcedNonMembers = emailList(process.env.VERSEN_TEST_NON_MEMBER_EMAILS);
  const forcedMember = forcedMembers.includes(email);
  const forcedNonMember = forcedNonMembers.includes(email);
  const cancelledButActive = cancellation
    && cancellation.status === 'cancelled'
    && isFutureOrToday(cancellation.activeUntil);
  const rechargeActive = Boolean(rechargeInfo && rechargeInfo.active);
  const member = Boolean(cancelledButActive || rechargeActive || (!forcedNonMember && (tagMatch || forcedMember)));
  const membershipSource = cancelledButActive
    ? 'Avslutas'
    : (rechargeActive ? 'Recharge' : (forcedMember ? 'Test' : (tagMatch ? 'Shopify' : null)));
  const orderSpend = adminOrders ? adminOrders.reduce((sum, order) => sum + orderAmount(order), 0) : 0;
  const points = Math.floor(orderSpend * 2);
  const subscription = rechargeInfo && rechargeInfo.subscription ? normalizeRechargeSubscription(rechargeInfo.subscription) : null;
  const nextDate = inferMembershipDate(adminOrders, subscription, member);
  const activeUntil = cancelledButActive ? cancellation.activeUntil : nextDate;

  return {
    id: customer.id,
    displayName: customer.displayName,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    tags,
    member,
    membershipSource,
    membershipStatus: cancelledButActive ? 'Aktiv till uppsägning' : (member ? 'Aktiv medlem' : 'Inget aktivt medlemskap'),
    membership: {
      source: membershipSource,
      subscriptionId: subscription && subscription.id ? subscription.id : (cancellation && cancellation.subscriptionId ? cancellation.subscriptionId : null),
      nextChargeScheduledAt: cancelledButActive ? null : nextDate,
      activeUntil,
      cancellationRequested: Boolean(cancelledButActive),
      cancelledAt: cancellation && cancellation.cancelledAt ? cancellation.cancelledAt : null,
    },
    preferences: meta.preferences || {},
    numberOfOrders: Math.max(Number(customer.numberOfOrders || 0), adminOrders ? adminOrders.length : 0),
    points,
    pointsBaseAmount: Math.round(orderSpend),
    orders: adminOrders && adminOrders.length ? normalizeAdminOrders(adminOrders) : normalizeStorefrontOrders(customer),
  };
}

async function getRecentOrdersByEmail(email) {
  if (!email) {
    return null;
  }

  const result = await adminFetch(CUSTOMER_ORDERS_QUERY, { query: `email:${String(email).toLowerCase()}` });

  if (!result.ok) {
    return null;
  }

  return result.body.data.orders.nodes || [];
}

async function getRechargeMembershipByEmail(email) {
  const token = process.env.RECHARGE_API_TOKEN;

  if (!token || !email) {
    return {
      active: false,
      subscription: null,
    };
  }

  const headers = {
    Accept: 'application/json',
    'X-Recharge-Access-Token': token,
    'X-Recharge-Version': process.env.RECHARGE_API_VERSION || '2021-11',
  };

  try {
    const customerResponse = await fetch(`https://api.rechargeapps.com/customers?email=${encodeURIComponent(email)}`, { headers });

    if (!customerResponse.ok) {
      return {
        active: false,
        subscription: null,
      };
    }

    const customerPayload = await customerResponse.json();
    const customer = (customerPayload.customers || [])[0];

    if (!customer || !customer.id) {
      return {
        active: false,
        subscription: null,
      };
    }

    const subscriptionResponse = await fetch(`https://api.rechargeapps.com/subscriptions?customer_id=${customer.id}&status=ACTIVE`, { headers });

    if (!subscriptionResponse.ok) {
      return {
        active: false,
        subscription: null,
      };
    }

    const subscriptionPayload = await subscriptionResponse.json();
    const subscriptions = subscriptionPayload.subscriptions || [];
    const productId = process.env.RECHARGE_MEMBERSHIP_PRODUCT_ID;
    const variantId = process.env.RECHARGE_MEMBERSHIP_VARIANT_ID;

    const subscription = !productId && !variantId
      ? subscriptions[0]
      : subscriptions.find((item) => (
        String(item.product_id || '') === String(productId || '')
        || String(item.external_product_id && item.external_product_id.ecommerce || '') === String(productId || '')
        || String(item.variant_id || '') === String(variantId || '')
        || String(item.external_variant_id && item.external_variant_id.ecommerce || '') === String(variantId || '')
      ));

    return {
      active: Boolean(subscription),
      subscription: subscription || null,
    };
  } catch (error) {
    return {
      active: false,
      subscription: null,
    };
  }
}

async function getCustomerSession(customerAccessToken) {
  if (!customerAccessToken) {
    return {
      authenticated: false,
      customer: null,
    };
  }

  const result = await shopifyFetch(CUSTOMER_QUERY, { customerAccessToken });

  if (!result.ok || !result.body.data.customer) {
    return {
      authenticated: false,
      customer: null,
    };
  }

  const [rechargeInfo, adminOrders, meta] = await Promise.all([
    getRechargeMembershipByEmail(result.body.data.customer.email),
    getRecentOrdersByEmail(result.body.data.customer.email),
    getCustomerMeta(result.body.data.customer.id),
  ]);

  return {
    authenticated: true,
    customer: normalizeCustomer(result.body.data.customer, rechargeInfo, adminOrders, meta),
  };
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  const customerAccessToken = getCookie(req, 'versen_customer_token');
  const session = await getCustomerSession(customerAccessToken);

  sendJson(res, 200, session);
}

handler.getCustomerSession = getCustomerSession;
handler.membershipTags = membershipTags;
handler.checkRechargeMembership = async (email) => {
  const result = await getRechargeMembershipByEmail(email);
  return Boolean(result.active);
};
handler.getRechargeMembershipByEmail = getRechargeMembershipByEmail;

module.exports = handler;
