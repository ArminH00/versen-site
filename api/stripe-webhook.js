const crypto = require('crypto');
const { readRawBody, sendJson } = require('./shopify');
const { fulfillPaidPaymentIntent } = require('./checkout-service');

function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;

  const parts = String(signatureHeader).split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    if (!acc[key]) acc[key] = [];
    acc[key].push(value);
    return acc;
  }, {});
  const timestamp = parts.t && parts.t[0];
  const signatures = parts.v1 || [];

  if (!timestamp || !signatures.length) return false;

  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return signatures.some((signature) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch (error) {
      return false;
    }
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  const rawBody = await readRawBody(req);
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers['stripe-signature'];

  if (!verifySignature(rawBody, signature, secret)) {
    sendJson(res, 400, { error: 'Ogiltig Stripe-signatur' });
    return;
  }

  let event;

  try {
    event = JSON.parse(rawBody);
  } catch (error) {
    sendJson(res, 400, { error: 'Ogiltigt webhook-payload' });
    return;
  }

  if (event.type === 'payment_intent.succeeded') {
    try {
      await fulfillPaidPaymentIntent(event.data && event.data.object);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || 'Kunde inte skapa order' });
      return;
    }
  }

  sendJson(res, 200, { received: true });
};
