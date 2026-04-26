const { sendJson, shopifyFetch } = require('./shopify');

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

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

  if (!body.variantId) {
    sendJson(res, 400, { error: 'variantId saknas' });
    return;
  }

  const memberCode = process.env.VERSEN_MEMBER_ACCESS_CODE;
  const discountCode = process.env.SHOPIFY_MEMBER_DISCOUNT_CODE;
  const hasValidMembership = memberCode && body.memberCode === memberCode;

  if (discountCode && !hasValidMembership) {
    sendJson(res, 401, {
      error: 'Medlemskap krävs',
      membershipRequired: true,
    });
    return;
  }

  const input = {
    lines: [
      {
        merchandiseId: body.variantId,
        quantity: Number(body.quantity) || 1,
      },
    ],
  };

  if (discountCode) {
    input.discountCodes = [discountCode];
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
