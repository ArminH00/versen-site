const { getCookie, readBody, sendJson, shopifyFetch } = require('./shopify');
const { getCustomerSession } = require('./membership');

const MEMBERSHIP_PRODUCT_QUERY_WITH_PLAN = `
  query VersenMembershipProduct($handle: String!) {
    product(handle: $handle) {
      id
      title
      handle
      variants(first: 1) {
        nodes {
          id
          sellingPlanAllocations(first: 1) {
            nodes {
              sellingPlan {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`;

const MEMBERSHIP_PRODUCT_QUERY = `
  query VersenMembershipProduct($handle: String!) {
    product(handle: $handle) {
      id
      title
      handle
      variants(first: 1) {
        nodes {
          id
        }
      }
    }
  }
`;

const CART_CREATE_MUTATION = `
  mutation VersenMembershipCartCreate($input: CartInput!) {
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

async function fetchMembershipProduct(handle) {
  const withPlan = await shopifyFetch(MEMBERSHIP_PRODUCT_QUERY_WITH_PLAN, { handle });

  if (withPlan.ok) {
    return withPlan;
  }

  return shopifyFetch(MEMBERSHIP_PRODUCT_QUERY, { handle });
}

function getBaseUrl(req) {
  return process.env.VERSEN_SITE_URL || `https://${req.headers.host}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  try {
    await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'Ogiltig JSON' });
    return;
  }

  const customerAccessToken = getCookie(req, 'versen_customer_token');
  const session = await getCustomerSession(customerAccessToken);

  if (!session.authenticated) {
    sendJson(res, 401, {
      error: 'Logga in eller skapa konto innan du startar medlemskap',
      loginRequired: true,
    });
    return;
  }

  const handle = process.env.VERSEN_MEMBERSHIP_PRODUCT_HANDLE || 'medlemskap';
  const productResult = await fetchMembershipProduct(handle);

  if (!productResult.ok) {
    sendJson(res, productResult.status, productResult.body);
    return;
  }

  const product = productResult.body.data.product;
  const variant = product && product.variants.nodes[0];

  if (!product || !variant) {
    sendJson(res, 404, { error: 'Medlemskapsprodukten hittades inte i Shopify' });
    return;
  }

  const sellingPlanId = process.env.SHOPIFY_MEMBERSHIP_SELLING_PLAN_ID
    || (variant.sellingPlanAllocations && variant.sellingPlanAllocations.nodes[0] && variant.sellingPlanAllocations.nodes[0].sellingPlan.id);

  if (!sellingPlanId) {
    sendJson(res, 409, {
      error: 'Medlemskapsplan saknas i Shopify. Koppla produkten till ReCharge eller ange SHOPIFY_MEMBERSHIP_SELLING_PLAN_ID innan medlemskap kan säljas.',
    });
    return;
  }

  const line = {
    merchandiseId: variant.id,
    quantity: 1,
    attributes: [
      { key: 'Versen', value: 'Medlemskap' },
    ],
  };

  if (sellingPlanId) {
    line.sellingPlanId = sellingPlanId;
  }

  const input = {
    lines: [line],
    buyerIdentity: {
      customerAccessToken,
      email: session.customer.email,
    },
    attributes: [
      { key: 'Versen medlemskap', value: 'true' },
      { key: 'Versen kanal', value: 'Versen frontend' },
      { key: 'Versen retur', value: `${getBaseUrl(req)}/medlemskap-aktivt.html?checkout=medlemskap` },
    ],
  };

  const cartResult = await shopifyFetch(CART_CREATE_MUTATION, { input });

  if (!cartResult.ok) {
    sendJson(res, cartResult.status, cartResult.body);
    return;
  }

  const payload = cartResult.body.data.cartCreate;

  if (payload.userErrors.length) {
    sendJson(res, 400, { error: 'Kunde inte skapa medlemscheckout', details: payload.userErrors });
    return;
  }

  sendJson(res, 200, {
    checkoutUrl: payload.cart.checkoutUrl,
    sellingPlan: Boolean(sellingPlanId),
  });
};
