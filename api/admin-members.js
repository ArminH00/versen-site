const { adminFetch, readBody, sendJson, shopifyFetch } = require('../lib/shopify');
const {
  adminCookie,
  clearAdminCookie,
  createAdminSession,
  getAdminSession,
  isAdminRequest,
  verifyAdminPassword,
} = require('../lib/admin-auth');
const adminDashboard = require('../lib/admin-dashboard');
const adminActions = require('../lib/admin-actions');

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

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
    products(first: 100, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        vendor
        tags
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

const SUGGESTIONS_QUERY = `
  query VersenProductSuggestions {
    customers(first: 100, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        displayName
        email
        metafield(namespace: "versen", key: "product_suggestions") {
          value
        }
      }
    }
  }
`;

const PRODUCT_BY_HANDLE_QUERY = `
  query VersenAdminProductByHandle($query: String!) {
    products(first: 1, query: $query) {
      nodes {
        id
        handle
      }
    }
  }
`;

const TAGS_ADD_MUTATION = `
  mutation VersenTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const TAGS_REMOVE_MUTATION = `
  mutation VersenTagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_FLAGS = {
  fewLeft: 'versen_few_left',
  greatPrice: 'versen_great_price',
};

function clientKey(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local').split(',')[0].trim();
}

function isRateLimited(req) {
  const key = clientKey(req);
  const now = Date.now();
  const state = attempts.get(key) || { count: 0, resetAt: now + WINDOW_MS };

  if (state.resetAt < now) {
    attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
    return false;
  }

  return state.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(req) {
  const key = clientKey(req);
  const now = Date.now();
  const state = attempts.get(key) || { count: 0, resetAt: now + WINDOW_MS };

  if (state.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }

  state.count += 1;
  attempts.set(key, state);
}

function formatPrice(price) {
  if (!price) return '0 kr';

  const amount = Number(price.amount);
  const currency = price.currencyCode === 'SEK' ? 'kr' : price.currencyCode;

  return `${Math.round(amount)} ${currency}`;
}

function formatMoneySet(total) {
  return formatPrice(total && total.shopMoney);
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

function parseSuggestions(value, customer) {
  try {
    const parsed = JSON.parse(value || '[]');

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((suggestion) => ({
      id: suggestion.id || `${customer.id}-${suggestion.submittedAt || Math.random()}`,
      product: suggestion.product || '',
      category: suggestion.category || 'Övrigt',
      link: suggestion.link || '',
      message: suggestion.message || '',
      email: suggestion.email || customer.email || '',
      name: suggestion.name || customer.displayName || customer.email || '',
      member: Boolean(suggestion.member),
      submittedAt: suggestion.submittedAt || '',
    })).filter((suggestion) => suggestion.product);
  } catch (error) {
    return [];
  }
}

async function updateProductFlag(res, body) {
  const handle = String(body.handle || '').trim();
  const tag = PRODUCT_FLAGS[body.flag];

  if (!handle || !tag) {
    sendJson(res, 400, { error: 'Produkt och markering krävs' });
    return;
  }

  const productResult = await adminFetch(PRODUCT_BY_HANDLE_QUERY, { query: `handle:${handle}` });

  if (!productResult.ok) {
    sendJson(res, productResult.status, productResult.body);
    return;
  }

  const product = (productResult.body.data.products.nodes || [])[0];

  if (!product) {
    sendJson(res, 404, { error: 'Produkten hittades inte' });
    return;
  }

  const mutation = body.enabled ? TAGS_ADD_MUTATION : TAGS_REMOVE_MUTATION;
  const result = await adminFetch(mutation, { id: product.id, tags: [tag] });

  if (!result.ok) {
    sendJson(res, result.status, result.body);
    return;
  }

  const payload = body.enabled ? result.body.data.tagsAdd : result.body.data.tagsRemove;

  if (payload.userErrors && payload.userErrors.length) {
    sendJson(res, 400, { error: payload.userErrors.map((item) => item.message).join(', ') });
    return;
  }

  sendJson(res, 200, {
    status: body.enabled ? 'Markeringen är aktiv' : 'Markeringen är borttagen',
    handle,
    flag: body.flag,
    enabled: Boolean(body.enabled),
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  const url = new URL(req.url || '/', 'https://versen.local');
  const mode = String(url.searchParams.get('mode') || '');

  if (req.method === 'GET' && mode === 'session') {
    sendJson(res, 200, {
      authenticated: Boolean(getAdminSession(req)),
    });
    return;
  }

  if (req.method === 'GET' && mode === 'dashboard') {
    await adminDashboard(req, res);
    return;
  }

  if (req.method === 'POST') {
    let body;

    try {
      body = await readBody(req);
    } catch (error) {
      sendJson(res, 400, { error: 'Ogiltig JSON' });
      return;
    }

    if (body.action === 'logout') {
      res.setHeader('Set-Cookie', clearAdminCookie());
      sendJson(res, 200, { authenticated: false });
      return;
    }

    if (body.action === 'login') {
      if (isRateLimited(req)) {
        sendJson(res, 429, { error: 'För många försök. Vänta en stund och försök igen.' });
        return;
      }

      if (!verifyAdminPassword(body.code)) {
        recordFailedAttempt(req);
        sendJson(res, 401, { error: 'Fel adminkod' });
        return;
      }

      const token = createAdminSession();

      if (!token) {
        sendJson(res, 500, { error: 'Admin-session saknar serverhemlighet' });
        return;
      }

      res.setHeader('Set-Cookie', adminCookie(token));
      sendJson(res, 200, { authenticated: true });
      return;
    }

    const secret = process.env.VERSEN_ADMIN_SECRET || process.env.VERSEN_SETUP_SECRET;
    const header = req.headers.authorization || '';

    if ((!secret || header !== `Bearer ${secret}`) && !isAdminRequest(req)) {
      sendJson(res, 401, { error: 'Adminnyckel krävs' });
      return;
    }

    if (body.action === 'update_product_flag') {
      await updateProductFlag(res, body);
      return;
    }

    if (['send_checkout_reminder', 'send_support_reply', 'update_order_status', 'update_support_status', 'mark_checkout_contacted', 'clear_abandoned_checkout'].includes(body.action)) {
      const result = await adminActions.runAdminAction(body);
      sendJson(res, result.status, result.body);
      return;
    }

    sendJson(res, 400, { error: 'Okänd adminåtgärd' });
    return;
  }

  const secret = process.env.VERSEN_ADMIN_SECRET || process.env.VERSEN_SETUP_SECRET;
  const header = req.headers.authorization || '';

  if ((!secret || header !== `Bearer ${secret}`) && !isAdminRequest(req)) {
    sendJson(res, 401, { error: 'Adminnyckel krävs' });
    return;
  }
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
    points: Math.floor(Number(customer.amountSpent && customer.amountSpent.amount || 0) * 2),
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
      id: product.id,
      vendor: product.vendor || '',
      tags: product.tags || [],
      flags: {
        fewLeft: (product.tags || []).map((tag) => String(tag).toLowerCase()).includes('versen_few_left'),
        greatPrice: (product.tags || []).map((tag) => String(tag).toLowerCase()).includes('versen_great_price'),
      },
      status: product.status,
      inventory: product.totalInventory,
      price: variant.price ? `${Math.round(Number(variant.price))} kr` : 'Saknas',
      compareAtPrice: variant.compareAtPrice ? `${Math.round(Number(variant.compareAtPrice))} kr` : '',
    };
  }) : [];
  const suggestionsResult = await adminFetch(SUGGESTIONS_QUERY);
  const suggestionCustomers = suggestionsResult.ok && suggestionsResult.body.data && suggestionsResult.body.data.customers
    ? suggestionsResult.body.data.customers.nodes
    : [];
  const suggestions = suggestionCustomers.length
    ? suggestionCustomers.flatMap((customer) => (
      parseSuggestions(customer.metafield && customer.metafield.value, customer)
    )).sort((a, b) => new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime())
    : [];
  sendJson(res, 200, {
    tag,
    members,
    orders,
    products,
    suggestions,
    diagnostics: {
      ordersWorking: orderResult.ok,
      productsWorking: productResult.ok,
      suggestionsWorking: suggestionsResult.ok,
      orderError: orderResult.ok ? null : orderResult.body,
      productError: productResult.ok ? null : productResult.body,
      suggestionError: suggestionsResult.ok ? null : suggestionsResult.body,
    },
  });
};
