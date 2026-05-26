export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://newera-shop-7780.myshopify.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, message: 'Use POST.' });
    }

    const body = req.body || {};

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
        payment_methods: {
          installments: 6
        },
        back_urls: {
  success: 'https://newera-shop-7780.myshopify.com/pages/pedido-confirmado',
  failure: 'https://newera-shop-7780.myshopify.com/pages/checkout?status=failed',
  pending: 'https://newera-shop-7780.myshopify.com/pages/aguardando-pix'
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
