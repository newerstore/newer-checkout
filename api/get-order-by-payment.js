function setCors(req, res) {
  const allowedOrigins = [
    'https://newer-store.com',
    'https://www.newer-store.com'
  ];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://newer-store.com');
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }
  return value;
}

async function shopifyGet(path) {
  const shopifyStoreDomain = requiredEnv('SHOPIFY_STORE_DOMAIN');
  const shopifyApiVersion = process.env.SHOPIFY_API_VERSION || '2024-10';
  const shopifyAdminToken = requiredEnv('SHOPIFY_ADMIN_TOKEN');

  const response = await fetch(
    `https://${shopifyStoreDomain}/admin/api/${shopifyApiVersion}${path}`,
    {
      headers: {
        'X-Shopify-Access-Token': shopifyAdminToken,
        'Content-Type': 'application/json'
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Use GET.' });
  }

  try {
    const paymentId = String(req.query.payment_id || req.query.id || '').trim();

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        error: 'payment_id não informado'
      });
    }

    const ordersData = await shopifyGet('/orders.json?status=any&limit=250&fields=id,note,name,order_number,created_at');

    const order = (ordersData.orders || []).find(order => {
      const note = String(order.note || '');
      return note.includes(paymentId);
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Pedido não encontrado'
      });
    }

    return res.status(200).json({
      success: true,
      order_id: order.id,
      order_number: order.order_number,
      order_name: order.name
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
