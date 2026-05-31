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

export function normalizeSeason(rawTitle = '') {
  const text = String(rawTitle || '');

  // 2025/2026, 2025-26, 2026 2027 -> 25/26, 26/27
  const fullRange = text.match(/20(\d{2})\s*[\/\-\s]*\s*(?:20)?(\d{2})/);
  if (fullRange) return `${fullRange[1]}/${fullRange[2]}`;

  // Retro compact: 0203, 9697, 0405 -> 02/03, 96/97, 04/05
  const compactRetro = text.match(/(?:^|\D)(\d{2})(\d{2})(?:\D|$)/);
  if (compactRetro) return `${compactRetro[1]}/${compactRetro[2]}`;

  // Already abbreviated: 25/26, 25-26 -> 25/26
  const pair = text.match(/(?:^|\D)(\d{2})\s*[\/\-]\s*(\d{2})(?:\D|$)/);
  if (pair) return `${pair[1]}/${pair[2]}`;

  const year = text.match(/20\d{2}/);
  return year ? year[0] : '';
}

export function detectTeam(rawTitle, fallbackTeam = '') {
  const compact = rawTitle.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const map = [
    ['sao paulo', 'São Paulo'], ['flamengo', 'Flamengo'], ['flamenco', 'Flamengo'], ['corinthians', 'Corinthians'],
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

export function classifyProduct(rawTitle = '') {
  const t = rawTitle.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const isPlayer = /player|jogador|versao jogador|player version/.test(t);
  const isRetro = /retro|vintage|classic|classica|classico/.test(t);
  const isFemale = /women|woman|female|ladies|lady|feminina|feminino/.test(t);
  const isLongSleeve = /long[-\s]?sleeve|manga longa/.test(t);

  let model = 'Special Edition';

  if (isRetro) model = 'Retrô';
  else if (/training|treino|trainning/.test(t)) model = 'Treino';
  else if (/pre[-\s]?match|pre jogo|pre-jogo|aquecimento|warm[ -]?up/.test(t)) model = 'Pré-jogo';
  else if (/\bhome\b|casa|mandante/.test(t)) model = 'Home';
  else if (/\baway\b|fora|visitante|2nd away|second away/.test(t)) model = 'Away';
  else if (/\bthird\b|3rd|terceira|third kit/.test(t)) model = 'Third';

  const price = (isRetro || isPlayer || isLongSleeve) ? '175.90' : '154.90';

  return { model, isPlayer, isRetro, isFemale, isLongSleeve, price };
}

export function buildShopifyTitle(rawTitle, fallbackTeam) {
  const team = detectTeam(rawTitle, fallbackTeam);
  const season = normalizeSeason(rawTitle);
  const { model, isPlayer, isFemale, isLongSleeve } = classifyProduct(rawTitle);

  const parts = ['Camisa', team, model];

  if (isLongSleeve) parts.push('Manga Longa');
  if (isPlayer && model !== 'Retrô') parts.push('Jogador');
  if (season) parts.push(season);
  if (isFemale) parts.push('Feminina');

  return stripText(parts.join(' '));
}

export function shouldSkipImage({ src = '', alt = '' }) {
  const t = `${src} ${alt}`.toLowerCase();
  return /size|chart|guide|measurement|measure|medida|medidas|tabela|尺寸|尺码/.test(t);
}
