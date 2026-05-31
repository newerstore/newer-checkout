import { TEST_COLLECTIONS, IMPORT_SECRET } from '../lib/config.js';
import { getProductLinksFromCollection, scrapeProduct, isLikelyJersey } from '../lib/scraper.js';
import { createProduct, buildProductPayload } from '../lib/shopify.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ error: 'Use GET ou POST' });
    }

    const secret = req.query.secret || req.headers['x-import-secret'];
    if (IMPORT_SECRET && secret !== IMPORT_SECRET) {
      return res.status(401).json({ error: 'Secret inválido.' });
    }

    const dryRun = String(req.query.dry_run ?? 'true') !== 'false';
    const limit = Math.min(Number(req.query.limit || 12), 40);
    const maxPages = Math.min(Number(req.query.pages || 2), 5);

    const report = [];
const createdTitles = new Set();
let processed = 0;;

    for (const collection of TEST_COLLECTIONS) {
      const links = await getProductLinksFromCollection(collection.url, maxPages);
      for (const link of links) {
        if (processed >= limit) break;
        try {
          const sourceProduct = await scrapeProduct(link, collection.team);
          if (!isLikelyJersey(sourceProduct.sourceTitle)) {
  report.push({
    team: collection.team,
    url: link,
    skipped: true,
    reason: 'not_likely_jersey',
    sourceTitle: sourceProduct.sourceTitle
  });
  continue;
}

if (!sourceProduct.images?.length) {
  report.push({
    team: collection.team,
    url: link,
    skipped: true,
    reason: 'no_images',
    sourceTitle: sourceProduct.sourceTitle
  });
  continue;
}
          const preview = buildProductPayload(sourceProduct).product;

if (createdTitles.has(preview.title)) {
  report.push({
    team: collection.team,
    skipped: true,
    reason: 'duplicate_title',
    title: preview.title
  });
  continue;
}

createdTitles.add(preview.title);

const result = await createProduct(sourceProduct, { dryRun });

report.push({
            team: collection.team,
            sourceTitle: sourceProduct.sourceTitle,
            shopifyTitle: preview.title,
            price: preview.variants?.[0]?.price,
            images: sourceProduct.images.length,
            result
          });
          processed++;
        } catch (error) {
          report.push({ team: collection.team, url: link, error: error.message });
        }
      }
      if (processed >= limit) break;
    }

    return res.status(200).json({
      ok: true,
      mode: dryRun ? 'dry_run_preview' : 'create_drafts',
      processed,
      collections: TEST_COLLECTIONS.map(c => c.team),
      report
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}

