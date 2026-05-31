import * as cheerio from 'cheerio';
import { absoluteUrl, uniq, stripText, shouldSkipImage } from './utils.js';
import { BLUE_SKY_BASE } from './config.js';

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 NewEraImporter/1.0',
      'accept': 'text/html,application/xhtml+xml'
    }
  });

  if (!res.ok) {
    throw new Error(`Erro ao acessar ${url}: HTTP ${res.status}`);
  }

  return await res.text();
}

function isValidProductUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');

    if (!path.startsWith('/products/')) return false;
    if (path === '/products') return false;

    const slug = path.replace('/products/', '').trim();

    if (!slug) return false;
    if (slug.length < 3) return false;

    return true;
  } catch {
    return false;
  }
}

function normalizeImageSrc(src = '') {
  let clean = String(src || '').trim();

  if (!clean) return '';

  if (clean.includes(',')) {
    clean = clean.split(',')[0].trim();
  }

  if (clean.includes(' ')) {
    clean = clean.split(' ')[0].trim();
  }

  return clean;
}

function isBadImageUrl(src = '') {
  const lower = String(src || '').toLowerCase();

  if (!lower) return true;

  if (
    lower.includes('logo') ||
    lower.includes('icon') ||
    lower.includes('loading') ||
    lower.includes('placeholder') ||
    lower.includes('blank') ||
    lower.includes('transparent')
  ) {
    return true;
  }

  if (
    lower.includes('size') ||
    lower.includes('chart') ||
    lower.includes('guide') ||
    lower.includes('measurement') ||
    lower.includes('measure') ||
    lower.includes('tabela') ||
    lower.includes('medidas') ||
    lower.includes('dimension') ||
    lower.includes('dimensions') ||
    lower.includes('sizetable') ||
    lower.includes('sizechart') ||
    lower.includes('size-chart') ||
    lower.includes('fan-size') ||
    lower.includes('size-guide') ||
    lower.includes('guide-size') ||
    lower.includes('qq2024') ||
    lower.includes('qq2025') ||
    lower.includes('qq2026') ||
    /qq\d{6,}/i.test(lower)
  ) {
    return true;
  }

  return false;
}

function getMainProductImages($, url, title) {
  const imageCandidates = [];

  $('meta[property="og:image"], meta[property="og:image:secure_url"]').each((_, el) => {
    imageCandidates.push({
      src: $(el).attr('content'),
      alt: title
    });
  });

  const productImageSelectors = [
    '.product img',
    '.product-page img',
    '.product-detail img',
    '.product-info img',
    '.product-gallery img',
    '.product-images img',
    '.goods_img img',
    '.prod_img img',
    '.jqzoom img',
    '.swiper-slide img',
    '.slick-slide img'
  ];

  $(productImageSelectors.join(',')).each((_, el) => {
    const src =
      $(el).attr('src') ||
      $(el).attr('data-src') ||
      $(el).attr('data-original') ||
      $(el).attr('data-lazy') ||
      $(el).attr('data-srcset') ||
      '';

    const alt = $(el).attr('alt') || '';

    imageCandidates.push({ src, alt });
  });

  return uniq(
    imageCandidates
      .filter(img => !shouldSkipImage(img))
      .map(img => absoluteUrl(normalizeImageSrc(img.src), url))
      .filter(src => !isBadImageUrl(src))
  ).slice(0, 5);
}

export async function getProductLinksFromCollection(collectionUrl, maxPages = 3) {
  const links = new Set();

  for (let page = 1; page <= maxPages; page++) {
    const url = `${collectionUrl}${collectionUrl.includes('?') ? '&' : '?'}page=${page}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const before = links.size;

    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      if (!href) return;

      const full = absoluteUrl(href, BLUE_SKY_BASE);
      if (!full) return;

      const cleanUrl = full.split('?')[0].replace(/\/+$/, '');

      if (!isValidProductUrl(cleanUrl)) return;

      links.add(cleanUrl);
    });

    if (links.size === before && page > 1) {
      break;
    }
  }

  return [...links];
}

export async function scrapeProduct(url, fallbackTeam = '') {
  if (!isValidProductUrl(url)) {
    throw new Error(`URL de produto inválida ignorada: ${url}`);
  }

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const h1 = stripText($('h1').first().text());

  const ogTitle = stripText(
    $('meta[property="og:title"]').attr('content') || ''
  );

  const pageTitle = stripText(
    $('title').text()
  ).replace(/\s*[-|].*$/, '');

  const title = h1 || ogTitle || pageTitle;

  const images = getMainProductImages($, url, title);

  return {
    sourceUrl: url,
    sourceTitle: title,
    fallbackTeam,
    images
  };
}

export function isLikelyJersey(title = '') {
  const t = title.toLowerCase();

  if (
    /jacket|pants|shorts|socks|boots|bag|wallet|hat|cap|tracksuit/.test(t)
  ) {
    return false;
  }

  return /jersey|shirt|camisa|football|soccer|retro|home|away|third|player|special|training|treino|pre-match|pre match|pre jogo/.test(t);
}
