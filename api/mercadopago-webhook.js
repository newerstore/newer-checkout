export default async function handler(req, res) {

  try {

    console.log('WEBHOOK:', req.body);

    const paymentId = req.body?.data?.id;

    if (!paymentId) {
      return res.status(200).json({ received: true });
    }

    // BUSCA PAGAMENTO NO MP
    const paymentResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
        }
      }
    );

    const payment = await paymentResponse.json();

    console.log('PAYMENT DATA:', payment);

    // SÓ CONTINUA SE APROVADO
    if (payment.status !== 'approved') {
      return res.status(200).json({
        success: true,
        ignored: true
      });
    }

    // CRIA PEDIDO NA SHOPIFY
    const orderResponse = await fetch(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION}/orders.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN
        },

        body: JSON.stringify({
          order: {

            email: payment.payer?.email || '',

            financial_status: 'paid',

            note: `Mercado Pago Payment ID: ${payment.id}`,

            line_items: [
              {
                title: 'Pedido NEWER',
                quantity: 1,
                price: payment.transaction_amount || 0
              }
            ],

            billing_address: {
              first_name: payment.payer?.first_name || '',
              last_name: payment.payer?.last_name || '',
              phone: payment.payer?.phone?.number || ''
            }
          }
        })
      }
    );

    const orderData = await orderResponse.json();

    console.log('SHOPIFY ORDER:', orderData);

    return res.status(200).json({
      success: true,
      order: orderData
    });

  } catch (error) {

    console.log(error);

    return res.status(500).json({
      success: false,
      error: error.message
    });

  }

}
