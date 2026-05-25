export default async function handler(req, res) {
  try {
    const body = req.body;

    const response = await fetch(
      'https://api.mercadopago.com/checkout/preferences',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          items: body.items,

          payer: {
            name: body.name,
            email: body.email
          },

          payment_methods: {
            installments: 6
          },

          back_urls: {
            success: 'https://newera-shop-7780.myshopify.com/pages/checkout?status=approved',
            failure: 'https://newera-shop-7780.myshopify.com/pages/checkout?status=failed',
            pending: 'https://newera-shop-7780.myshopify.com/pages/checkout?status=pending'
          },

          auto_return: 'approved'
        })
      }
    );

    const data = await response.json();

    return res.status(200).json({
      success: true,
      init_point: data.init_point
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
