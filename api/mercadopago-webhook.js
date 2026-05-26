export default async function handler(req, res) {
  try {
    console.log('WEBHOOK BODY:', JSON.stringify(req.body || {}, null, 2));
    console.log('WEBHOOK QUERY:', JSON.stringify(req.query || {}, null, 2));

    const body = req.body || {};
    const query = req.query || {};

    const paymentId =
      query['data.id'] ||
      query.id ||
      body?.data?.id ||
      body?.resource?.split('/').pop() ||
      body?.id;

    if (!paymentId) {
      return res.status(200).json({ success: false, message: 'Sem payment id' });
    }

    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
      }
    });

    const payment = await paymentResponse.json();

    if (payment.status !== 'approved') {
      return res.status(200).json({ success: true, ignored: true, status: payment.status });
    }

    const existingOrdersResponse = await fetch(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION}/orders.json?status=any&limit=50`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN
        }
      }
    );

    const existingOrders = await existingOrdersResponse.json();

    const alreadyExists = existingOrders.orders?.some(order =>
      String(order.note || '').includes(String(payment.id))
    );

    if (alreadyExists) {
      return res.status(200).json({ success: true, duplicated: true });
    }

    const amount = Number(payment.transaction_amount || 0).toFixed(2);

    const orderPayload = {
      order: {
        email: payment.payer?.email || '',
        financial_status: 'paid',
        fulfillment_status: null,
        note: `Mercado Pago Payment ID: ${payment.id}`,
        tags: 'Mercado Pago, NEWER Checkout',
        currency: 'BRL',
        line_items: [
          {
            title: 'Pedido NEWER',
            quantity: 1,
            price: amount,
            requires_shipping: true,
            taxable: false
          }
        ],
        transactions: [
          {
            kind: 'sale',
            status: 'success',
            amount: amount,
            gateway: 'Mercado Pago'
          }
        ]
      }
    };

    const orderResponse = await fetch(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION}/orders.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN
        },
        body: JSON.stringify(orderPayload)
      }
    );

    const orderData = await orderResponse.json();

    console.log('SHOPIFY STATUS:', orderResponse.status);
    console.log('SHOPIFY ORDER:', JSON.stringify(orderData, null, 2));

    return res.status(200).json({
      success: orderResponse.ok,
      shopify_status: orderResponse.status,
      order: orderData
    });

  } catch (error) {
    console.log('ERRO WEBHOOK:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
