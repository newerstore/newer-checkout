import slugify from 'slugify';

export function absoluteUrl(url, base) {
  if (!url) return null;
  if (url.startsWith('//')) return `https:${url}`;
  try { return new URL(url, base).href; } catch { return null; }
}

export function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }

export function stripText(text = '') {
  return text.replace(/\s+/g, ' ').trim();
}

export function makeHandle(title) {
  return slugify(title, { lower: true, strict: true, locale: 'pt' });
}

export function htmlDescriptionFromText(text) {
  return text.split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}

export function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function normalizeSeason(rawTitle) {
  const title = rawTitle.replace(/20(\d{2})[\/\-\s]*(?:20)?(\d{2})/g, (_, a, b) => `${a}/${b}`);
  const pair = title.match(/(?:^|\D)(\d{2})\s*[\/\-]\s*(\d{2})(?:\D|$)/);
  if (pair) return `${pair[1]}/${pair[2]}`;
  const year = title.match(/20\d{2}/);
  return year ? year[0] : '';
}

export function detectTeam(rawTitle, fallbackTeam = '') {
  const compact = rawTitle.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const map = [
    ['sao paulo', 'São Paulo'], ['flamengo', 'Flamengo'], ['corinthians', 'Corinthians'],
    ['palmeiras', 'Palmeiras'], ['atletico-mg', 'Atlético-MG'], ['atletico mg', 'Atlético-MG'],
    ['athletico-pr', 'Athletico-PR'], ['athletico pr', 'Athletico-PR'], ['bahia', 'Bahia'],
    ['botafogo', 'Botafogo'], ['chapecoense', 'Chapecoense'], ['coritiba', 'Coritiba'],
    ['cruzeiro', 'Cruzeiro'], ['fluminense', 'Fluminense'], ['gremio', 'Grêmio'],
    ['internacional', 'Internacional'], ['mirassol', 'Mirassol'], ['red bull bragantino', 'Red Bull Bragantino'],
    ['bragantino', 'Red Bull Bragantino'], ['remo', 'Remo'], ['santos', 'Santos'],
    ['vasco', 'Vasco'], ['vitoria', 'Vitória']
  ];
  const found = map.find(([needle]) => compact.includes(needle));
  return found ? found[1] : fallbackTeam;
}

export function classifyProduct(rawTitle) {
  const t = rawTitle.toLowerCase();
  const isPlayer = /player|jogador/.test(t);
  const isRetro = /retro|vintage|classic/.test(t);
  let model = 'Special Edition';
  if (/\bhome\b/.test(t)) model = 'Home';
  else if (/\baway\b|2nd away|second away/.test(t)) model = 'Away';
  else if (/\bthird\b|3rd/.test(t)) model = 'Third';
  if (isRetro) model = 'Retro';
  const price = (isRetro || isPlayer) ? '175.90' : '154.90';
  return { model, isPlayer, isRetro, price };
}

export function buildShopifyTitle(rawTitle, fallbackTeam) {
  const team = detectTeam(rawTitle, fallbackTeam);
  const season = normalizeSeason(rawTitle);
  const { model, isPlayer } = classifyProduct(rawTitle);
  const parts = ['Camisa', team, model];
  if (isPlayer) parts.push('Jogador');
  if (season) parts.push(season);
  return stripText(parts.join(' '));
}

export function shouldSkipImage({ src = '', alt = '' }) {
  const t = `${src} ${alt}`.toLowerCase();
  return /size|chart|guide|measurement|measure|medida|medidas|tabela|尺寸|尺码/.test(t);
}
