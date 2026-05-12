const crypto = require('crypto');
const { getAdminAccessToken, getCookie, getShopDomain, sendJson, shopifyFetch } = require('./shopify');
const { getCustomerSession } = require('../api/membership');
const { getDraft, getOrderByPaymentIntent, saveDraft, saveOrder } = require('./order-store');
const { sendOrderConfirmationEmail } = require('./email');
const { stripePublishableKey, stripeRequest } = require('./stripe');

const CART_CREATE_MUTATION = `
  mutation VersenCheckoutCartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
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
        lines(first: 50) {
          nodes {
            quantity
            cost {
              totalAmount {
                amount
                currencyCode
              }
            }
            merchandise {
              ... on ProductVariant {
                id
                title
                availableForSale
                price {
                  amount
                  currencyCode
                }
                compareAtPrice {
                  amount
                  currencyCode
                }
                image {
                  url
                  altText
                }
                product {
                  id
                  title
                  handle
                  vendor
                  productType
                  tags
                  featuredImage {
                    url
                    altText
                  }
                }
              }
            }
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

function normalizeDiscountCode(value) {
  return String(value || '').trim().slice(0, 80);
}

function moneyToOre(money) {
  const amount = Number(money && money.amount);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function formatSekOre(value) {
  return `${Math.round((Number(value) || 0) / 100)} kr`;
}

function categoryForProduct(product = {}) {
  const source = [
    product.productType,
    product.title,
    product.handle,
    ...(product.tags || []),
  ].join(' ').toLowerCase();

  if (/(tershine|gyeon|bilschampo|spolar|däck|dack|avfettning|tvätt|tvatt|torkhandduk|mikrofiber|glasrengöring|snabbvax|bilvård|bilvard|wash mitt|drying towel|wetcoat|repel|purify|relive|dissolve|vision)/i.test(source)) {
    return 'Bilvård';
  }

  if (/(barebells|protein|shake|nocco|träning|traning|hälsa|halsa|dryck|nutrition|whey|kreatin|kasein|vassle|collagen|body science|tyngre)/i.test(source)) {
    return 'Träning & hälsa';
  }

  return product.productType && product.productType !== 'Produkt' ? product.productType : 'Övrigt';
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && item.variantId)
    .slice(0, 50)
    .map((item) => ({
      variantId: String(item.variantId),
      quantity: Math.min(99, Math.max(1, Number(item.quantity) || 1)),
    }));
}

function normalizeAddress(address = {}) {
  return {
    first_name: String(address.firstName || '').trim().slice(0, 80),
    last_name: String(address.lastName || '').trim().slice(0, 80),
    address1: String(address.address1 || '').trim().slice(0, 160),
    address2: String(address.address2 || '').trim().slice(0, 160),
    zip: String(address.postalCode || '').trim().slice(0, 30),
    city: String(address.city || '').trim().slice(0, 80),
    country: String(address.country || 'Sverige').trim().slice(0, 80),
  };
}

function normalizeContact(contact = {}, session = {}) {
  const customer = session.customer || {};
  return {
    email: String(contact.email || customer.email || '').trim().toLowerCase().slice(0, 160),
    phone: String(contact.phone || '').trim().slice(0, 40),
  };
}

function stripeCountryCode(country) {
  const normalized = String(country || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(normalized)) {
    return normalized;
  }
  return 'SE';
}

function stripeCustomerName(address = {}) {
  return [address.first_name, address.last_name].filter(Boolean).join(' ').trim();
}

function applyStripeKlarnaDetails(body, validation, contact, shippingAddress) {
  body.set('payment_method_types[0]', 'card');
  body.set('payment_method_types[1]', 'klarna');

  const country = stripeCountryCode(shippingAddress.country);
  const name = stripeCustomerName(shippingAddress);

  body.set('shipping[name]', name);
  if (contact.phone) {
    body.set('shipping[phone]', contact.phone);
  }
  body.set('shipping[address][line1]', shippingAddress.address1);
  if (shippingAddress.address2) {
    body.set('shipping[address][line2]', shippingAddress.address2);
  }
  body.set('shipping[address][city]', shippingAddress.city);
  body.set('shipping[address][postal_code]', shippingAddress.zip);
  body.set('shipping[address][country]', country);
  body.set('amount_details[shipping][to_postal_code]', shippingAddress.zip);
  body.set('amount_details[shipping][amount]', String(validation.shipping));

  validation.items.forEach((item, index) => {
    body.set(`amount_details[line_items][${index}][product_name]`, item.product_title || item.title || 'Versen produkt');
    body.set(`amount_details[line_items][${index}][unit_cost]`, String(item.unit_price));
    body.set(`amount_details[line_items][${index}][quantity]`, String(item.quantity));
  });
}

function requireShipping(address) {
  const normalized = normalizeAddress(address);
  return ['first_name', 'last_name', 'address1', 'zip', 'city', 'country'].every((key) => normalized[key]);
}

async function getSession(req) {
  const session = await getCustomerSession(getCookie(req, 'versen_customer_token'));
  return { session };
}

function buildLines(items) {
  return normalizeItems(items).map((item) => ({
    merchandiseId: item.variantId,
    quantity: item.quantity,
  }));
}

async function validateCheckout({ items, discountCode, session }) {
  const lines = buildLines(items);

  if (!lines.length) {
    const error = new Error('Varukorgen är tom');
    error.status = 400;
    throw error;
  }

  if (!session || !session.authenticated || !session.customer) {
    const error = new Error('Du behöver vara inloggad för att slutföra köp hos Versen.');
    error.status = 401;
    throw error;
  }

  const discountCodes = [process.env.SHOPIFY_MEMBER_DISCOUNT_CODE, discountCode]
    .map(normalizeDiscountCode)
    .filter(Boolean)
    .filter((code, index, list) => list.findIndex((item) => item.toLowerCase() === code.toLowerCase()) === index);

  const input = {
    lines,
    buyerIdentity: {
      email: session.customer.email,
    },
    attributes: [
      { key: 'Versen kanal', value: 'Versen intern checkout' },
      { key: 'Versen betalning', value: 'Stripe Payment Element' },
    ],
  };

  if (discountCodes.length) {
    input.discountCodes = discountCodes;
  }

  const result = await shopifyFetch(CART_CREATE_MUTATION, { input });

  if (!result.ok) {
    const error = new Error(result.body && result.body.error ? result.body.error : 'Kunde inte validera varukorgen');
    error.status = result.status || 500;
    error.details = result.body;
    throw error;
  }

  const payload = result.body.data.cartCreate;

  if (payload.userErrors.length) {
    const error = new Error('Kunde inte validera varukorgen');
    error.status = 400;
    error.details = payload.userErrors;
    throw error;
  }

  const cart = payload.cart;
  const cartSubtotalOre = moneyToOre(cart.cost && cart.cost.subtotalAmount);
  const cartTotalOre = moneyToOre(cart.cost && cart.cost.totalAmount);
  const shippingOre = Number(process.env.VERSEN_SHIPPING_ORE || 4900);
  const totalOre = cartTotalOre + shippingOre;
  const taxOre = Math.round(totalOre * Number(process.env.VERSEN_TAX_RATE || 0.25));
  const currency = ((cart.cost && cart.cost.totalAmount && cart.cost.totalAmount.currencyCode) || 'SEK').toLowerCase();
  const normalizedItems = cart.lines.nodes.map((line) => {
    const variant = line.merchandise || {};
    const product = variant.product || {};
    const lineOre = moneyToOre(line.cost && line.cost.totalAmount);
    const quantity = Math.max(1, Number(line.quantity) || 1);
    const image = variant.image || product.featuredImage || null;

    return {
      shopify_product_id: product.id || '',
      shopify_variant_id: variant.id || '',
      title: [product.title, variant.title && variant.title !== 'Default Title' ? variant.title : ''].filter(Boolean).join(' - '),
      product_title: product.title || '',
      variant_title: variant.title || '',
      handle: product.handle || '',
      category: categoryForProduct(product),
      image,
      quantity,
      unit_price: Math.round(lineOre / quantity),
      total_price: lineOre,
      compare_at_price: moneyToOre(variant.compareAtPrice),
      available_for_sale: Boolean(variant.availableForSale),
    };
  });

  const unavailable = normalizedItems.find((item) => !item.available_for_sale);
  if (unavailable) {
    const error = new Error(`${unavailable.title} är inte tillgänglig längre.`);
    error.status = 409;
    throw error;
  }

  return {
    cart_id: cart.id,
    items: normalizedItems,
    discount_codes: cart.discountCodes || [],
    subtotal: cartTotalOre,
    original_subtotal: cartSubtotalOre,
    discount: Math.max(0, cartSubtotalOre - cartTotalOre),
    shipping: shippingOre,
    tax: taxOre,
    total: totalOre,
    currency,
    summary: {
      subtotal: formatSekOre(cartTotalOre),
      originalSubtotal: formatSekOre(cartSubtotalOre),
      discount: formatSekOre(Math.max(0, cartSubtotalOre - cartTotalOre)),
      shipping: formatSekOre(shippingOre),
      tax: formatSekOre(taxOre),
      total: formatSekOre(totalOre),
    },
  };
}

async function createPaymentIntent({ req, validation, contact, shippingAddress, session }) {
  const checkoutId = crypto.randomUUID();
  const body = new URLSearchParams();
  body.set('amount', String(validation.total));
  body.set('currency', validation.currency);
  body.set('receipt_email', contact.email);
  applyStripeKlarnaDetails(body, validation, contact, shippingAddress);
  body.set('metadata[versen_checkout_id]', checkoutId);
  body.set('metadata[user_id]', session.customer.id || '');
  body.set('metadata[email]', contact.email);
  body.set('metadata[cart_id]', validation.cart_id || '');
  body.set('metadata[source]', 'versen_internal_checkout');

  const intent = await stripeRequest('payment_intents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `versen-${checkoutId}`,
    },
    body,
  });

  await saveDraft({
    id: checkoutId,
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
    discount_codes: validation.discount_codes,
    stripe_payment_intent_id: intent.id,
    created_at: new Date().toISOString(),
    site_url: process.env.VERSEN_SITE_URL || `https://${req.headers.host}`,
  });

  return intent;
}

async function retrievePaymentIntent(paymentIntentId) {
  const id = String(paymentIntentId || '').trim();
  if (!id) {
    const error = new Error('PaymentIntent saknas');
    error.status = 400;
    throw error;
  }
  return stripeRequest(`payment_intents/${encodeURIComponent(id)}`);
}

function numericShopifyId(gid) {
  const match = String(gid || '').match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function syncOrderToShopify(order) {
  const domain = getShopDomain();
  const token = await getAdminAccessToken();
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2026-04';

  if (!domain || !token) {
    return {
      ok: false,
      status: 503,
      error: 'Shopify Admin API saknar konfiguration',
    };
  }

  const lineItems = order.items
    .map((item) => ({
      variant_id: numericShopifyId(item.shopify_variant_id),
      quantity: item.quantity,
    }))
    .filter((item) => item.variant_id);

  if (!lineItems.length) {
    return {
      ok: false,
      status: 400,
      error: 'Ordern saknar giltiga Shopify-varianter',
    };
  }

  const response = await fetch(`https://${domain}/admin/api/${apiVersion}/orders.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({
      order: {
        email: order.email,
        phone: order.phone || undefined,
        financial_status: 'paid',
        send_receipt: false,
        send_fulfillment_receipt: false,
        inventory_behaviour: 'decrement_obeying_policy',
        tags: 'versen_internal_checkout,stripe_paid',
        line_items: lineItems,
        shipping_address: {
          first_name: order.shipping_address.first_name,
          last_name: order.shipping_address.last_name,
          address1: order.shipping_address.address1,
          address2: order.shipping_address.address2 || undefined,
          zip: order.shipping_address.zip,
          city: order.shipping_address.city,
          country: order.shipping_address.country,
          phone: order.phone || undefined,
        },
        transactions: [
          {
            kind: 'sale',
            status: 'success',
            amount: (order.total / 100).toFixed(2),
            gateway: 'stripe',
          },
        ],
        note_attributes: [
          { name: 'Versen order id', value: order.id },
          { name: 'Stripe PaymentIntent', value: order.stripe_payment_intent_id },
          { name: 'Versen checkout', value: 'Intern Stripe checkout' },
        ],
      },
    }),
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = { error: 'Shopify svarade inte med JSON' };
  }

  if (!response.ok || data.errors) {
    return {
      ok: false,
      status: response.status || 500,
      error: 'Shopify order creation misslyckades',
      details: data,
    };
  }

  return {
    ok: true,
    orderId: data.order && data.order.id ? String(data.order.id) : '',
    orderName: data.order && data.order.name ? data.order.name : '',
  };
}

function publicOrder(order) {
  if (!order) return null;
  return {
    id: order.id,
    email: order.email,
    phone: order.phone,
    shipping_address: order.shipping_address,
    items: order.items,
    subtotal: order.subtotal,
    discount: order.discount,
    shipping: order.shipping,
    tax: order.tax,
    total: order.total,
    currency: order.currency,
    summary: {
      subtotal: formatSekOre(order.subtotal),
      discount: formatSekOre(order.discount),
      shipping: formatSekOre(order.shipping),
      tax: formatSekOre(order.tax),
      total: formatSekOre(order.total),
    },
    stripe_payment_intent_id: order.stripe_payment_intent_id,
    payment_status: order.payment_status,
    order_status: order.order_status,
    shopify_order_id: order.shopify_order_id,
    order_number: order.order_number,
    tracking_url: order.tracking_url,
    tracking_number: order.tracking_number,
    created_at: order.created_at,
  };
}

async function fulfillPaidPaymentIntent(paymentIntent, fallbackDraft = null) {
  if (!paymentIntent || paymentIntent.status !== 'succeeded') {
    const error = new Error('Betalningen är inte bekräftad ännu');
    error.status = 409;
    throw error;
  }

  const existing = await getOrderByPaymentIntent(paymentIntent.id);
  if (existing) {
    return existing;
  }

  const checkoutId = paymentIntent.metadata && paymentIntent.metadata.versen_checkout_id;
  const draft = await getDraft(checkoutId) || fallbackDraft;

  if (!draft) {
    const error = new Error('Orderunderlag saknas för betalningen');
    error.status = 409;
    throw error;
  }

  if (Number(paymentIntent.amount_received || paymentIntent.amount || 0) !== Number(draft.total)) {
    const error = new Error('Betalt belopp matchar inte ordern');
    error.status = 409;
    throw error;
  }

  const orderId = `ord_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const order = {
    id: orderId,
    user_id: draft.user_id,
    email: draft.email,
    phone: draft.phone,
    shipping_address: draft.shipping_address,
    items: draft.items,
    subtotal: draft.subtotal,
    discount: draft.discount,
    shipping: draft.shipping,
    tax: draft.tax,
    total: draft.total,
    currency: draft.currency,
    stripe_payment_intent_id: paymentIntent.id,
    payment_status: 'paid',
    order_status: 'paid_pending_shopify_sync',
    shopify_order_id: '',
    order_number: `#V${Date.now().toString().slice(-6)}`,
    created_at: new Date().toISOString(),
  };

  const synced = await syncOrderToShopify(order);
  if (synced.ok) {
    order.shopify_order_id = synced.orderId;
    order.order_number = synced.orderName || order.order_number;
    order.order_status = 'paid_synced_shopify';
  } else {
    order.shopify_sync_error = synced;
  }

  const saved = await saveOrder(order);
  await sendOrderConfirmationEmail(order).catch(() => {});
  return saved;
}

function handleError(res, error) {
  sendJson(res, error.status || 500, {
    error: error.message || 'Något gick fel',
    details: error.details,
  });
}

module.exports = {
  createPaymentIntent,
  fulfillPaidPaymentIntent,
  formatSekOre,
  getSession,
  handleError,
  normalizeAddress,
  normalizeContact,
  publicOrder,
  requireShipping,
  retrievePaymentIntent,
  saveDraft,
  stripeRequest,
  stripePublishableKey,
  validateCheckout,
};
