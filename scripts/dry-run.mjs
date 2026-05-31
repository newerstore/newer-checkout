import { TEST_COLLECTIONS } from '../lib/config.js';
import { getProductLinksFromCollection, scrapeProduct, isLikelyJersey } from '../lib/scraper.js';
import { buildProductPayload } from '../lib/shopify.js';

for (const collection of TEST_COLLECTIONS) {
  console.log('\n##', collection.team);
  const links = await getProductLinksFromCollection(collection.url, 1);
  for (const link of links.slice(0, 3)) {
    const p = await scrapeProduct(link, collection.team);
    if (!isLikelyJersey(p.sourceTitle)) continue;
    const payload = buildProductPayload(p).product;
    console.log('-', p.sourceTitle, '=>', payload.title, payload.variants[0].price, `${p.images.length} imagens`);
  }
}
