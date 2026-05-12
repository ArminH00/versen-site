const crypto = require('crypto');
const { getCookie, readBody, readRawBody, sendJson } = require('../lib/shopify');
const { getCustomerSession } = require('./membership');
const {
  createPaymentIntent,
  createFreeCheckoutDraft,
  fulfillPaidPaymentIntent,
  fulfillFreeCheckoutDraft,
  getSession,
  handleError,
  normalizeAddress,
  normalizeContact,
  publicOrder,
  requireShipping,
  retrievePaymentIntent,
  saveDraft,
  stripePublishableKey,
  validateCheckout,
} = require('../lib/checkout-service');
const { getOrder, getOrderByPaymentIntent, listOrdersForCustomer } = require('../lib/order-store');
const { syncStripeInvoice, syncStripeSubscription } = require('../lib/membership-service');

function verifyStripeSignature(rawBody, signatureHeader, secret) {
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

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  return signatures.some((signature) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch (error) {
      return false;
    }
  });
}

async function handleStripeWebhook(req, res) {
  const rawBody = await readRawBody(req);

  if (!verifyStripeSignature(rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) {
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
      const intent = event.data && event.data.object;
      if (intent && intent.metadata && intent.metadata.versen_checkout_id) {
        await fulfillPaidPaymentIntent(intent);
      }
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || 'Kunde inte skapa order' });
      return;
    }
  }

  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    await syncStripeSubscription(event.data && event.data.object).catch(() => {});
  }

  if (event.type === 'customer.subscription.deleted') {
    await syncStripeSubscription(event.data && event.data.object, { emailType: 'membership_cancelled' }).catch(() => {});
  }

  if (event.type === 'invoice.payment_succeeded') {
    await syncStripeInvoice(event.data && event.data.object, 'membership_activated').catch(() => {});
  }

  if (event.type === 'invoice.payment_failed') {
    await syncStripeInvoice(event.data && event.data.object, 'payment_failed').catch(() => {});
  }

  sendJson(res, 200, { received: true });
}

async function handleOrders(req, res) {
  const session = await getCustomerSession(getCookie(req, 'versen_customer_token'));

  if (!session.authenticated || !session.customer) {
    sendJson(res, 401, { error: 'Du behöver vara inloggad för att se ordrar.' });
    return;
  }

  const paymentIntentId = req.query && req.query.payment_intent;
  const orderId = req.query && req.query.id;
  const order = paymentIntentId
    ? await getOrderByPaymentIntent(paymentIntentId)
    : await getOrder(orderId);

  if (order) {
    const ownerMatches = order.user_id === session.customer.id || String(order.email || '').toLowerCase() === String(session.customer.email || '').toLowerCase();
    if (!ownerMatches) {
      sendJson(res, 404, { error: 'Ordern hittades inte.' });
      return;
    }

    sendJson(res, 200, { order: publicOrder(order) });
    return;
  }

  sendJson(res, 200, {
    orders: (await listOrdersForCustomer(session.customer.id, session.customer.email)).map(publicOrder),
  });
}

function requireActiveMember(session) {
  if (!session || !session.authenticated || !session.customer) {
    const error = new Error('Du behöver skapa konto och medlemskap för att slutföra köpet.');
    error.status = 401;
    throw error;
  }

  if (!session.customer.member) {
    const error = new Error('Aktivt medlemskap krävs för att slutföra köpet.');
    error.status = 403;
    throw error;
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'POST' && req.query && req.query.webhook === 'stripe') {
    await handleStripeWebhook(req, res);
    return;
  }

  if (req.method === 'GET') {
    if (req.query && req.query.action === 'orders') {
      await handleOrders(req, res);
      return;
    }

    sendJson(res, 200, {
      publishableKey: stripePublishableKey(),
      stripeReady: Boolean(stripePublishableKey()),
    });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  let body;

  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'Ogiltig JSON' });
    return;
  }

  try {
    const { session } = await getSession(req);

    if (body.action === 'quote') {
      const validation = await validateCheckout({
        items: body.items,
        discountCode: body.discountCode,
        session,
      });

      sendJson(res, 200, {
        items: validation.items,
        summary: validation.summary,
        amounts: {
          subtotal: validation.subtotal,
          discount: validation.discount,
          shipping: validation.shipping,
          tax: validation.tax,
          total: validation.total,
        },
        currency: validation.currency,
        discountCodes: validation.discount_codes,
      });
      return;
    }

    if (body.action === 'payment_intent') {
      requireActiveMember(session);

      const contact = normalizeContact(body.contact, session);
      const shippingAddress = normalizeAddress(body.shippingAddress);

      if (!contact.email) {
        sendJson(res, 400, { error: 'E-post saknas' });
        return;
      }

      if (!requireShipping(body.shippingAddress)) {
        sendJson(res, 400, { error: 'Leveransadressen är inte komplett' });
        return;
      }

      const validation = await validateCheckout({
        items: body.items,
        discountCode: body.discountCode,
        session,
      });

      if (validation.free_checkout) {
        const freeCheckout = await createFreeCheckoutDraft({
          req,
          validation,
          contact,
          shippingAddress,
          session,
        });

        sendJson(res, 200, {
          freeCheckout: true,
          checkoutId: freeCheckout.id,
          paymentIntentId: freeCheckout.id,
          stripeReady: true,
          items: validation.items,
          summary: validation.summary,
          amounts: {
            subtotal: validation.subtotal,
            discount: validation.discount,
            shipping: validation.shipping,
            tax: validation.tax,
            total: validation.total,
          },
          currency: validation.currency,
          discountCodes: validation.discount_codes,
        });
        return;
      }

      const intent = await createPaymentIntent({
        req,
        validation,
        contact,
        shippingAddress,
        session,
      });

      sendJson(res, 200, {
        publishableKey: stripePublishableKey(),
        stripeReady: Boolean(stripePublishableKey() && intent.client_secret),
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret,
        items: validation.items,
        summary: validation.summary,
        amounts: {
          subtotal: validation.subtotal,
          discount: validation.discount,
          shipping: validation.shipping,
          tax: validation.tax,
          total: validation.total,
        },
        currency: validation.currency,
      });
      return;
    }

    if (body.action === 'complete') {
      requireActiveMember(session);

      if (String(body.paymentIntentId || '').startsWith('free_')) {
        const order = await fulfillFreeCheckoutDraft(body.paymentIntentId);
        sendJson(res, 200, { order: publicOrder(order) });
        return;
      }

      const paymentIntent = await retrievePaymentIntent(body.paymentIntentId);
      let fallbackDraft = null;

      if (body.items && body.contact && body.shippingAddress) {
        const contact = normalizeContact(body.contact, session);
        const shippingAddress = normalizeAddress(body.shippingAddress);
        const validation = await validateCheckout({
          items: body.items,
          discountCode: body.discountCode,
          session,
        });
        fallbackDraft = await saveDraft({
          id: paymentIntent.metadata && paymentIntent.metadata.versen_checkout_id,
          user_id: session.customer.id,
          email: contact.email,
          phone: contact.phone,
          shipping_address: shippingAddress,
          items: validation.items,
          subtotal: validation.subtotal,
          discount: validation.discount,
          shipping: validation.shipping,
          tax: validation.tax,
          total: validation.total,
          currency: validation.currency,
          cart_id: validation.cart_id,
          stripe_payment_intent_id: paymentIntent.id,
          created_at: new Date().toISOString(),
        });
      }

      const order = await fulfillPaidPaymentIntent(paymentIntent, fallbackDraft);
      sendJson(res, 200, { order: publicOrder(order) });
      return;
    }

    sendJson(res, 400, { error: 'Okänd checkout-åtgärd' });
  } catch (error) {
    handleError(res, error);
  }
};
