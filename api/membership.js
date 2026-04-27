const { shopifyFetch } = require('./shopify');

const CUSTOMER_QUERY = `
  query VersenCustomer($customerAccessToken: String!) {
    customer(customerAccessToken: $customerAccessToken) {
      id
      displayName
      firstName
      lastName
      email
      tags
      numberOfOrders
      orders(first: 8, sortKey: PROCESSED_AT, reverse: true) {
        nodes {
          id
          name
          processedAt
          statusUrl
          totalPrice {
            amount
            currencyCode
          }
          lineItems(first: 4) {
            nodes {
              title
              quantity
            }
          }
        }
      }
    }
  }
`;

function membershipTags() {
  return (process.env.VERSEN_MEMBER_TAG || 'versen_member,member,medlem')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

function emailList(value, fallback = '') {
  return String(value || fallback)
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function formatPrice(price) {
  if (!price) return '';

  const amount = Number(price.amount);
  const currency = price.currencyCode === 'SEK' ? 'kr' : price.currencyCode;

  if (Number.isNaN(amount)) {
    return '';
  }

  return `${Math.round(amount)} ${currency}`;
}

function normalizeCustomer(customer, rechargeActive = false) {
  const tags = customer.tags || [];
  const tagMatch = tags.some((tag) => membershipTags().includes(String(tag).toLowerCase()));
  const email = String(customer.email || '').toLowerCase();
  const forcedMembers = emailList(process.env.VERSEN_TEST_MEMBER_EMAILS, 'armin@hurtic.com');
  const forcedNonMembers = emailList(process.env.VERSEN_TEST_NON_MEMBER_EMAILS, 'armin.hurtic@icloud.com');
  const forcedMember = forcedMembers.includes(email);
  const forcedNonMember = forcedNonMembers.includes(email);
  const member = Boolean(rechargeActive || (!forcedNonMember && (tagMatch || forcedMember)));
  const membershipSource = rechargeActive ? 'Recharge' : (forcedMember ? 'Test' : (tagMatch ? 'Shopify' : null));

  return {
    id: customer.id,
    displayName: customer.displayName,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    tags,
    member,
    membershipSource,
    membershipStatus: member ? 'Aktiv medlem' : 'Inget aktivt medlemskap',
    numberOfOrders: customer.numberOfOrders,
    orders: ((customer.orders && customer.orders.nodes) || []).map((order) => ({
      id: order.id,
      name: order.name,
      processedAt: order.processedAt,
      statusUrl: order.statusUrl,
      total: formatPrice(order.totalPrice),
      items: order.lineItems.nodes.map((item) => `${item.quantity} x ${item.title}`),
    })),
  };
}

async function checkRechargeMembership(email) {
  const token = process.env.RECHARGE_API_TOKEN;

  if (!token || !email) {
    return false;
  }

  const headers = {
    Accept: 'application/json',
    'X-Recharge-Access-Token': token,
    'X-Recharge-Version': process.env.RECHARGE_API_VERSION || '2021-11',
  };

  try {
    const customerResponse = await fetch(`https://api.rechargeapps.com/customers?email=${encodeURIComponent(email)}`, { headers });

    if (!customerResponse.ok) {
      return false;
    }

    const customerPayload = await customerResponse.json();
    const customer = (customerPayload.customers || [])[0];

    if (!customer || !customer.id) {
      return false;
    }

    const subscriptionResponse = await fetch(`https://api.rechargeapps.com/subscriptions?customer_id=${customer.id}&status=ACTIVE`, { headers });

    if (!subscriptionResponse.ok) {
      return false;
    }

    const subscriptionPayload = await subscriptionResponse.json();
    const subscriptions = subscriptionPayload.subscriptions || [];
    const productId = process.env.RECHARGE_MEMBERSHIP_PRODUCT_ID;
    const variantId = process.env.RECHARGE_MEMBERSHIP_VARIANT_ID;

    if (!productId && !variantId) {
      return subscriptions.length > 0;
    }

    return subscriptions.some((subscription) => (
      String(subscription.product_id || '') === String(productId || '')
      || String(subscription.external_product_id && subscription.external_product_id.ecommerce || '') === String(productId || '')
      || String(subscription.variant_id || '') === String(variantId || '')
      || String(subscription.external_variant_id && subscription.external_variant_id.ecommerce || '') === String(variantId || '')
    ));
  } catch (error) {
    return false;
  }
}

async function getCustomerSession(customerAccessToken) {
  if (!customerAccessToken) {
    return {
      authenticated: false,
      customer: null,
    };
  }

  const result = await shopifyFetch(CUSTOMER_QUERY, { customerAccessToken });

  if (!result.ok || !result.body.data.customer) {
    return {
      authenticated: false,
      customer: null,
    };
  }

  const rechargeActive = await checkRechargeMembership(result.body.data.customer.email);

  return {
    authenticated: true,
    customer: normalizeCustomer(result.body.data.customer, rechargeActive),
  };
}

module.exports = {
  getCustomerSession,
  membershipTags,
};
