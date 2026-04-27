const { adminFetch, sendJson } = require('./shopify');

const CUSTOMERS_QUERY = `
  query VersenResetCustomers {
    customers(first: 50, sortKey: CREATED_AT) {
      nodes {
        id
        email
      }
    }
  }
`;

const CUSTOMER_DELETE_MUTATION = `
  mutation VersenCustomerDelete($id: ID!) {
    customerDelete(input: { id: $id }) {
      deletedCustomerId
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

  const secret = process.env.VERSEN_ADMIN_SECRET || process.env.VERSEN_SETUP_SECRET;
  const header = req.headers.authorization || '';

  if (!secret || header !== `Bearer ${secret}`) {
    sendJson(res, 401, { error: 'Adminnyckel krävs' });
    return;
  }

  const result = await adminFetch(CUSTOMERS_QUERY);

  if (!result.ok) {
    sendJson(res, result.status, result.body);
    return;
  }

  const customers = result.body.data.customers.nodes || [];
  const deleted = [];
  const failed = [];

  for (const customer of customers) {
    const deleteResult = await adminFetch(CUSTOMER_DELETE_MUTATION, { id: customer.id });

    if (!deleteResult.ok) {
      failed.push({ email: customer.email, error: deleteResult.body.error });
      continue;
    }

    const payload = deleteResult.body.data.customerDelete;

    if (payload.userErrors.length) {
      failed.push({ email: customer.email, error: payload.userErrors[0].message });
    } else {
      deleted.push({ id: payload.deletedCustomerId, email: customer.email });
    }
  }

  sendJson(res, failed.length ? 207 : 200, {
    deleted,
    failed,
    remainingMayExist: customers.length === 50,
  });
};
