const { getAdminAccessToken, getShopDomain, sendJson, shopifyFetch } = require('./shopify');

const SHOP_QUERY = `
  query VersenShopStatus {
    shop {
      name
    }
  }
`;

function hasSecret(req) {
  const secret = process.env.VERSEN_ADMIN_SECRET || process.env.VERSEN_SETUP_SECRET;
  const header = req.headers.authorization || '';

  return Boolean(secret && header === `Bearer ${secret}`);
}

async function rechargeFetch(path) {
  const token = process.env.RECHARGE_API_TOKEN;

  if (!token) {
    return {
      ok: false,
      status: 503,
      body: { error: 'RECHARGE_API_TOKEN saknas' },
    };
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

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function getRechargeStatus(req) {
  if (!hasSecret(req)) {
    return null;
  }

  const email = String(req.query.email || 'armin@hurtic.com').trim().toLowerCase();
  const tokenConfigured = Boolean(process.env.RECHARGE_API_TOKEN);

  if (!tokenConfigured) {
    return {
      tokenConfigured,
      customerLookupWorking: false,
      subscriptionLookupWorking: false,
      customerFound: false,
      activeSubscriptionFound: false,
      error: 'RECHARGE_API_TOKEN saknas i Vercel',
    };
  }

  const customerResult = await rechargeFetch(`/customers?email=${encodeURIComponent(email)}`);
  const customer = customerResult.ok ? (customerResult.body.customers || [])[0] : null;
  let subscriptionResult = null;
  let activeSubscriptionFound = false;

  if (customer && customer.id) {
    subscriptionResult = await rechargeFetch(`/subscriptions?customer_id=${encodeURIComponent(customer.id)}&status=ACTIVE`);
    activeSubscriptionFound = subscriptionResult.ok && (subscriptionResult.body.subscriptions || []).length > 0;
  }

  return {
    tokenConfigured,
    email,
    customerLookupWorking: customerResult.ok,
    customerLookupStatus: customerResult.status,
    customerFound: Boolean(customer),
    subscriptionLookupWorking: subscriptionResult ? subscriptionResult.ok : false,
    subscriptionLookupStatus: subscriptionResult ? subscriptionResult.status : null,
    activeSubscriptionFound,
    rechargeCustomerId: customer ? customer.id : null,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  const domain = getShopDomain();
  const adminToken = await getAdminAccessToken();
  const storefront = await shopifyFetch(SHOP_QUERY);
  const recharge = req.query.recharge === '1' ? await getRechargeStatus(req) : null;

  sendJson(res, storefront.ok ? 200 : 500, {
    shopDomainConfigured: Boolean(domain),
    adminCredentialsConfigured: Boolean(process.env.SHOPIFY_APP_CLIENT_ID && process.env.SHOPIFY_APP_CLIENT_SECRET),
    adminTokenWorking: Boolean(adminToken),
    storefrontTokenConfigured: Boolean(process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN),
    storefrontWorking: storefront.ok,
    recharge,
    shop: storefront.ok ? storefront.body.data.shop : null,
    error: storefront.ok ? null : storefront.body,
  });
};
