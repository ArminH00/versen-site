const { getCookie, sendJson } = require('./shopify');
const { getCustomerSession } = require('./membership');
const { getOrder, getOrderByPaymentIntent, listOrdersForCustomer } = require('./order-store');
const { publicOrder } = require('./checkout-service');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

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
};
