const { adminFetch, readBody, sendJson } = require('./shopify');

const PRODUCT_BY_HANDLE_QUERY = `
  query VersenAdminProductByHandle($query: String!) {
    products(first: 1, query: $query) {
      nodes {
        id
        title
        handle
        tags
      }
    }
  }
`;

const TAGS_ADD_MUTATION = `
  mutation VersenTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
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

const TAGS_REMOVE_MUTATION = `
  mutation VersenTagsRemove($id: ID!, $tags: [String!]!) {
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

const FLAGS = {
  fewLeft: 'versen_few_left',
  greatPrice: 'versen_great_price',
};

async function findProduct(handle) {
  const result = await adminFetch(PRODUCT_BY_HANDLE_QUERY, { query: `handle:${handle}` });

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    status: 200,
    body: {
      product: (result.body.data.products.nodes || [])[0] || null,
    },
  };
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

  let body;

  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'Ogiltig JSON' });
    return;
  }

  const handle = String(body.handle || '').trim();
  const tag = FLAGS[body.flag];

  if (!handle || !tag) {
    sendJson(res, 400, { error: 'Produkt och markering krävs' });
    return;
  }

  const productResult = await findProduct(handle);

  if (!productResult.ok) {
    sendJson(res, productResult.status, productResult.body);
    return;
  }

  const product = productResult.body.product;

  if (!product) {
    sendJson(res, 404, { error: 'Produkten hittades inte' });
    return;
  }

  const mutation = body.enabled ? TAGS_ADD_MUTATION : TAGS_REMOVE_MUTATION;
  const result = await adminFetch(mutation, { id: product.id, tags: [tag] });

  if (!result.ok) {
    sendJson(res, result.status, result.body);
    return;
  }

  const payload = body.enabled ? result.body.data.tagsAdd : result.body.data.tagsRemove;

  if (payload.userErrors && payload.userErrors.length) {
    sendJson(res, 400, { error: payload.userErrors.map((item) => item.message).join(', ') });
    return;
  }

  sendJson(res, 200, {
    status: body.enabled ? 'Markeringen är aktiv' : 'Markeringen är borttagen',
    handle,
    flag: body.flag,
    enabled: Boolean(body.enabled),
  });
};
