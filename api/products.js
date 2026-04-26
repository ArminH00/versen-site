const { sendJson, shopifyFetch } = require('./shopify');

const PRODUCTS_QUERY = `
  query VersenProducts($first: Int!) {
    products(first: $first) {
      nodes {
        id
        title
        handle
        productType
        featuredImage {
          url
          altText
        }
        variants(first: 1) {
          nodes {
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
          }
        }
      }
    }
  }
`;

const PRODUCT_BY_HANDLE_QUERY = `
  query VersenProductByHandle($handle: String!) {
    product(handle: $handle) {
      id
      title
      handle
      description
      productType
      featuredImage {
        url
        altText
      }
      variants(first: 1) {
        nodes {
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
        }
      }
    }
  }
`;

function formatPrice(price) {
  if (!price) return null;

  const amount = Number(price.amount);
  const currency = price.currencyCode === 'SEK' ? 'kr' : price.currencyCode;

  if (Number.isNaN(amount)) {
    return null;
  }

  return `${Math.round(amount)} ${currency}`;
}

function normalizeProduct(product) {
  const variant = product.variants.nodes[0];

    return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    description: product.description || '',
    category: product.productType || 'Produkt',
    image: product.featuredImage,
    variantId: variant ? variant.id : null,
    availableForSale: variant ? variant.availableForSale : false,
    price: formatPrice(variant && variant.price),
    compareAtPrice: formatPrice(variant && variant.compareAtPrice),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Metoden stöds inte' });
    return;
  }

  const url = new URL(req.url || '/', 'https://versen.local');
  const handle = url.searchParams.get('handle');

  if (handle) {
    const result = await shopifyFetch(PRODUCT_BY_HANDLE_QUERY, { handle });

    if (!result.ok) {
      sendJson(res, result.status, result.body);
      return;
    }

    if (!result.body.data.product) {
      sendJson(res, 404, { error: 'Produkten hittades inte' });
      return;
    }

    sendJson(res, 200, { product: normalizeProduct(result.body.data.product) });
    return;
  }

  const result = await shopifyFetch(PRODUCTS_QUERY, { first: 24 });

  if (!result.ok) {
    sendJson(res, result.status, result.body);
    return;
  }

  const products = result.body.data.products.nodes.map(normalizeProduct);
  sendJson(res, 200, { products });
};
