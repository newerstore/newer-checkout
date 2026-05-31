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
  if (!res.ok) throw new Error(`Erro ao acessar ${url}: HTTP ${res.status}`);
  return res.text();
}

export async function getProductLinksFromCollection(collectionUrl, maxPages = 3) {
  const links = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const url = `${collectionUrl}${collectionUrl.includes('?') ? '&' : '?'}page=${page}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const before = links.size;
    $('a[href*="/products/"]').each((_, el) => {
      const href = $(el).attr('href');
      const full = absoluteUrl(href, BLUE_SKY_BASE);
      if (full) links.add(full.split('?')[0]);
    });
    if (links.size === before && page > 1) break;
  }
  return [...links];
}

export async function scrapeProduct(url, fallbackTeam = '') {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const h1 = stripText($('h1').first().text());
  const ogTitle = stripText($('meta[property="og:title"]').attr('content') || '');
  const title = h1 || ogTitle || stripText($('title').text()).replace(/\s*[-|].*$/, '');

  const imageCandidates = [];
  $('meta[property="og:image"], meta[property="og:image:secure_url"]').each((_, el) => {
    imageCandidates.push({ src: $(el).attr('content'), alt: title });
  });
  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original') || $(el).attr('data-lazy') || '';
    const alt = $(el).attr('alt') || '';
    imageCandidates.push({ src, alt });
  });

  const images = uniq(imageCandidates
    .filter(img => !shouldSkipImage(img))
    .map(img => absoluteUrl(img.src, url))
    .filter(src => src && !/logo|icon|loading|placeholder|blank/.test(src.toLowerCase()))
  ).slice(0, 12);

  return { sourceUrl: url, sourceTitle: title, fallbackTeam, images };
}

export function isLikelyJersey(title = '') {
  const t = title.toLowerCase();
  if (/jacket|pants|shorts|socks|boots|bag|wallet|hat|cap|tracksuit|training clothes/.test(t)) return false;
  return /jersey|shirt|camisa|football|soccer|retro|home|away|third|player|special|training|pre-match|pre match/.test(t);
}
