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

    // precisa ser /products/algum-slug
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

  const imageCandidates = [];

  $('meta[property="og:image"], meta[property="og:image:secure_url"]').each((_, el) => {
    imageCandidates.push({
      src: $(el).attr('content'),
      alt: title
    });
  });

  $('img').each((_, el) => {
    const src =
      $(el).attr('src') ||
      $(el).attr('data-src') ||
      $(el).attr('data-original') ||
      $(el).attr('data-lazy') ||
      $(el).attr('data-srcset') ||
      '';

    const alt = $(el).attr('alt') || '';

    imageCandidates.push({
      src,
      alt
    });
  });

  const images = uniq(
    imageCandidates
      .filter(img => !shouldSkipImage(img))
      .map(img => {
        let src = img.src || '';

        if (src.includes(',')) {
          src = src.split(',')[0].trim().split(' ')[0];
        }

        return absoluteUrl(src, url);
      })
      .filter(src => {
        if (!src) return false;

        const lower = src.toLowerCase();

        if (
          lower.includes('logo') ||
          lower.includes('icon') ||
          lower.includes('loading') ||
          lower.includes('placeholder') ||
          lower.includes('blank') ||
          lower.includes('size') ||
          lower.includes('chart') ||
          lower.includes('measure')
        ) {
          return false;
        }

        return true;
      })
  ).slice(0, 20);

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

  return /jersey|shirt|camisa|football|soccer|retro|home|away|third|player|special|training|pre-match|pre match/.test(t);
}
