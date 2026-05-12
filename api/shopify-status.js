const { adminFetch, getAdminAccessToken, getShopDomain, readBody, sendJson, shopifyFetch } = require('../lib/shopify');

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';
const THEME_REDIRECT_MARKER = 'VERSEN_STOREFRONT_REDIRECT';
const DEFAULT_THEME_REDIRECT_TARGET = 'https://versen.se/produkter.html';

const SHOP_QUERY = `
  query VersenShopStatus {
    shop {
      name
    }
  }
`;

const ORDERS_QUERY = `
  query VersenOrderStatus($query: String!) {
    orders(first: 5, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        email
        createdAt
        displayFinancialStatus
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        lineItems(first: 10) {
          nodes {
            name
            quantity
            product {
              handle
            }
            variant {
              id
              title
            }
          }
        }
      }
    }
  }
`;

function hasSecret(req) {
  const secret = process.env.VERSEN_ADMIN_SECRET || process.env.VERSEN_SETUP_SECRET;
  const header = req.headers.authorization || '';

  return Boolean(secret && header === `Bearer ${secret}`);
}

async function adminRest(path, options = {}) {
  const domain = getShopDomain();
  const token = await getAdminAccessToken();

  if (!domain || !token) {
    return {
      ok: false,
      status: 500,
      body: { error: 'Admin API saknar konfiguration' },
    };
  }

  const response = await fetch(`https://${domain}/admin/api/${API_VERSION}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
      ...(options.headers || {}),
    },
  });

  let body = null;

  try {
    body = await response.json();
  } catch (error) {
    body = { error: 'Admin API svarade inte korrekt' };
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function getMainThemeId() {
  const result = await adminRest('/themes.json');

  if (!result.ok) {
    return result;
  }

  const mainTheme = (result.body.themes || []).find((theme) => theme.role === 'main');

  if (!mainTheme) {
    return {
      ok: false,
      status: 404,
      body: { error: 'Aktivt tema hittades inte.' },
    };
  }

  return {
    ok: true,
    status: 200,
    body: { themeId: mainTheme.id, name: mainTheme.name },
  };
}

function redirectSnippet(target) {
  return `{% unless request.design_mode %}
<!-- ${THEME_REDIRECT_MARKER} -->
<script>
  (function () {
    var target = ${JSON.stringify(target)};
    var path = window.location.pathname || '/';
    if (path.indexOf('/challenge') === 0 || path.indexOf('/password') === 0) return;
    window.location.replace(target);
  })();
</script>
<noscript><meta http-equiv="refresh" content="0;url=${target}"></noscript>
<!-- /${THEME_REDIRECT_MARKER} -->
{% endunless %}`;
}

function installRedirect(content, target) {
  if (content.includes(THEME_REDIRECT_MARKER)) {
    return content.replace(
      new RegExp(`<!-- ${THEME_REDIRECT_MARKER} -->[\\s\\S]*?<!-- \\/${THEME_REDIRECT_MARKER} -->`),
      redirectSnippet(target)
    );
  }

  const headMatch = content.match(/<head[^>]*>/i);

  if (!headMatch) {
    return `${redirectSnippet(target)}\n${content}`;
  }

  const insertAt = headMatch.index + headMatch[0].length;

  return `${content.slice(0, insertAt)}\n${redirectSnippet(target)}\n${content.slice(insertAt)}`;
}

async function installThemeRedirect(req, res) {
  if (!hasSecret(req)) {
    sendJson(res, 401, { error: 'Saknar behörighet' });
    return;
  }

  const payload = await readBody(req);
  const target = payload.target || DEFAULT_THEME_REDIRECT_TARGET;
  const themeId = payload.themeId || process.env.SHOPIFY_THEME_ID || process.env.SHOPIFY_REDIRECT_THEME_ID;
  const themeResult = themeId
    ? { ok: true, status: 200, body: { themeId } }
    : await getMainThemeId();

  if (!themeResult.ok) {
    sendJson(res, themeResult.status, themeResult.body);
    return;
  }

  const resolvedThemeId = themeResult.body.themeId;
  const key = 'layout/theme.liquid';
  const assetResult = await adminRest(`/themes/${encodeURIComponent(resolvedThemeId)}/assets.json?asset[key]=${encodeURIComponent(key)}`);

  if (!assetResult.ok) {
    sendJson(res, assetResult.status, {
      error: 'Kunde inte läsa temat.',
      details: assetResult.body,
    });
    return;
  }

  const current = assetResult.body.asset && assetResult.body.asset.value;

  if (!current) {
    sendJson(res, 404, { error: 'theme.liquid hittades inte.' });
    return;
  }

  const next = installRedirect(current, target);
  const saveResult = await adminRest(`/themes/${encodeURIComponent(resolvedThemeId)}/assets.json`, {
    method: 'PUT',
    body: JSON.stringify({
      asset: {
        key,
        value: next,
      },
    }),
  });

  if (!saveResult.ok) {
    sendJson(res, saveResult.status, {
      error: 'Kunde inte spara redirect i temat.',
      details: saveResult.body,
    });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    themeId: resolvedThemeId,
    target,
    installed: true,
  });
}

async function getOrderStatus(req) {
  if (!hasSecret(req)) {
    return null;
  }

  const email = String(req.query.email || '').trim().toLowerCase();

  if (!email) {
    return {
      email,
      lookupWorking: false,
      ordersFound: false,
      error: 'Email saknas',
    };
  }

  const result = await adminFetch(ORDERS_QUERY, { query: `email:${email}` });

  if (!result.ok) {
    return {
      email,
      lookupWorking: false,
      ordersFound: false,
      status: result.status,
      error: result.body,
    };
  }

  const orders = result.body.data.orders.nodes.map((order) => ({
    name: order.name,
    email: order.email,
    createdAt: order.createdAt,
    financialStatus: order.displayFinancialStatus,
    total: order.currentTotalPriceSet && order.currentTotalPriceSet.shopMoney,
    lines: order.lineItems.nodes.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      productHandle: item.product ? item.product.handle : null,
      variantTitle: item.variant ? item.variant.title : null,
    })),
  }));

  return {
    email,
    lookupWorking: true,
    ordersFound: orders.length > 0,
    orders,
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'POST') {
    const action = req.query.action || '';

    if (action === 'install_theme_redirect') {
      await installThemeRedirect(req, res);
      return;
    }

    sendJson(res, 404, { error: 'Okänd åtgärd' });
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  const domain = getShopDomain();
  const adminToken = await getAdminAccessToken();
  const storefront = await shopifyFetch(SHOP_QUERY);
  const orders = req.query.orders === '1' ? await getOrderStatus(req) : null;
  sendJson(res, storefront.ok ? 200 : 500, {
    shopDomainConfigured: Boolean(domain),
    adminCredentialsConfigured: Boolean(process.env.SHOPIFY_APP_CLIENT_ID && process.env.SHOPIFY_APP_CLIENT_SECRET),
    adminTokenWorking: Boolean(adminToken),
    storefrontTokenConfigured: Boolean(process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN),
    storefrontWorking: storefront.ok,
    orders,
    shop: storefront.ok ? storefront.body.data.shop : null,
    error: storefront.ok ? null : storefront.body,
  });
};
