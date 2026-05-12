const { readBody, sendJson } = require('./shopify');
const {
  createPaymentIntent,
  fulfillPaidPaymentIntent,
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
} = require('./checkout-service');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
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
    const { customerAccessToken, session } = await getSession(req);

    if (body.action === 'quote') {
      const validation = await validateCheckout({
        items: body.items,
        discountCode: body.discountCode,
        customerAccessToken,
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
        customerAccessToken,
        session,
      });
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
      const paymentIntent = await retrievePaymentIntent(body.paymentIntentId);
      let fallbackDraft = null;

      if (body.items && body.contact && body.shippingAddress) {
        const contact = normalizeContact(body.contact, session);
        const shippingAddress = normalizeAddress(body.shippingAddress);
        const validation = await validateCheckout({
          items: body.items,
          discountCode: body.discountCode,
          customerAccessToken,
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
