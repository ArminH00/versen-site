const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';
let adminTokenCache = null;
let storefrontTokenCache = null;

function getShopifyConfig() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;

  if (!domain || !token) {
    return null;
  }

  return {
    endpoint: `https://${domain}/api/${API_VERSION}/graphql.json`,
    token,
  };
}

function getShopDomain() {
  return process.env.SHOPIFY_STORE_DOMAIN;
}

async function getAdminAccessToken() {
  const domain = getShopDomain();
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_APP_CLIENT_SECRET;

  if (!domain || !clientId || !clientSecret) {
    return null;
  }

  if (adminTokenCache && adminTokenCache.expiresAt > Date.now() + 60000) {
    return adminTokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  const payload = await response.json();

  if (!response.ok || !payload.access_token) {
    return null;
  }

  adminTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + ((payload.expires_in || 3600) * 1000),
  };

  return adminTokenCache.token;
}

async function createStorefrontAccessToken(title = 'Versen Vercel Storefront') {
  const domain = getShopDomain();
  const token = await getAdminAccessToken();

  if (!domain || !token) {
    return {
      ok: false,
      status: 500,
      body: {
        error: 'Admin API saknar konfiguration',
        missing: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_APP_CLIENT_ID', 'SHOPIFY_APP_CLIENT_SECRET'],
      },
    };
  }

  const response = await fetch(`https://${domain}/admin/api/${API_VERSION}/storefront_access_tokens.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({
      storefront_access_token: { title },
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      body: {
        error: 'Kunde inte skapa Storefront-token',
        details: body,
      },
    };
  }

  return {
    ok: true,
    status: 200,
    body,
  };
}

async function getStorefrontAccessToken() {
  if (process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN) {
    return process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  }

  if (storefrontTokenCache) {
    return storefrontTokenCache;
  }

  return null;
}

async function shopifyFetch(query, variables = {}) {
  const domain = getShopDomain();
  const token = await getStorefrontAccessToken();

  if (!domain || !token) {
    return {
      ok: false,
      status: 500,
      body: {
        error: 'Shopify saknar konfiguration',
        missing: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_STOREFRONT_ACCESS_TOKEN'],
      },
    };
  }

  const response = await fetch(`https://${domain}/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await response.json();

  if (!response.ok || body.errors) {
    return {
      ok: false,
      status: response.status || 500,
      body: {
        error: 'Shopify svarade med ett fel',
        details: body.errors || body,
      },
    };
  }

  return {
    ok: true,
    status: 200,
    body,
  };
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = {
  createStorefrontAccessToken,
  getAdminAccessToken,
  getShopDomain,
  sendJson,
  shopifyFetch,
};
