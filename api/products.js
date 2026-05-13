const fs = require('fs');
const path = require('path');
const { sendJson, shopifyFetch } = require('../lib/shopify');

let cleanImageManifest;
const CLEAN_IMAGE_VERSION = '20260510-cardbg';

function versionCleanImageUrl(url) {
  if (!url || !String(url).startsWith('/assets/product-clean/')) {
    return url;
  }

  return `${url}?v=${CLEAN_IMAGE_VERSION}`;
}

function getCleanImageManifest() {
  if (cleanImageManifest !== undefined) {
    return cleanImageManifest;
  }

  try {
    const file = fs.readFileSync(path.join(process.cwd(), 'assets', 'product-clean-manifest.json'), 'utf8');
    cleanImageManifest = JSON.parse(file);
  } catch (error) {
    cleanImageManifest = null;
  }

  return cleanImageManifest;
}

function withCleanImage(image, cleanImage) {
  if (!cleanImage || !cleanImage.url) {
    return image || null;
  }

  return {
    ...(image || {}),
    url: versionCleanImageUrl(cleanImage.url),
    altText: cleanImage.altText || (image && image.altText) || '',
  };
}

function cleanImageFor(handle, variantId) {
  const manifest = getCleanImageManifest();
  const product = manifest && manifest.products && manifest.products[handle];

  if (!product) {
    return null;
  }

  if (variantId && product.variants && product.variants[variantId]) {
    return product.variants[variantId];
  }

  return product.url ? product : null;
}

const PRODUCTS_QUERY = `
  query VersenProducts($first: Int!) {
    products(first: $first) {
      nodes {
        id
        title
        handle
        vendor
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
      vendor
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
    product.vendor,
    product.title,
    product.handle,
    ...(product.tags || []),
  ].join(' ').toLowerCase();

  if (/(parfym|parfymer|perfume|fragrance|eau de|body mist|ola henriksen|ole henriksen|skönhet|skonhet|smink|makeup|cosmetic|hudvård|hudvard|skincare|skin care)/i.test(source)) {
    return 'Skönhet & Smink';
  }

  if (/(tershine|gyeon|bilschampo|spolar|däck|dack|avfettning|tvätt|tvatt|torkhandduk|mikrofiber|glasrengöring|snabbvax|bilvård|bilvard|wash mitt|drying towel|wetcoat|repel|purify|relive|dissolve|vision)/i.test(source)) {
    return 'Bilvård';
  }

  if (/(barebells|protein|shake|nocco|träning|traning|hälsa|halsa|dryck|nutrition|whey|kreatin|kasein|vassle|collagen|body science|tyngre)/i.test(source)) {
    return 'Träning & hälsa';
  }

  return product.productType && product.productType !== 'Produkt' ? product.productType : 'Övrigt';
}

function normalizeVariant(variant, product) {
  const sourceImage = variant && variant.image ? variant.image : product.featuredImage;
  const image = withCleanImage(sourceImage, cleanImageFor(product.handle, variant && variant.id));

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
  const image = withCleanImage(variant.image || product.featuredImage, cleanImageFor(product.handle, variant.id));
  const tags = product.tags || [];
  const normalizedTags = tags.map((tag) => String(tag).toLowerCase());

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    description: product.description || '',
    vendor: product.vendor || '',
    category: categoryForProduct(product),
    tags,
    flags: {
      fewLeft: normalizedTags.includes('versen_few_left'),
      greatPrice: normalizedTags.includes('versen_great_price'),
    },
    image,
    variantId: variant.id || null,
    availableForSale: Boolean(variant.availableForSale),
    price: variant.price || null,
    compareAtPrice: variant.compareAtPrice || null,
    variants,
  };
}

function isSellableVersenProduct(product) {
  return product && product.handle !== 'medlemskap';
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

    if (!isSellableVersenProduct(result.body.data.product)) {
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

  const products = result.body.data.products.nodes
    .filter(isSellableVersenProduct)
    .map(normalizeProduct);
  sendJson(res, 200, { products });
};
