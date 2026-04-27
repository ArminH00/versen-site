const crypto = require('crypto');
const { adminFetch, readRawBody, sendJson } = require('./shopify');

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

function verifyShopifyWebhook(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

  if (!secret || !hmacHeader) {
    return false;
  }

  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');

  const digestBuffer = Buffer.from(digest);
  const headerBuffer = Buffer.from(hmacHeader);

  return digestBuffer.length === headerBuffer.length && crypto.timingSafeEqual(digestBuffer, headerBuffer);
}

function isMembershipLine(lineItem) {
  const productId = process.env.SHOPIFY_MEMBERSHIP_PRODUCT_ID;
  const variantId = process.env.SHOPIFY_MEMBERSHIP_VARIANT_ID;
  const title = String(lineItem.title || lineItem.name || '').toLowerCase();

  return (
    (productId && String(lineItem.product_id) === String(productId))
    || (variantId && String(lineItem.variant_id) === String(variantId))
    || title.includes('medlemskap')
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  const rawBody = await readRawBody(req);
  const hmac = req.headers['x-shopify-hmac-sha256'];

  if (!verifyShopifyWebhook(rawBody, hmac)) {
    sendJson(res, 401, { error: 'Ogiltig webhook-signatur' });
    return;
  }

  let order;

  try {
    order = JSON.parse(rawBody);
  } catch (error) {
    sendJson(res, 400, { error: 'Ogiltig JSON' });
    return;
  }

  const hasMembership = (order.line_items || []).some(isMembershipLine);
  const customerId = order.customer && (order.customer.admin_graphql_api_id || (order.customer.id ? `gid://shopify/Customer/${order.customer.id}` : null));

  if (!hasMembership || !customerId) {
    sendJson(res, 200, { tagged: false });
    return;
  }

  const tag = (process.env.VERSEN_MEMBER_TAG || 'versen_member').split(',')[0].trim();
  const result = await adminFetch(TAGS_ADD_MUTATION, {
    id: customerId,
    tags: [tag],
  });

  if (!result.ok) {
    sendJson(res, result.status, result.body);
    return;
  }

  const errors = result.body.data.tagsAdd.userErrors;

  if (errors.length) {
    sendJson(res, 400, { error: 'Kunde inte tagga medlem', details: errors });
    return;
  }

  sendJson(res, 200, { tagged: true });
};
