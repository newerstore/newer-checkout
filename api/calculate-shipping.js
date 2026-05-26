export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://newera-shop-7780.myshopify.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {

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
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MELHOR_ENVIO_TOKEN.trim()}`,
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
