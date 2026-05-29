
// /api/get-shopify-order.js
// Endpoint seguro para buscar os dados REAIS do pedido na Shopify
// Coloque este arquivo na pasta /api do seu projeto na Vercel.

export default async function handler(req, res) {
  // CORS liberado apenas para sua loja
  res.setHeader('Access-Control-Allow-Origin', 'https://newer-store.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido. Use GET.' });
  }

  try {
    const { order, id, email, phone } = req.query;

    if (!order && !id) {
      return res.status(400).json({
        error: 'Informe o número do pedido ou ID do pedido.',
        exemplo: '/api/get-shopify-order?order=1025&email=cliente@email.com'
      });
    }

    const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
    const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';

    if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return res.status(500).json({
        error: 'Variáveis da Shopify não configuradas na Vercel.'
      });
    }

    let shopifyUrl = '';

    // Se vier ID real do pedido, busca direto pelo ID
    if (id) {
      shopifyUrl = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/orders/${id}.json?fields=id,name,order_number,email,phone,created_at,financial_status,fulfillment_status,total_price,subtotal_price,total_discounts,total_shipping_price_set,currency,line_items,shipping_address,customer,payment_gateway_names`;
    } else {
      // Se vier número do pedido, busca na lista filtrando pelo name/order_number
      // Exemplo: order=1025 ou order=#1025
      const cleanOrder = String(order).replace('#', '').trim();
      shopifyUrl = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/orders.json?status=any&name=%23${encodeURIComponent(cleanOrder)}&limit=1`;
    }

    const shopifyResponse = await fetch(shopifyUrl, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    const data = await shopifyResponse.json();

    if (!shopifyResponse.ok) {
      return res.status(shopifyResponse.status).json({
        error: 'Erro ao consultar pedido na Shopify.',
        details: data
      });
    }

    const shopifyOrder = id ? data.order : data.orders?.[0];

    if (!shopifyOrder) {
      return res.status(404).json({ error: 'Pedido não encontrado na Shopify.' });
    }

    // Segurança simples: se a página enviar email ou telefone, valida contra o pedido.
    // Isso evita que qualquer pessoa veja pedidos apenas trocando o número na URL.
    const orderEmail = String(shopifyOrder.email || shopifyOrder.customer?.email || '').toLowerCase().trim();
    const orderPhone = String(shopifyOrder.phone || shopifyOrder.customer?.phone || shopifyOrder.shipping_address?.phone || '').replace(/\D/g, '');
    const requestEmail = String(email || '').toLowerCase().trim();
    const requestPhone = String(phone || '').replace(/\D/g, '');

    if (requestEmail && orderEmail && requestEmail !== orderEmail) {
      return res.status(403).json({ error: 'E-mail não confere com o pedido.' });
    }

    if (requestPhone && orderPhone && !orderPhone.endsWith(requestPhone.slice(-8))) {
      return res.status(403).json({ error: 'Telefone não confere com o pedido.' });
    }

    const shipping = shopifyOrder.shipping_address || {};
    const customer = shopifyOrder.customer || {};

    const normalized = {
      id: shopifyOrder.id,
      order_number: shopifyOrder.name || `#${shopifyOrder.order_number}`,
      order_name: shopifyOrder.name,
      created_at: shopifyOrder.created_at,

      customer: {
        name: `${customer.first_name || shipping.first_name || ''} ${customer.last_name || shipping.last_name || ''}`.trim() || shipping.name || 'Cliente NEWER',
        email: shopifyOrder.email || customer.email || '',
        phone: shopifyOrder.phone || customer.phone || shipping.phone || ''
      },

      shipping_address: {
        name: shipping.name || '',
        address1: shipping.address1 || '',
        address2: shipping.address2 || '',
        city: shipping.city || '',
        province: shipping.province || shipping.province_code || '',
        zip: shipping.zip || '',
        phone: shipping.phone || ''
      },

      payment_method: Array.isArray(shopifyOrder.payment_gateway_names) && shopifyOrder.payment_gateway_names.length
        ? shopifyOrder.payment_gateway_names.join(', ')
        : 'Mercado Pago',

      payment_status: shopifyOrder.financial_status || 'paid',
      fulfillment_status: shopifyOrder.fulfillment_status || 'unfulfilled',

      subtotal: shopifyOrder.subtotal_price || '0.00',
      shipping: shopifyOrder.total_shipping_price_set?.shop_money?.amount || '0.00',
      discount: shopifyOrder.total_discounts || '0.00',
      total: shopifyOrder.total_price || '0.00',
      currency: shopifyOrder.currency || 'BRL',

      items: (shopifyOrder.line_items || []).map((item) => ({
        id: item.id,
        title: item.title,
        variant_title: item.variant_title || '',
        quantity: item.quantity,
        price: item.price,
        line_price: String(Number(item.price || 0) * Number(item.quantity || 1)),
        sku: item.sku || '',
        image: ''
      }))
    };

    return res.status(200).json({ success: true, order: normalized });
  } catch (error) {
    console.error('Erro no get-shopify-order:', error);
    return res.status(500).json({
      error: 'Erro interno ao buscar pedido.',
      message: error.message
    });
  }
}
