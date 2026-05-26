export default async function handler(req, res) {

  try {

    console.log('WEBHOOK BODY:', JSON.stringify(req.body, null, 2));

    const body = req.body || {};

    // PEGA PAYMENT ID EM QUALQUER FORMATO
    const paymentId =
      body?.data?.id ||
      body?.resource?.split('/').pop() ||
      body?.id;

    if (!paymentId) {

      console.log('SEM PAYMENT ID');

      return res.status(200).json({
        success: false,
        message: 'Sem payment id'
      });

    }

    console.log('PAYMENT ID:', paymentId);

    // BUSCA PAGAMENTO REAL
    const paymentResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
        }
      }
    );

    const payment = await paymentResponse.json();

    console.log('PAYMENT:', JSON.stringify(payment, null, 2));

    // IGNORA NÃO APROVADOS
    if (payment.status !== 'approved') {

      console.log('PAGAMENTO NÃO APROVADO');

      return res.status(200).json({
        success: true,
        ignored: true
      });

    }

    // EVITA DUPLICAR PEDIDOS
    const existingOrdersResponse = await fetch(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION}/orders.json?status=any`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN
        }
      }
    );

    const existingOrders = await existingOrdersResponse.json();

    const alreadyExists = existingOrders.orders?.some(order =>
      order.note &&
      order.note.includes(String(payment.id))
    );

    if (alreadyExists) {

      console.log('PEDIDO JÁ EXISTE');

      return res.status(200).json({
        success: true,
        duplicated: true
      });

    }

    // CRIA PEDIDO SHOPIFY
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
            ]
          }
        })
      }
    );

    const orderData = await orderResponse.json();

    console.log('SHOPIFY ORDER:', JSON.stringify(orderData, null, 2));

    return res.status(200).json({
      success: true,
      order: orderData
    });

  } catch (error) {

    console.log('ERRO WEBHOOK:', error);

    return res.status(500).json({
      success: false,
      error: error.message
    });

  }

}
