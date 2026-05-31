import { SHOPIFY_ADMIN_ACCESS_TOKEN, SHOPIFY_API_VERSION, SHOPIFY_STORE_DOMAIN, COLLECTION_NAME, SIZES_BR, STORE_DESCRIPTION } from './config.js';
import { classifyProduct, makeHandle, htmlDescriptionFromText, detectTeam } from './utils.js';

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
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new Error(`Shopify ${res.status} ${path}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }

  return data;
}

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeTag(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function seasonFromTitle(title = '') {
  const text = String(title || '');

  // 2026/2027, 2026-2027, 2026-27 -> 26/27
  let m = text.match(/20(\d{2})\s*[\/\-]\s*(?:20)?(\d{2})/);
  if (m) {
    return `${m[1]}/${m[2]}`;
  }

  // Anos históricos únicos: 1981, 1995, 2008, 2012 etc.
  m = text.match(/\b(19\d{2}|20\d{2})\b/);
  if (m) {
    return m[1];
  }

  // Temporadas compactas retrô: 0203 -> 02/03, 9697 -> 96/97
  m = text.match(/\b(\d{2})(\d{2})\b/);
  if (m) {
    return `${m[1]}/${m[2]}`;
  }

  return '';
}

function classifyModelForTitle(sourceTitle = '') {
  const t = normalizeText(sourceTitle);
  const base = classifyProduct(sourceTitle);

  const isPlayer = /player|jogador|versao jogador|player version/.test(t);
  const isRetro = /retro|vintage|classic|classica|classico/.test(t);
  const isFemale = /women|woman|female|ladies|lady|feminina|feminino/.test(t);
  const isLongSleeve = /long[-\s]?sleeve|manga longa/.test(t);

  let model = 'Special Edition';

  if (isRetro) {
    model = 'Retrô';
  } else if (/training|treino|trainning/.test(t)) {
    model = 'Treino';
  } else if (/pre[-\s]?match|pre jogo|pre-jogo|aquecimento|warm[ -]?up/.test(t)) {
    model = 'Pré-jogo';
  } else if (/\bhome\b|casa|mandante/.test(t)) {
    model = 'Home';
  } else if (/\baway\b|fora|visitante|2nd away|second away/.test(t)) {
    model = 'Away';
  } else if (/\bthird\b|3rd|terceira|third kit/.test(t)) {
    model = 'Third';
  } else if (base?.model) {
    model = base.model;
  }

  return {
    model,
    isPlayer,
    isRetro,
    isFemale,
    isLongSleeve,
    season: seasonFromTitle(sourceTitle)
  };
}

function buildNewEraTitle(sourceTitle = '', fallbackTeam = '') {
  const team = detectTeam(sourceTitle, fallbackTeam) || fallbackTeam || '';
  const { model, isPlayer, isFemale, isLongSleeve, season } = classifyModelForTitle(sourceTitle);

  const parts = ['Camisa', team, model];

  if (isLongSleeve) {
    parts.push('Manga Longa');
  }

  if (isPlayer && model !== 'Retrô') {
    parts.push('Jogador');
  }

  if (season) {
    parts.push(season);
  }

  if (isFemale) {
    parts.push('Feminina');
  }

  return parts
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPriceFromSourceTitle(sourceTitle = '') {
  const local = classifyModelForTitle(sourceTitle);
  const t = normalizeText(sourceTitle);

  if (
    local.isRetro ||
    local.isPlayer ||
    local.isLongSleeve ||
    /player version|versao jogador|jogador/.test(t)
  ) {
    return '175.90';
  }

  return '154.90';
}

function getTagsFromProduct(sourceProduct, model, isPlayer, isRetro, isFemale, isLongSleeve) {
  const tags = [
    'brasileirao',
    normalizeTag(sourceProduct.fallbackTeam),
    normalizeTag(model),
    isPlayer ? 'jogador' : 'torcedor',
    isRetro ? 'retro' : null,
    isFemale ? 'feminina' : null,
    isLongSleeve ? 'manga-longa' : null
  ].filter(Boolean);

  return [...new Set(tags)].join(', ');
}

export async function findProductByHandle(handle) {
  const data = await shopifyFetch(`/products.json?handle=${encodeURIComponent(handle)}&fields=id,title,handle,status`);
  return data.products?.[0] || null;
}

export async function getOrCreateCollection(title = COLLECTION_NAME) {
  const existing = await shopifyFetch(`/custom_collections.json?title=${encodeURIComponent(title)}&fields=id,title,handle`);

  if (existing.custom_collections?.length) {
    return existing.custom_collections[0];
  }

  const created = await shopifyFetch('/custom_collections.json', {
    method: 'POST',
    body: JSON.stringify({
      custom_collection: {
        title,
        published: false
      }
    })
  });

  return created.custom_collection;
}

export async function addProductToCollection(productId, collectionId) {
  try {
    await shopifyFetch('/collects.json', {
      method: 'POST',
      body: JSON.stringify({
        collect: {
          product_id: productId,
          collection_id: collectionId
        }
      })
    });
  } catch (err) {
    if (!String(err.message).includes('already exists')) {
      throw err;
    }
  }
}

export function buildProductPayload(sourceProduct) {
  const title = buildNewEraTitle(sourceProduct.sourceTitle, sourceProduct.fallbackTeam);
  const handle = makeHandle(title);

  const localClassification = classifyModelForTitle(sourceProduct.sourceTitle);
  const model = localClassification.model;
  const isPlayer = localClassification.isPlayer;
  const isRetro = localClassification.isRetro;
  const isFemale = localClassification.isFemale;
  const isLongSleeve = localClassification.isLongSleeve;
  const price = getPriceFromSourceTitle(sourceProduct.sourceTitle);

  const tags = getTagsFromProduct(sourceProduct, model, isPlayer, isRetro, isFemale, isLongSleeve);

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
      options: [
        {
          name: 'Tamanho',
          values: SIZES_BR
        }
      ],
      variants,
      images: sourceProduct.images.map(src => ({ src })),
      metafields: [
        {
          namespace: 'custom',
          key: 'personalizacao_opcoes',
          type: 'json',
          value: JSON.stringify({
            opcoes: [
              {
                nome: 'Sem Personalização',
                adicional: 0
              },
              {
                nome: 'Personalização',
                adicional: 20
              }
            ]
          })
        },
        {
          namespace: 'custom',
          key: 'patch_opcoes',
          type: 'json',
          value: JSON.stringify({
            opcoes: [
              {
                nome: 'Sem Patch',
                adicional: 0
              },
              {
                nome: 'Brasileirão',
                adicional: 15
              },
              {
                nome: 'Libertadores',
                adicional: 27
              }
            ]
          })
        },
        {
          namespace: 'importacao',
          key: 'fonte_url',
          type: 'single_line_text_field',
          value: sourceProduct.sourceUrl
        }
      ]
    }
  };
}

export async function createProduct(sourceProduct, { dryRun = true } = {}) {
  const payload = buildProductPayload(sourceProduct);
  const handle = payload.product.handle;

  if (dryRun) {
    return {
      dryRun: true,
      action: 'would_create',
      payload
    };
  }

  const existing = await findProductByHandle(handle);

  if (existing) {
    return {
      skipped: true,
      reason: 'already_exists',
      product: existing
    };
  }

  const created = await shopifyFetch('/products.json', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  const collection = await getOrCreateCollection(COLLECTION_NAME);
  await addProductToCollection(created.product.id, collection.id);

  return {
    created: true,
    product: {
      id: created.product.id,
      title: created.product.title,
      handle: created.product.handle,
      status: created.product.status
    }
  };
}
