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

function cleanText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function onlyDigits(value) {
  return cleanText(value).replace(/\D/g, '');
}

function pickFirst() {
  for (const value of arguments) {
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return '';
}

function looksLikeShippingName(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return false;

  return (
    text.includes('frete') ||
    text.includes('sedex') ||
    text.includes('pac') ||
    text.includes('envio') ||
    text.includes('entrega') ||
    text.includes('dias úteis') ||
    text.includes('dias uteis')
  );
}

function splitCustomerName(customerName) {
  let name = cleanText(customerName);

  if (!name || looksLikeShippingName(name)) {
    name = 'Cliente NEWER';
  }

  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = parts.shift() || 'Cliente';
  const lastName = parts.join(' ') || 'NEWER';

  return { firstName, lastName, fullName: `${firstName} ${lastName}`.trim() };
}

function normalizeState(value) {
  const state = cleanText(value);
  const map = {
    AC: 'Acre',
    AL: 'Alagoas',
    AP: 'Amapá',
    AM: 'Amazonas',
    BA: 'Bahia',
    CE: 'Ceará',
    DF: 'Distrito Federal',
    ES: 'Espírito Santo',
    GO: 'Goiás',
    MA: 'Maranhão',
    MT: 'Mato Grosso',
    MS: 'Mato Grosso do Sul',
    MG: 'Minas Gerais',
    PA: 'Pará',
    PB: 'Paraíba',
    PR: 'Paraná',
    PE: 'Pernambuco',
    PI: 'Piauí',
    RJ: 'Rio de Janeiro',
    RN: 'Rio Grande do Norte',
    RS: 'Rio Grande do Sul',
    RO: 'Rondônia',
    RR: 'Roraima',
    SC: 'Santa Catarina',
    SP: 'São Paulo',
    SE: 'Sergipe',
    TO: 'Tocantins'
  };

  return map[state.toUpperCase()] || state;
}

export default async function handler(req, res) {
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
    const payer = payment.payer || {};
    const additionalPayer = payment.additional_info?.payer || {};

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

    /*
      IMPORTANTE:
      Esta correção mexe apenas no webhook que cria o pedido na Shopify.
      Não altera cálculo, pagamento, checkout, cupom, frete ou Mercado Pago.
      A ideia é só salvar os dados certos no pedido Shopify.
    */

    const customerNameRaw = pickFirst(
      meta.customer_name,
      meta.name,
      meta.nome,
      payer.first_name && payer.last_name ? `${payer.first_name} ${payer.last_name}` : '',
      additionalPayer.first_name && additionalPayer.last_name ? `${additionalPayer.first_name} ${additionalPayer.last_name}` : '',
      payer.first_name,
      additionalPayer.first_name
    );

    const { firstName, lastName, fullName } = splitCustomerName(customerNameRaw);

    const customerEmail = pickFirst(
      meta.customer_email,
      meta.email,
      payer.email,
      additionalPayer.email
    );

    const customerPhone = pickFirst(
      meta.customer_phone,
      meta.phone,
      meta.telefone,
      payer.phone?.area_code && payer.phone?.number ? `${payer.phone.area_code}${payer.phone.number}` : '',
      payer.phone?.number,
      additionalPayer.phone?.area_code && additionalPayer.phone?.number ? `${additionalPayer.phone.area_code}${additionalPayer.phone.number}` : '',
      additionalPayer.phone?.number
    );

    const customerCep = pickFirst(
      meta.customer_cep,
      meta.cep,
      meta.zip,
      meta.postal_code,
      additionalPayer.address?.zip_code
    );

    const customerAddress = pickFirst(
      meta.customer_address,
      meta.address,
      meta.address1,
      meta.endereco,
      meta.rua,
      meta.street_name,
      additionalPayer.address?.street_name
    );

    const customerNumber = pickFirst(
      meta.customer_number,
      meta.number,
      meta.numero,
      meta.street_number,
      additionalPayer.address?.street_number
    );

    const customerComplement = pickFirst(
      meta.customer_complement,
      meta.complement,
      meta.complemento,
      meta.address2
    );

    const customerDistrict = pickFirst(
      meta.customer_district,
      meta.district,
      meta.neighborhood,
      meta.bairro
    );

    const customerCity = pickFirst(
      meta.customer_city,
      meta.city,
      meta.cidade,
      additionalPayer.address?.city_name
    );

    const customerState = normalizeState(pickFirst(
      meta.customer_state,
      meta.state,
      meta.uf,
      meta.province,
      additionalPayer.address?.state_name
    ));

    const address1 = [customerAddress, customerNumber].filter(Boolean).join(', ');

    const address2 = [customerComplement, customerDistrict]
      .filter(Boolean)
      .join(' - ');

    const address = {
      first_name: firstName,
      last_name: lastName,
      name: fullName,
      address1,
      address2,
      city: customerCity,
      province: customerState,
      country: 'Brazil',
      zip: onlyDigits(customerCep),
      phone: customerPhone
    };

    const noteLines = [
      `Mercado Pago Payment ID: ${payment.id}`,
      `Forma de pagamento: ${payment.payment_method_id || ''}`,
      `Status MP: ${payment.status || ''}`,
      `Cliente: ${fullName}`,
      `E-mail: ${customerEmail}`,
      `Telefone: ${customerPhone}`,
      `CEP: ${customerCep}`,
      `Endereço: ${address1}`,
      `Complemento/Bairro: ${address2}`,
      `Cidade/UF: ${customerCity}/${customerState}`,
      `Frete: ${meta.shipping_name || ''} - R$ ${shippingPrice.toFixed(2)}`,
      `Cupom: ${meta.coupon_code || ''}`,
      `Desconto: R$ ${Number(meta.discount_amount || 0).toFixed(2)}`
    ];

    const amount = Number(payment.transaction_amount || 0).toFixed(2);

    const orderPayload = {
      order: {
        email: customerEmail,
        phone: customerPhone,
        financial_status: 'paid',
        fulfillment_status: null,
        note: noteLines.join('\n'),
        tags: 'Mercado Pago, NEWER Checkout',
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
          email: customerEmail,
          phone: customerPhone
        },
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
