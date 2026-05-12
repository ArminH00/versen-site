const { getCookie, readBody, sendJson } = require('../lib/shopify');
const { stripePublishableKey } = require('../lib/stripe');
const { createMembershipSubscription } = require('../lib/membership-service');
const { getCustomerSession } = require('./membership');

module.exports = async function handler(req, res) {
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

  const session = await getCustomerSession(getCookie(req, 'versen_customer_token'));

  if (!session.authenticated || !session.customer) {
    sendJson(res, 401, {
      error: 'Logga in eller skapa konto innan du startar medlemskap',
      loginRequired: true,
    });
    return;
  }

  if (session.customer.member) {
    sendJson(res, 409, { error: 'Du har redan ett aktivt medlemskap.' });
    return;
  }

  try {
    const { subscription, clientSecret } = await createMembershipSubscription({
      customer: session.customer,
      plan: body.plan,
    });

    if (!clientSecret) {
      sendJson(res, 409, { error: 'Stripe skapade ingen betalning for medlemskapet.' });
      return;
    }

    sendJson(res, 200, {
      publishableKey: stripePublishableKey(),
      clientSecret,
      subscriptionId: subscription.id,
      status: subscription.status,
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || 'Kunde inte starta medlemskap.',
      details: error.details,
    });
  }
};
