const { getAdminAccessToken, getShopDomain, sendJson, shopifyFetch } = require('./shopify');

const SHOP_QUERY = `
  query VersenShopStatus {
    shop {
      name
    }
  }
`;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  const domain = getShopDomain();
  const adminToken = await getAdminAccessToken();
  const storefront = await shopifyFetch(SHOP_QUERY);

  sendJson(res, storefront.ok ? 200 : 500, {
    shopDomainConfigured: Boolean(domain),
    adminCredentialsConfigured: Boolean(process.env.SHOPIFY_APP_CLIENT_ID && process.env.SHOPIFY_APP_CLIENT_SECRET),
    adminTokenWorking: Boolean(adminToken),
    storefrontTokenConfigured: Boolean(process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN),
    storefrontWorking: storefront.ok,
    shop: storefront.ok ? storefront.body.data.shop : null,
    error: storefront.ok ? null : storefront.body,
  });
};
