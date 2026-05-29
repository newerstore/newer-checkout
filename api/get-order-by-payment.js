function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function shopifyGet(path) {
  const response = await fetch(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION}${path}`,
    {
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
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

  try {
    const paymentId = String(req.query.payment_id || '').trim();

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        error: 'payment_id não informado'
      });
    }

    const ordersData = await shopifyGet('/orders.json?status=any&limit=250');

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
