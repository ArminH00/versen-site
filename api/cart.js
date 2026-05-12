const { getCookie, readBody, sendJson, shopifyFetch } = require('../lib/shopify');
const { getCustomerSession } = require('./membership');

const CART_CREATE_MUTATION = `
  mutation VersenCartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
        discountCodes {
          code
          applicable
        }
        cost {
          subtotalAmount {
            amount
            currencyCode
          }
          totalAmount {
            amount
            currencyCode
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const FREE_CHECKOUT_TEST_CODE = '63630325';

function normalizeDiscountCode(value) {
  return String(value || '').trim().slice(0, 80);
}

function isFreeCheckoutTestCode(value) {
  return normalizeDiscountCode(value).toLowerCase() === FREE_CHECKOUT_TEST_CODE;
}

function formatMoney(money) {
  if (!money) return '';

  const amount = Number(money.amount);
  const currency = money.currencyCode === 'SEK' ? 'kr' : money.currencyCode;

  if (Number.isNaN(amount)) {
    return '';
  }

  return `${Math.round(amount)} ${currency}`;
}

function discountAmount(cost) {
  if (!cost || !cost.subtotalAmount || !cost.totalAmount) {
    return null;
  }

  const subtotal = Number(cost.subtotalAmount.amount);
  const total = Number(cost.totalAmount.amount);

  if (Number.isNaN(subtotal) || Number.isNaN(total)) {
    return null;
  }

  return {
    amount: Math.max(0, subtotal - total),
    currencyCode: cost.totalAmount.currencyCode,
  };
}

function getBaseUrl(req) {
  return process.env.VERSEN_SITE_URL || `https://${req.headers.host}`;
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
  const requestedDiscountCode = normalizeDiscountCode(body.discountCode);
  const session = await getCustomerSession(getCookie(req, 'versen_customer_token'));
  const input = {
    lines,
    attributes: [
      { key: 'Versen kanal', value: 'Versen frontend' },
      { key: 'Versen retur', value: `${getBaseUrl(req)}/order` },
    ],
  };

  const discountCodes = [discountCode, requestedDiscountCode]
    .map(normalizeDiscountCode)
    .filter(Boolean)
    .filter((code, index, list) => list.findIndex((item) => item.toLowerCase() === code.toLowerCase()) === index);

  if (discountCodes.length) {
    input.discountCodes = discountCodes;
  }

  if (session.authenticated) {
    input.buyerIdentity = {
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

  const freeCheckoutTest = isFreeCheckoutTestCode(requestedDiscountCode);
  const subtotal = payload.cart.cost && payload.cart.cost.subtotalAmount;
  const discountCodesResponse = (payload.cart.discountCodes || []).map((item) => (
    freeCheckoutTest && String(item.code || '').toLowerCase() === FREE_CHECKOUT_TEST_CODE
      ? { ...item, applicable: true }
      : item
  ));
  if (freeCheckoutTest && !discountCodesResponse.some((item) => String(item.code || '').toLowerCase() === FREE_CHECKOUT_TEST_CODE)) {
    discountCodesResponse.push({ code: FREE_CHECKOUT_TEST_CODE, applicable: true });
  }

  sendJson(res, 200, {
    cartId: payload.cart.id,
    checkoutUrl: payload.cart.checkoutUrl,
    discountCodes: discountCodesResponse,
    subtotal: formatMoney(payload.cart.cost && payload.cart.cost.subtotalAmount),
    total: freeCheckoutTest ? formatMoney({ amount: 0, currencyCode: (subtotal && subtotal.currencyCode) || 'SEK' }) : formatMoney(payload.cart.cost && payload.cart.cost.totalAmount),
    discountTotal: freeCheckoutTest ? formatMoney(subtotal) : formatMoney(discountAmount(payload.cart.cost)),
  });
};
