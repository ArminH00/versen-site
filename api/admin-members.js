const { adminFetch, sendJson } = require('./shopify');

const MEMBERS_QUERY = `
  query VersenMembers($query: String!) {
    customers(first: 20, query: $query, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        displayName
        email
        tags
        numberOfOrders
        amountSpent {
          amount
          currencyCode
        }
        updatedAt
      }
    }
  }
`;

function formatPrice(price) {
  if (!price) return '0 kr';

  const amount = Number(price.amount);
  const currency = price.currencyCode === 'SEK' ? 'kr' : price.currencyCode;

  return `${Math.round(amount)} ${currency}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  const secret = process.env.VERSEN_ADMIN_SECRET;
  const header = req.headers.authorization || '';

  if (!secret || header !== `Bearer ${secret}`) {
    sendJson(res, 401, { error: 'Adminnyckel krävs' });
    return;
  }

  const tag = (process.env.VERSEN_MEMBER_TAG || 'versen_member').split(',')[0].trim();
  const result = await adminFetch(MEMBERS_QUERY, { query: `tag:${tag}` });

  if (!result.ok) {
    sendJson(res, result.status, result.body);
    return;
  }

  const members = result.body.data.customers.nodes.map((customer) => ({
    id: customer.id,
    name: customer.displayName,
    email: customer.email,
    tags: customer.tags,
    numberOfOrders: customer.numberOfOrders,
    amountSpent: formatPrice(customer.amountSpent),
    updatedAt: customer.updatedAt,
  }));

  sendJson(res, 200, {
    tag,
    members,
  });
};
