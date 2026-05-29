// /api/get-shopify-order.js
// Endpoint seguro para buscar os dados REAIS do pedido na Shopify
// Coloque este arquivo na pasta /api do projeto na Vercel.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://newer-store.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido. Use GET.' });
  }

  try {
    const { order, id, email, phone } = req.query;

    if (!order && !id) {
      return res.status(400).json({
        error: 'Informe o número do pedido ou ID do pedido.',
        exemplo: '/api/get-shopify-order?order=3141'
      });
    }

    const SHOPIFY_STORE =
      process.env.SHOPIFY_STORE ||
      process.env.SHOPIFY_STORE_DOMAIN ||
      process.env.SHOPIFY_SHOP;

    const SHOPIFY_ADMIN_ACCESS_TOKEN =
      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ||
      process.env.SHOPIFY_ADMIN_TOKEN ||
      process.env.SHOPIFY_ACCESS_TOKEN;

    const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';

    if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return res.status(500).json({
        error: 'Variáveis da Shopify não configuradas na Vercel.',
        required: ['SHOPIFY_STORE', 'SHOPIFY_ADMIN_ACCESS_TOKEN', 'SHOPIFY_API_VERSION']
      });
    }

    async function shopifyGet(path) {
      const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}${path}`, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const err = new Error('Erro ao consultar Shopify.');
        err.status = response.status;
        err.details = data;
        throw err;
      }

      return data;
    }

    let shopifyOrder;

    if (id) {
      const data = await shopifyGet(`/orders/${id}.json?status=any`);
      shopifyOrder = data.order;
    } else {
      const cleanOrder = String(order).replace('#', '').trim();

      // Primeiro tenta pelo nome exato "#3141"
      let data = await shopifyGet(`/orders.json?status=any&name=%23${encodeURIComponent(cleanOrder)}&limit=1`);

      // Fallback: algumas lojas/API podem falhar no filtro name.
      // Então busca os últimos pedidos e filtra manualmente.
      if (!data.orders || !data.orders.length) {
        data = await shopifyGet(`/orders.json?status=any&limit=250&order=created_at desc`);
        shopifyOrder = (data.orders || []).find((o) => {
          const n1 = String(o.name || '').replace('#', '').trim();
          const n2 = String(o.order_number || '').trim();
          return n1 === cleanOrder || n2 === cleanOrder;
        });
      } else {
        shopifyOrder = data.orders[0];
      }
    }

    if (!shopifyOrder) {
      return res.status(404).json({ error: 'Pedido não encontrado na Shopify.' });
    }

    // Validação opcional caso a página envie email/telefone.
    const orderEmail = String(
      shopifyOrder.email ||
      shopifyOrder.contact_email ||
      shopifyOrder.customer?.email ||
      ''
    ).toLowerCase().trim();

    const orderPhone = String(
      shopifyOrder.phone ||
      shopifyOrder.customer?.phone ||
      shopifyOrder.shipping_address?.phone ||
      shopifyOrder.billing_address?.phone ||
      ''
    ).replace(/\D/g, '');

    const requestEmail = String(email || '').toLowerCase().trim();
    const requestPhone = String(phone || '').replace(/\D/g, '');

    if (requestEmail && orderEmail && requestEmail !== orderEmail) {
      return res.status(403).json({ error: 'E-mail não confere com o pedido.' });
    }

    if (requestPhone && orderPhone && !orderPhone.endsWith(requestPhone.slice(-8))) {
      return res.status(403).json({ error: 'Telefone não confere com o pedido.' });
    }

    const shipping = shopifyOrder.shipping_address || {};
    const billing = shopifyOrder.billing_address || {};
    const customer = shopifyOrder.customer || {};

    function firstValue(...values) {
      return values.find((v) => v !== undefined && v !== null && String(v).trim() !== '') || '';
    }

    function readNoteAttribute(keys) {
      const attrs = [
        ...(shopifyOrder.note_attributes || []),
        ...(shopifyOrder.custom_attributes || [])
      ];

      const found = attrs.find((attr) => {
        const name = String(attr.name || attr.key || '').toLowerCase().trim();
        return keys.some((key) => name.includes(key));
      });

      return found ? firstValue(found.value) : '';
    }

    // Busca imagens dos produtos/variantes.
    // O pedido da Shopify muitas vezes NÃO traz imagem dentro de line_items.
    const imageCache = new Map();

    async function getProductImage(item) {
      const productId = item.product_id;
      const variantId = item.variant_id;

      if (!productId) return '';

      if (imageCache.has(productId)) {
        const cachedProduct = imageCache.get(productId);
        return pickImageFromProduct(cachedProduct, variantId);
      }

      try {
        const data = await shopifyGet(`/products/${productId}.json?fields=id,title,image,images,variants`);
        const product = data.product || {};
        imageCache.set(productId, product);
        return pickImageFromProduct(product, variantId);
      } catch (e) {
        console.log('Erro ao buscar imagem do produto:', productId, e.message);
        return '';
      }
    }

    function pickImageFromProduct(product, variantId) {
      const images = product.images || [];
      const mainImage = product.image?.src || '';

      if (variantId && images.length) {
        const variantImage = images.find((img) => {
          const variantIds = img.variant_ids || [];
          return variantIds.map(String).includes(String(variantId));
        });

        if (variantImage?.src) return variantImage.src;
      }

      return mainImage || images[0]?.src || '';
    }

    const items = await Promise.all((shopifyOrder.line_items || []).map(async (item) => {
      const image = await getProductImage(item);

      return {
        id: item.id,
        product_id: item.product_id || '',
        variant_id: item.variant_id || '',
        title: item.title || item.name || 'Produto Newer',
        variant_title: item.variant_title || '',
        quantity: item.quantity || 1,
        price: item.price || '0.00',
        line_price: String(Number(item.price || 0) * Number(item.quantity || 1)),
        sku: item.sku || '',
        image
      };
    }));

    const normalized = {
      id: shopifyOrder.id,
      order_number: shopifyOrder.name || `#${shopifyOrder.order_number}`,
      order_name: shopifyOrder.name || `#${shopifyOrder.order_number}`,
      created_at: shopifyOrder.created_at,

      customer: {
        name: firstValue(
          `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
          shipping.name,
          billing.name,
          readNoteAttribute(['nome', 'name']),
          'Cliente NEWER'
        ),
        email: firstValue(
          shopifyOrder.email,
          shopifyOrder.contact_email,
          customer.email,
          readNoteAttribute(['email', 'e-mail'])
        ),
        phone: firstValue(
          shopifyOrder.phone,
          customer.phone,
          shipping.phone,
          billing.phone,
          readNoteAttribute(['telefone', 'phone', 'whatsapp', 'celular'])
        )
      },

      shipping_address: {
        name: firstValue(shipping.name, billing.name),
        address1: firstValue(
          shipping.address1,
          billing.address1,
          readNoteAttribute(['endereco', 'endereço', 'rua', 'address'])
        ),
        address2: firstValue(
          shipping.address2,
          billing.address2,
          readNoteAttribute(['complemento', 'bairro', 'numero', 'número'])
        ),
        city: firstValue(shipping.city, billing.city, readNoteAttribute(['cidade', 'city'])),
        province: firstValue(
          shipping.province,
          shipping.province_code,
          billing.province,
          billing.province_code,
          readNoteAttribute(['estado', 'uf', 'state'])
        ),
        zip: firstValue(shipping.zip, billing.zip, readNoteAttribute(['cep', 'zip', 'postal'])),
        phone: firstValue(shipping.phone, billing.phone, customer.phone)
      },

      payment_method:
        Array.isArray(shopifyOrder.payment_gateway_names) && shopifyOrder.payment_gateway_names.length
          ? shopifyOrder.payment_gateway_names.join(', ')
          : 'Mercado Pago',

      payment_status: shopifyOrder.financial_status || 'paid',
      fulfillment_status: shopifyOrder.fulfillment_status || 'unfulfilled',

      subtotal: shopifyOrder.subtotal_price || '0.00',
      shipping: shopifyOrder.total_shipping_price_set?.shop_money?.amount || '0.00',
      discount: shopifyOrder.total_discounts || '0.00',
      total: shopifyOrder.total_price || '0.00',
      currency: shopifyOrder.currency || 'BRL',

      items
    };

    return res.status(200).json({ success: true, order: normalized });
  } catch (error) {
    console.error('Erro no get-shopify-order:', error);
    return res.status(error.status || 500).json({
      error: error.status ? 'Erro ao consultar pedido na Shopify.' : 'Erro interno ao buscar pedido.',
      message: error.message,
      details: error.details || null
    });
  }
}
