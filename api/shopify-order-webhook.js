const crypto = require('crypto');
const { readRawBody, sendJson } = require('../lib/shopify');
const { getOrderByShopifyOrderId, updateOrderStatusByShopifyId } = require('../lib/order-store');
const { sendOrderStatusEmail } = require('../lib/email');

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

function shopifyOrderId(order) {
  return order.id ? String(order.id) : (order.admin_graphql_api_id || '');
}

function firstTracking(order) {
  const fulfillment = (order.fulfillments || []).find((item) => (
    item && (item.tracking_url || item.tracking_urls || item.tracking_number)
  )) || {};
  const trackingUrls = Array.isArray(fulfillment.tracking_urls) ? fulfillment.tracking_urls : [];

  return {
    trackingUrl: fulfillment.tracking_url || trackingUrls[0] || '',
    trackingNumber: fulfillment.tracking_number || '',
  };
}

function statusFromShopify(order) {
  const tags = String(order.tags || '').toLowerCase();
  const fulfillmentStatus = String(order.fulfillment_status || '').toLowerCase();
  const { trackingUrl, trackingNumber } = firstTracking(order);

  if (order.cancelled_at) {
    return {
      order_status: 'cancelled',
      emailType: null,
      message: 'Ordern har markerats som avbruten.',
      trackingUrl,
      trackingNumber,
    };
  }

  if (fulfillmentStatus === 'fulfilled' || trackingUrl || trackingNumber) {
    return {
      order_status: 'shipped',
      emailType: 'order_shipped',
      message: 'Din order är skickad. Följ leveransen via spårningslänken om den finns med.',
      trackingUrl,
      trackingNumber,
    };
  }

  if (tags.includes('packas') || tags.includes('packing')) {
    return {
      order_status: 'packing',
      emailType: 'order_packing',
      message: 'Din order har gått vidare till packning.',
      trackingUrl,
      trackingNumber,
    };
  }

  return {
    order_status: 'paid_synced_shopify',
    emailType: null,
    message: '',
    trackingUrl,
    trackingNumber,
  };
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

  let payload;

  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    sendJson(res, 400, { error: 'Ogiltig JSON' });
    return;
  }

  const id = shopifyOrderId(payload);
  const existing = await getOrderByShopifyOrderId(id);

  if (!existing) {
    sendJson(res, 200, { synced: false, reason: 'order_not_found' });
    return;
  }

  const next = statusFromShopify(payload);
  const statusChanged = existing.order_status !== next.order_status;
  const updated = await updateOrderStatusByShopifyId(id, {
    order_status: next.order_status,
    tracking_url: next.trackingUrl,
    tracking_number: next.trackingNumber,
  });

  if (statusChanged && next.emailType && updated) {
    await sendOrderStatusEmail(updated, {
      type: next.emailType,
      message: next.message,
      trackingUrl: next.trackingUrl,
    }).catch(() => {});
  }

  sendJson(res, 200, { synced: Boolean(updated), orderStatus: next.order_status });
};
