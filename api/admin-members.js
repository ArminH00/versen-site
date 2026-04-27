const { adminFetch, sendJson, shopifyFetch } = require('./shopify');

const MEMBERS_QUERY = `
  query VersenMembers($query: String!) {
    customers(first: 30, query: $query, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        displayName
        email
        tags
        numberOfOrders
        amountSpent {
          amount
          currencyCode
        }
        updatedAt
      }
    }
  }
`;

const RECENT_ORDERS_QUERY = `
  query VersenRecentOrders($query: String) {
    orders(first: 12, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        email
        createdAt
        displayFinancialStatus
        displayFulfillmentStatus
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        lineItems(first: 8) {
          nodes {
            name
            quantity
            product {
              handle
            }
          }
        }
      }
    }
  }
`;

const PRODUCTS_QUERY = `
  query VersenAdminProducts {
    products(first: 20, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        status
        totalInventory
        variants(first: 1) {
          nodes {
            price
            compareAtPrice
          }
        }
      }
    }
  }
`;

const MEMBERSHIP_PRODUCT_QUERY = `
  query VersenMembershipProduct($handle: String!) {
    product(handle: $handle) {
      title
      handle
      variants(first: 5) {
        nodes {
          id
          title
          sellingPlanAllocations(first: 5) {
            nodes {
              sellingPlan {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`;

function formatPrice(price) {
  if (!price) return '0 kr';

  const amount = Number(price.amount);
  const currency = price.currencyCode === 'SEK' ? 'kr' : price.currencyCode;

  return `${Math.round(amount)} ${currency}`;
}

function formatMoneySet(total) {
  return formatPrice(total && total.shopMoney);
}

async function rechargeFetch(path) {
  const token = process.env.RECHARGE_API_TOKEN;

  if (!token) {
    return { ok: false, status: 503, body: { error: 'RECHARGE_API_TOKEN saknas' } };
  }

  const response = await fetch(`https://api.rechargeapps.com${path}`, {
    headers: {
      Accept: 'application/json',
      'X-Recharge-Access-Token': token,
      'X-Recharge-Version': process.env.RECHARGE_API_VERSION || '2021-11',
    },
  });

  let body = null;

  try {
    body = await response.json();
  } catch (error) {
    body = { error: 'Recharge svarade inte med JSON' };
  }

  return { ok: response.ok, status: response.status, body };
}

async function getRechargeCustomer(email) {
  if (!email) {
    return {
      email,
      customerFound: false,
      activeSubscriptionFound: false,
    };
  }

  const customerResult = await rechargeFetch(`/customers?email=${encodeURIComponent(email)}`);
  const customer = customerResult.ok ? (customerResult.body.customers || [])[0] : null;
  let subscriptionResult = null;
  let subscriptions = [];

  if (customer && customer.id) {
    subscriptionResult = await rechargeFetch(`/subscriptions?customer_id=${customer.id}&status=ACTIVE`);
    subscriptions = subscriptionResult.ok ? (subscriptionResult.body.subscriptions || []) : [];
  }

  return {
    email,
    customerLookupWorking: customerResult.ok,
    customerLookupStatus: customerResult.status,
    customerFound: Boolean(customer),
    rechargeCustomerId: customer ? customer.id : null,
    subscriptionLookupWorking: subscriptionResult ? subscriptionResult.ok : false,
    activeSubscriptionFound: subscriptions.length > 0,
    subscriptions: subscriptions.slice(0, 5).map((subscription) => ({
      id: subscription.id,
      status: subscription.status,
      productTitle: subscription.product_title || subscription.product_name || 'Medlemskap',
      nextChargeScheduledAt: subscription.next_charge_scheduled_at || null,
    })),
  };
}

async function getActiveRechargeSubscriptions() {
  const result = await rechargeFetch('/subscriptions?status=ACTIVE&limit=50');
  const subscriptions = result.ok ? (result.body.subscriptions || []) : [];

  return {
    lookupWorking: result.ok,
    status: result.status,
    activeCount: subscriptions.length,
    subscriptions: subscriptions.slice(0, 8).map((subscription) => ({
      id: subscription.id,
      status: subscription.status,
      productTitle: subscription.product_title || subscription.product_name || 'Medlemskap',
      nextChargeScheduledAt: subscription.next_charge_scheduled_at || null,
      customerId: subscription.customer_id || null,
    })),
  };
}

function normalizeOrder(order) {
  return {
    id: order.id,
    name: order.name,
    email: order.email,
    createdAt: order.createdAt,
    financialStatus: order.displayFinancialStatus,
    fulfillmentStatus: order.displayFulfillmentStatus,
    total: formatMoneySet(order.currentTotalPriceSet),
    lines: order.lineItems.nodes.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      productHandle: item.product ? item.product.handle : null,
    })),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  const secret = process.env.VERSEN_ADMIN_SECRET || process.env.VERSEN_SETUP_SECRET;
  const header = req.headers.authorization || '';

  if (!secret || header !== `Bearer ${secret}`) {
    sendJson(res, 401, { error: 'Adminnyckel krävs' });
    return;
  }

  const url = new URL(req.url || '/', 'https://versen.local');
  const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
  const tag = (process.env.VERSEN_MEMBER_TAG || 'versen_member').split(',')[0].trim();
  const result = await adminFetch(MEMBERS_QUERY, { query: `tag:${tag}` });

  if (!result.ok) {
    sendJson(res, result.status, result.body);
    return;
  }

  const members = result.body.data.customers.nodes.map((customer) => ({
    id: customer.id,
    name: customer.displayName,
    email: customer.email,
    tags: customer.tags,
    numberOfOrders: customer.numberOfOrders,
    amountSpent: formatPrice(customer.amountSpent),
    updatedAt: customer.updatedAt,
  }));

  const orderResult = await adminFetch(RECENT_ORDERS_QUERY, { query: email ? `email:${email}` : null });
  const orders = orderResult.ok ? orderResult.body.data.orders.nodes.map(normalizeOrder) : [];
  const productResult = await adminFetch(PRODUCTS_QUERY);
  const products = productResult.ok ? productResult.body.data.products.nodes.map((product) => {
    const variant = product.variants.nodes[0] || {};

    return {
      title: product.title,
      handle: product.handle,
      status: product.status,
      inventory: product.totalInventory,
      price: variant.price ? `${Math.round(Number(variant.price))} kr` : 'Saknas',
      compareAtPrice: variant.compareAtPrice ? `${Math.round(Number(variant.compareAtPrice))} kr` : '',
    };
  }) : [];
  const membershipHandle = process.env.VERSEN_MEMBERSHIP_PRODUCT_HANDLE || 'medlemskap';
  const membershipResult = await shopifyFetch(MEMBERSHIP_PRODUCT_QUERY, { handle: membershipHandle });
  const membershipProduct = membershipResult.ok && membershipResult.body.data.product
    ? {
      title: membershipResult.body.data.product.title,
      handle: membershipResult.body.data.product.handle,
      sellingPlanFound: membershipResult.body.data.product.variants.nodes.some((variant) => variant.sellingPlanAllocations.nodes.length > 0),
      sellingPlans: membershipResult.body.data.product.variants.nodes.flatMap((variant) => (
        variant.sellingPlanAllocations.nodes.map((allocation) => allocation.sellingPlan.name)
      )),
    }
    : {
      title: null,
      handle: membershipHandle,
      sellingPlanFound: false,
      sellingPlans: [],
    };
  const recharge = await getActiveRechargeSubscriptions();
  const customerCheck = email ? await getRechargeCustomer(email) : null;

  sendJson(res, 200, {
    tag,
    members,
    orders,
    products,
    membershipProduct,
    recharge,
    customerCheck,
    diagnostics: {
      ordersWorking: orderResult.ok,
      productsWorking: productResult.ok,
      membershipProductWorking: membershipResult.ok,
      rechargeWorking: recharge.lookupWorking,
      orderError: orderResult.ok ? null : orderResult.body,
      productError: productResult.ok ? null : productResult.body,
      membershipProductError: membershipResult.ok ? null : membershipResult.body,
    },
  });
};
