import { TEST_COLLECTIONS } from '../lib/config.js';
import { getProductLinksFromCollection, scrapeProduct, isLikelyJersey } from '../lib/scraper.js';
import { createProduct } from '../lib/shopify.js';

const LIMIT = 999;
const PAGES = 5;

let processed = 0;

for (const collection of TEST_COLLECTIONS) {
  console.log(`\n=== ${collection.team} ===\n`);

  const links = await getProductLinksFromCollection(
    collection.url,
    PAGES
  );

  for (const link of links) {
    if (processed >= LIMIT) break;

    try {
      const product = await scrapeProduct(
        link,
        collection.team
      );

      if (!isLikelyJersey(product.sourceTitle)) {
        console.log('SKIP:', product.sourceTitle);
        continue;
      }

      if (!product.images?.length) {
        console.log('SEM IMG:', product.sourceTitle);
        continue;
      }

      const result = await createProduct(product, {
        dryRun: false
      });

      console.log(
        'OK:',
        product.sourceTitle,
        result?.created ? 'CRIADO' : 'EXISTE'
      );

      processed++;
    } catch (err) {
      console.log(
        'ERRO:',
        link,
        err.message
      );
    }
  }
}

console.log('\nFINALIZADO');
