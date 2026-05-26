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

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const paymentId = req.query.payment_id;

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        message: 'payment_id obrigatório'
      });
    }

    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
      }
    });

    const payment = await response.json();

    return res.status(200).json({
      success: true,
      status: payment.status,
      status_detail: payment.status_detail,
      payment_id: payment.id
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
