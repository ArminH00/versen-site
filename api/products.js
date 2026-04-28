const { sendJson, shopifyFetch } = require('./shopify');

const PRODUCTS_QUERY = `
  query VersenProducts($first: Int!) {
    products(first: $first) {
      nodes {
        id
        title
        handle
        tags
        productType
        featuredImage {
          url
          altText
        }
        variants(first: 20) {
          nodes {
            id
            title
            availableForSale
            selectedOptions {
              name
              value
            }
            image {
              url
              altText
            }
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
      tags
      productType
      featuredImage {
        url
        altText
      }
      variants(first: 20) {
        nodes {
          id
          title
          availableForSale
          selectedOptions {
            name
            value
          }
          image {
            url
            altText
          }
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

function categoryForProduct(product) {
  const source = [
    product.productType,
    product.title,
    product.handle,
    ...(product.tags || []),
  ].join(' ').toLowerCase();

  if (/(tershine|gyeon|bilschampo|spolar|däck|dack|avfettning|tvätt|tvatt|torkhandduk|mikrofiber|glasrengöring|snabbvax|bilvård|bilvard|wash mitt|drying towel|wetcoat|repel|purify|relive|dissolve|vision)/i.test(source)) {
    return 'Bilvård';
  }

  if (/(barebells|protein|shake|nocco|träning|traning|hälsa|halsa|dryck|nutrition)/i.test(source)) {
    return 'Träning & hälsa';
  }

  return product.productType && product.productType !== 'Produkt' ? product.productType : 'Övrigt';
}

function normalizeVariant(variant, product) {
  const image = variant && variant.image ? variant.image : product.featuredImage;

  return {
    id: variant ? variant.id : null,
    title: variant ? variant.title : '',
    label: variant && variant.title && variant.title !== 'Default Title' ? variant.title : '',
    availableForSale: variant ? variant.availableForSale : false,
    selectedOptions: variant ? variant.selectedOptions || [] : [],
    image,
    price: formatPrice(variant && variant.price),
    compareAtPrice: formatPrice(variant && variant.compareAtPrice),
  };
}

function normalizeProduct(product) {
  const variants = (product.variants.nodes || []).map((variant) => normalizeVariant(variant, product));
  const variant = variants.find((item) => item.availableForSale) || variants[0] || {};
  const image = variant.image || product.featuredImage;

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    description: product.description || '',
    category: categoryForProduct(product),
    tags: product.tags || [],
    image,
    variantId: variant.id || null,
    availableForSale: Boolean(variant.availableForSale),
    price: variant.price || null,
    compareAtPrice: variant.compareAtPrice || null,
    variants,
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

  const result = await shopifyFetch(PRODUCTS_QUERY, { first: 100 });

  if (!result.ok) {
    sendJson(res, result.status, result.body);
    return;
  }

  const products = result.body.data.products.nodes.map(normalizeProduct);
  sendJson(res, 200, { products });
};
