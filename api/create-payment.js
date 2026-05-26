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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, message: 'Use POST.' });
    }

    const body = req.body || {};

    const metadata = {
      customer_name: body.name || '',
      customer_email: body.email || '',
      customer_phone: body.phone || '',
      customer_cep: body.cep || '',
      customer_address: body.address || '',
      customer_number: body.number || '',
      customer_complement: body.complement || '',
      customer_district: body.district || '',
      customer_city: body.city || '',
      customer_state: body.state || '',
      shipping_name: body.shipping_name || '',
      shipping_price: body.shipping_price || 0,
      coupon_code: body.coupon_code || '',
      discount_amount: body.discount_amount || 0,
      shopify_items: JSON.stringify(body.shopify_items || [])
    };

    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: body.items,
        payer: {
          name: body.name || '',
          email: body.email || ''
        },
        metadata,
        payment_methods: {
          installments: 6
        },
        back_urls: {
          success: 'https://newer-store.com/pages/pedido-confirmado',
          failure: 'https://newer-store.com/pages/checkout?status=failed',
          pending: 'https://newer-store.com/pages/aguardando-pix'
        },
        auto_return: 'approved'
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({ success: false, mercado_pago_error: data });
    }

    return res.status(200).json({
      success: true,
      init_point: data.init_point,
      preference_id: data.id
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
