function setCors(req, res) {
  const allowedOrigins = [
    'https://newer-store.com',
    'https://www.newer-store.com',
    'https://newera-shop-7780.myshopify.com'
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
      return res.status(405).json({
        success: false,
        message: 'Use POST.'
      });
    }

    const body = req.body || {};
    const cep = body.cep?.replace(/\D/g, '');

    if (!cep) {
      return res.status(400).json({
        success: false,
        message: 'CEP obrigatório'
      });
    }

    const response = await fetch('https://melhorenvio.com.br/api/v2/me/shipment/calculate', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MELHOR_ENVIO_TOKEN.trim()}`,
        'User-Agent': 'NEWER STORE'
      },
      body: JSON.stringify({
        from: {
          postal_code: process.env.STORE_ORIGIN_CEP
        },
        to: {
          postal_code: cep
        },
        products: [
          {
            id: '1',
            width: 20,
            height: 5,
            length: 30,
            weight: 0.3,
            insurance_value: 150,
            quantity: 1
          }
        ]
      })
    });

    const data = await response.json();

    return res.status(200).json({
      success: true,
      options: data
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
