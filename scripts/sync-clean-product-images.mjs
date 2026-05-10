import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT_DIR = path.join(ROOT, 'assets', 'product-clean');
const MANIFEST_PATH = path.join(ROOT, 'assets', 'product-clean-manifest.json');
const TMP_DIR = path.join(ROOT, 'assets', '.product-clean-tmp');
const API_URL = process.env.PRODUCT_API_URL || 'https://versen.se/api/products';
const CANVAS_SIZE = Number(process.env.PRODUCT_IMAGE_CANVAS || 1600);
const MAX_IMAGE_SIZE = Number(process.env.PRODUCT_IMAGE_SIZE || 1320);

function slugify(value) {
  return String(value || 'product')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'product';
}

function shortHash(value) {
  return createHash('sha1').update(String(value || '')).digest('hex').slice(0, 10);
}

function extFromContentType(contentType) {
  if (/png/i.test(contentType)) return '.png';
  if (/webp/i.test(contentType)) return '.webp';
  if (/gif/i.test(contentType)) return '.gif';
  return '.jpg';
}

async function download(url, filePath) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(filePath, bytes);
  return response.headers.get('content-type') || '';
}

async function convertToCleanImage(inputPath, outputPath) {
  await execFileAsync('sips', [
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', '92',
    '-Z', String(MAX_IMAGE_SIZE),
    '--padToHeightWidth', String(CANVAS_SIZE), String(CANVAS_SIZE),
    '--padColor', 'FFFFFF',
    inputPath,
    '--out', outputPath,
  ]);
}

function imageCandidates(product) {
  const candidates = [];
  const seen = new Set();

  const add = (type, id, image) => {
    if (!image || !image.url || seen.has(image.url)) return;
    seen.add(image.url);
    candidates.push({
      type,
      id,
      image,
    });
  };

  add('product', product.handle, product.image);

  (product.variants || []).forEach((variant) => {
    add('variant', variant.id, variant.image);
  });

  return candidates;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });

  const response = await fetch(API_URL);

  if (!response.ok) {
    throw new Error(`Could not fetch products from ${API_URL}: ${response.status}`);
  }

  const data = await response.json();
  const products = (data.products || []).filter((product) => product.handle && product.handle !== 'medlemskap');
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: API_URL,
    canvasSize: CANVAS_SIZE,
    products: {},
  };

  for (const product of products) {
    const productEntry = {
      title: product.title || '',
      vendor: product.vendor || '',
      url: '',
      altText: product.image?.altText || product.title || '',
      variants: {},
    };

    for (const candidate of imageCandidates(product)) {
      const sourceUrl = candidate.image.url;
      const baseName = candidate.type === 'product'
        ? slugify(product.handle)
        : `${slugify(product.handle)}-${shortHash(candidate.id || sourceUrl)}`;
      const rawPath = path.join(TMP_DIR, `${baseName}-raw`);
      const contentType = await download(sourceUrl, rawPath);
      const inputPath = `${rawPath}${extFromContentType(contentType)}`;
      await rm(inputPath, { force: true });
      await writeFile(inputPath, await readFile(rawPath));
      const outputName = `${baseName}.jpg`;
      const outputPath = path.join(OUT_DIR, outputName);

      await convertToCleanImage(inputPath, outputPath);

      const localUrl = `/assets/product-clean/${outputName}`;

      if (candidate.type === 'product') {
        productEntry.url = localUrl;
        productEntry.altText = candidate.image.altText || product.title || '';
      } else {
        productEntry.variants[candidate.id] = {
          url: localUrl,
          altText: candidate.image.altText || product.title || '',
        };
      }

      console.log(`${product.handle}: ${localUrl}`);
    }

    if (!productEntry.url && Object.values(productEntry.variants)[0]) {
      productEntry.url = Object.values(productEntry.variants)[0].url;
    }

    manifest.products[product.handle] = productEntry;
  }

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  await rm(TMP_DIR, { recursive: true, force: true });

  console.log(`Wrote ${Object.keys(manifest.products).length} products to ${path.relative(ROOT, MANIFEST_PATH)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
