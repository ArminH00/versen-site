const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';

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

async function shopifyFetch(query, variables = {}) {
  const config = getShopifyConfig();

  if (!config) {
    return {
      ok: false,
      status: 500,
      body: {
        error: 'Shopify saknar konfiguration',
        missing: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_STOREFRONT_ACCESS_TOKEN'],
      },
    };
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': config.token,
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
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
  res.end(JSON.stringify(body));
}

module.exports = {
  sendJson,
  shopifyFetch,
};
