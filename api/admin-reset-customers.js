const {
  adminFetch,
  getAdminAccessToken,
  getShopDomain,
  readBody,
  sendJson,
} = require('./shopify');

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';
const MEMBERSHIP_TAGS = ['versen_member', 'member', 'medlem'];
const VERSEN_METAFIELDS = ['membership_cancellation', 'product_suggestions', 'preferences'];

const CUSTOMERS_QUERY = `
  query VersenResetCustomers {
    customers(first: 50, sortKey: CREATED_AT) {
      nodes {
        id
        email
        tags
      }
    }
  }
`;

const TAGS_REMOVE_MUTATION = `
  mutation VersenCustomerTagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
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

function customerNumericId(id) {
  const match = String(id || '').match(/Customer\/(\d+)$/);
  return match ? match[1] : null;
}

async function adminRest(path, options = {}) {
  const domain = getShopDomain();
  const token = await getAdminAccessToken();

  if (!domain || !token) {
    return {
      ok: false,
      status: 500,
      body: {
        error: 'Shopify Admin API saknar konfiguration',
        missing: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_APP_CLIENT_ID', 'SHOPIFY_APP_CLIENT_SECRET'],
      },
    };
  }

  const response = await fetch(`https://${domain}/admin/api/${API_VERSION}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : {};
  } catch (error) {
    body = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function removeVersenMetafields(customer) {
  const numericId = customerNumericId(customer.id);

  if (!numericId) {
    return { deleted: [], failed: [{ key: 'customer_id', error: 'Kunde inte läsa kund-ID' }] };
  }

  const result = await adminRest(`/customers/${numericId}/metafields.json?namespace=versen`);

  if (!result.ok) {
    return { deleted: [], failed: [{ key: 'metafields', error: result.body }] };
  }

  const metafields = (result.body.metafields || [])
    .filter((metafield) => VERSEN_METAFIELDS.includes(String(metafield.key || '').toLowerCase()));
  const deleted = [];
  const failed = [];

  for (const metafield of metafields) {
    const deleteResult = await adminRest(`/metafields/${metafield.id}.json`, { method: 'DELETE' });

    if (deleteResult.ok) {
      deleted.push(metafield.key);
    } else {
      failed.push({ key: metafield.key, error: deleteResult.body });
    }
  }

  return { deleted, failed };
}

async function removeMembershipTags(customer) {
  const tags = customer.tags || [];
  const removableTags = tags.filter((tag) => MEMBERSHIP_TAGS.includes(String(tag).toLowerCase()));

  if (!removableTags.length) {
    return { removed: [], failed: [] };
  }

  const result = await adminFetch(TAGS_REMOVE_MUTATION, {
    id: customer.id,
    tags: removableTags,
  });

  if (!result.ok) {
    return { removed: [], failed: [{ tags: removableTags, error: result.body }] };
  }

  const payload = result.body.data.tagsRemove;

  if (payload.userErrors.length) {
    return { removed: [], failed: [{ tags: removableTags, error: payload.userErrors[0].message }] };
  }

  return { removed: removableTags, failed: [] };
}

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

  const body = await readBody(req);
  const deleteCustomers = body.deleteCustomers !== false;
  const dryRun = body.dryRun === true;
  const result = await adminFetch(CUSTOMERS_QUERY);

  if (!result.ok) {
    sendJson(res, result.status, result.body);
    return;
  }

  const customers = result.body.data.customers.nodes || [];
  const cleaned = [];
  const deleted = [];
  const failed = [];

  for (const customer of customers) {
    const customerCleanup = {
      email: customer.email,
      tagsRemoved: [],
      metafieldsDeleted: [],
    };

    if (!dryRun) {
      const tagResult = await removeMembershipTags(customer);
      const metaResult = await removeVersenMetafields(customer);

      customerCleanup.tagsRemoved = tagResult.removed;
      customerCleanup.metafieldsDeleted = metaResult.deleted;

      for (const error of [...tagResult.failed, ...metaResult.failed]) {
        failed.push({ email: customer.email, cleanupError: error });
      }
    } else {
      customerCleanup.tagsRemoved = (customer.tags || [])
        .filter((tag) => MEMBERSHIP_TAGS.includes(String(tag).toLowerCase()));
      customerCleanup.metafieldsDeleted = VERSEN_METAFIELDS;
    }

    cleaned.push(customerCleanup);

    if (!deleteCustomers || dryRun) {
      continue;
    }

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
    cleaned,
    deleted,
    failed,
    remainingMayExist: customers.length === 50,
  });
};
