import { SHOPIFY_ADMIN_ACCESS_TOKEN, SHOPIFY_API_VERSION, SHOPIFY_STORE_DOMAIN, COLLECTION_NAME, SIZES_BR, STORE_DESCRIPTION } from './config.js';
import { buildShopifyTitle, classifyProduct, makeHandle, htmlDescriptionFromText } from './utils.js';

function requireShopifyEnv() {
  if (!SHOPIFY_ADMIN_ACCESS_TOKEN) throw new Error('Faltou SHOPIFY_ADMIN_ACCESS_TOKEN nas variáveis da Vercel.');
  if (!SHOPIFY_STORE_DOMAIN) throw new Error('Faltou SHOPIFY_STORE_DOMAIN nas variáveis da Vercel.');
}

async function shopifyFetch(path, options = {}) {
  requireShopifyEnv();
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`Shopify ${res.status} ${path}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

export async function findProductByHandle(handle) {
  const data = await shopifyFetch(`/products.json?handle=${encodeURIComponent(handle)}&fields=id,title,handle,status`);
  return data.products?.[0] || null;
}

export async function getOrCreateCollection(title = COLLECTION_NAME) {
  const existing = await shopifyFetch(`/custom_collections.json?title=${encodeURIComponent(title)}&fields=id,title,handle`);
  if (existing.custom_collections?.length) return existing.custom_collections[0];
  const created = await shopifyFetch('/custom_collections.json', {
    method: 'POST',
    body: JSON.stringify({ custom_collection: { title, published: false } })
  });
  return created.custom_collection;
}

export async function addProductToCollection(productId, collectionId) {
  try {
    await shopifyFetch('/collects.json', {
      method: 'POST',
      body: JSON.stringify({ collect: { product_id: productId, collection_id: collectionId } })
    });
  } catch (err) {
    if (!String(err.message).includes('already exists')) throw err;
  }
}

export function buildProductPayload(sourceProduct) {
  const title = buildShopifyTitle(sourceProduct.sourceTitle, sourceProduct.fallbackTeam);
  const handle = makeHandle(title);
  const { model, isPlayer, isRetro, price } = classifyProduct(sourceProduct.sourceTitle);
  const tags = [
    'brasileirao',
    sourceProduct.fallbackTeam?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-'),
    model.toLowerCase().replace(/\s+/g, '-'),
    isPlayer ? 'jogador' : 'torcedor',
    isRetro ? 'retro' : null
  ].filter(Boolean).join(', ');

  const variants = SIZES_BR.map((size, idx) => ({
    option1: size,
    price,
    sku: '',
    inventory_management: null,
    inventory_policy: 'continue',
    taxable: false,
    requires_shipping: true,
    position: idx + 1
  }));

  return {
    product: {
      title,
      handle,
      body_html: htmlDescriptionFromText(STORE_DESCRIPTION),
      vendor: 'New Era Store',
      product_type: 'Camisa de Time',
      status: 'draft',
      tags,
      options: [{ name: 'Tamanho', values: SIZES_BR }],
      variants,
      images: sourceProduct.images.map(src => ({ src })),
      metafields: [
        { namespace: 'custom', key: 'personalizacao_opcoes', type: 'json', value: JSON.stringify({ opcoes: [{ nome: 'Sem Personalização', adicional: 0 }, { nome: 'Personalização', adicional: 20 }] }) },
        { namespace: 'custom', key: 'patch_opcoes', type: 'json', value: JSON.stringify({ opcoes: [{ nome: 'Sem Patch', adicional: 0 }, { nome: 'Brasileirão', adicional: 15 }, { nome: 'Libertadores', adicional: 27 }] }) },
        { namespace: 'importacao', key: 'fonte_url', type: 'single_line_text_field', value: sourceProduct.sourceUrl }
      ]
    }
  };
}

export async function createProduct(sourceProduct, { dryRun = true } = {}) {
  const payload = buildProductPayload(sourceProduct);
  const handle = payload.product.handle;
  if (dryRun) return { dryRun: true, action: 'would_create', payload };

  const existing = await findProductByHandle(handle);
  if (existing) return { skipped: true, reason: 'already_exists', product: existing };

  const created = await shopifyFetch('/products.json', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  const collection = await getOrCreateCollection(COLLECTION_NAME);
  await addProductToCollection(created.product.id, collection.id);
  return { created: true, product: { id: created.product.id, title: created.product.title, handle: created.product.handle, status: created.product.status } };
}
