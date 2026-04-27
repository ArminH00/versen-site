const { getCookie, readBody, sendJson, shopifyFetch } = require('./shopify');
const { getCustomerSession } = require('./membership');

const CART_CREATE_MUTATION = `
  mutation VersenCartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

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

  const items = Array.isArray(body.items)
    ? body.items
    : [{ variantId: body.variantId, quantity: body.quantity }];

  const lines = items
    .filter((item) => item && item.variantId)
    .map((item) => ({
      merchandiseId: item.variantId,
      quantity: Math.max(1, Number(item.quantity) || 1),
    }));

  if (!lines.length) {
    sendJson(res, 400, { error: 'Varukorgen är tom' });
    return;
  }

  const discountCode = process.env.SHOPIFY_MEMBER_DISCOUNT_CODE;
  const customerAccessToken = getCookie(req, 'versen_customer_token');
  const session = await getCustomerSession(customerAccessToken);
  const legacyMemberCode = process.env.VERSEN_MEMBER_ACCESS_CODE;
  const hasLegacyMembership = legacyMemberCode && body.memberCode === legacyMemberCode;
  const hasValidMembership = (session.authenticated && session.customer.member) || hasLegacyMembership;

  if (discountCode && !hasValidMembership) {
    sendJson(res, 401, {
      error: session.authenticated ? 'Aktivt medlemskap krävs' : 'Logga in som medlem först',
      membershipRequired: true,
      loginRequired: !session.authenticated,
    });
    return;
  }

  const input = {
    lines,
  };

  if (discountCode) {
    input.discountCodes = [discountCode];
  }

  if (session.authenticated) {
    input.buyerIdentity = {
      customerAccessToken,
      email: session.customer.email,
    };
  }

  const result = await shopifyFetch(CART_CREATE_MUTATION, { input });

  if (!result.ok) {
    sendJson(res, result.status, result.body);
    return;
  }

  const payload = result.body.data.cartCreate;

  if (payload.userErrors.length) {
    sendJson(res, 400, { error: 'Kunde inte skapa varukorg', details: payload.userErrors });
    return;
  }

  sendJson(res, 200, {
    cartId: payload.cart.id,
    checkoutUrl: payload.cart.checkoutUrl,
  });
};
