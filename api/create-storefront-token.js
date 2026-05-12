const { createStorefrontAccessToken, sendJson } = require('../lib/shopify');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  const setupSecret = process.env.VERSEN_SETUP_SECRET;
  const authorization = req.headers.authorization || '';

  if (!setupSecret || authorization !== `Bearer ${setupSecret}`) {
    sendJson(res, 401, { error: 'Obehörig' });
    return;
  }

  const result = await createStorefrontAccessToken();
  sendJson(res, result.status, result.body);
};
