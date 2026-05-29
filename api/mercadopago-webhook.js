function normalizeProperties(properties) {
  if (!properties) return [];

  if (Array.isArray(properties)) {
    return properties
      .filter(function (prop) {
        return prop && prop.name && prop.value !== undefined && prop.value !== null && String(prop.value).trim() !== '';
      })
      .map(function (prop) {
        return { name: String(prop.name), value: String(prop.value) };
      });
  }

  if (typeof properties === 'object') {
    return Object.entries(properties)
      .filter(function ([key, value]) {
        return key && value !== undefined && value !== null && String(value).trim() !== '';
      })
      .map(function ([key, value]) {
        return { name: String(key), value: String(value) };
      });
  }

  return [];
}

module.exports = async function handler(req, res) {
  try {
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

    const meta = payment.metadata || {};

    let shopifyItems = [];

    try {
      shopifyItems = JSON.parse(meta.shopify_items || '[]');
    } catch (e) {
      shopifyItems = [];
    }

    const productLineItems = shopifyItems.length
      ? shopifyItems.map(function (item) {
          const properties = normalizeProperties(item.properties);
          const unitPrice = Number(item.unit_price ?? item.price ?? 0);

          const lineItem = {
            title: item.title || 'Produto NEWER',
            quantity: Number(item.quantity || 1),
            price: unitPrice.toFixed(2),
            variant_title: item.variant_title || undefined,
            requires_shipping: true,
            taxable: false
          };

          if (item.variant_id) {
            lineItem.variant_id = Number(item.variant_id);
          }

          if (item.sku) {
            lineItem.sku = String(item.sku);
          }

          if (properties.length) {
            lineItem.properties = properties;
          }

          return lineItem;
        })
      : [
          {
            title: 'Pedido NEWER',
            quantity: 1,
            price: Number(payment.transaction_amount || 0).toFixed(2),
            requires_shipping: true,
            taxable: false
          }
        ];

    const shippingPrice = Number(meta.shipping_price || 0);

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

    const customerName = meta.customer_name || payment.payer?.first_name || '';
    const nameParts = customerName.trim().split(' ');
    const firstName = nameParts.shift() || customerName || 'Cliente';
    const lastName = nameParts.join(' ') || '.';

    const address = {
      first_name: firstName,
      last_name: lastName,
      address1: `${meta.customer_address || ''}, ${meta.customer_number || ''}`.trim(),
      address2: meta.customer_complement || '',
      city: meta.customer_city || '',
      province: meta.customer_state || '',
      country: 'Brazil',
      zip: meta.customer_cep || '',
      phone: meta.customer_phone || ''
    };

    const noteLines = [
      `Mercado Pago Payment ID: ${payment.id}`,
      `Forma de pagamento: ${payment.payment_method_id || ''}`,
      `Status MP: ${payment.status || ''}`,
      `Cliente: ${meta.customer_name || ''}`,
      `Telefone: ${meta.customer_phone || ''}`,
      `CEP: ${meta.customer_cep || ''}`,
      `Endereço: ${meta.customer_address || ''}, ${meta.customer_number || ''}`,
      `Complemento: ${meta.customer_complement || ''}`,
      `Bairro: ${meta.customer_district || ''}`,
      `Cidade/UF: ${meta.customer_city || ''}/${meta.customer_state || ''}`,
      `Frete: ${meta.shipping_name || ''} - R$ ${shippingPrice.toFixed(2)}`,
      `Cupom: ${meta.coupon_code || ''}`,
      `Desconto: R$ ${Number(meta.discount_amount || 0).toFixed(2)}`
    ];

    const amount = Number(payment.transaction_amount || 0).toFixed(2);

    const orderPayload = {
      order: {
        email: meta.customer_email || payment.payer?.email || '',
        financial_status: 'paid',
        fulfillment_status: null,
        note: noteLines.join('\n'),
        tags: 'Mercado Pago, NEWER Checkout',
        note_attributes: [
          { name: 'customer_name', value: meta.customer_name || '' },
          { name: 'customer_email', value: meta.customer_email || payment.payer?.email || '' },
          { name: 'customer_phone', value: meta.customer_phone || '' },
          { name: 'customer_cep', value: meta.customer_cep || '' },
          { name: 'customer_address', value: meta.customer_address || '' },
          { name: 'customer_number', value: meta.customer_number || '' },
          { name: 'customer_complement', value: meta.customer_complement || '' },
          { name: 'customer_district', value: meta.customer_district || '' },
          { name: 'customer_city', value: meta.customer_city || '' },
          { name: 'customer_state', value: meta.customer_state || '' },
          { name: 'shipping_name', value: meta.shipping_name || '' },
          { name: 'shipping_price', value: shippingPrice.toFixed(2) },
          { name: 'coupon_code', value: meta.coupon_code || '' },
          { name: 'discount_amount', value: Number(meta.discount_amount || 0).toFixed(2) }
        ],
        currency: 'BRL',
        line_items: productLineItems,
        shipping_lines: [
          {
            title: meta.shipping_name || 'Frete',
            price: shippingPrice.toFixed(2),
            code: meta.shipping_name || 'Frete'
          }
        ],
        shipping_address: address,
        billing_address: address,
        customer: {
  first_name: firstName,
  last_name: lastName,
  email: meta.customer_email || payment.payer?.email || ''
},,
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
