const { sendJson } = require('./shopify');

function requireSecret(req) {
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

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  if (!requireSecret(req)) {
    sendJson(res, 401, { error: 'Saknar behörighet' });
    return;
  }

  const email = String(req.query.email || 'armin@hurtic.com').trim().toLowerCase();
  const tokenConfigured = Boolean(process.env.RECHARGE_API_TOKEN);

  if (!tokenConfigured) {
    sendJson(res, 200, {
      tokenConfigured,
      customerLookupWorking: false,
      subscriptionLookupWorking: false,
      customerFound: false,
      activeSubscriptionFound: false,
      error: 'RECHARGE_API_TOKEN saknas i Vercel',
    });
    return;
  }

  const customerResult = await rechargeFetch(`/customers?email=${encodeURIComponent(email)}`);
  const customer = customerResult.ok ? (customerResult.body.customers || [])[0] : null;
  let subscriptionResult = null;
  let activeSubscriptionFound = false;

  if (customer && customer.id) {
    subscriptionResult = await rechargeFetch(`/subscriptions?customer_id=${encodeURIComponent(customer.id)}&status=ACTIVE`);
    activeSubscriptionFound = subscriptionResult.ok && (subscriptionResult.body.subscriptions || []).length > 0;
  }

  sendJson(res, 200, {
    tokenConfigured,
    email,
    customerLookupWorking: customerResult.ok,
    customerLookupStatus: customerResult.status,
    customerFound: Boolean(customer),
    subscriptionLookupWorking: subscriptionResult ? subscriptionResult.ok : false,
    subscriptionLookupStatus: subscriptionResult ? subscriptionResult.status : null,
    activeSubscriptionFound,
    rechargeCustomerId: customer ? customer.id : null,
  });
};
