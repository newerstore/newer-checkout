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

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function getPropertyValue(properties, names) {
  const normalized = normalizeProperties(properties);
  const wantedNames = names.map(function (name) {
    return String(name).toLowerCase().trim();
  });

  const found = normalized.find(function (prop) {
    return wantedNames.includes(String(prop.name).toLowerCase().trim());
  });

  return found ? String(found.value).trim() : '';
}

function upsertProperty(properties, name, value) {
  const normalized = normalizeProperties(properties);
  const cleanValue = String(value || '').trim();

  if (!cleanValue) return normalized;

  const exists = normalized.some(function (prop) {
    return String(prop.name).toLowerCase().trim() === String(name).toLowerCase().trim();
  });

  if (!exists) {
    normalized.push({ name, value: cleanValue });
  }

  return normalized;
}

function isIconsItem(item) {
  const text = [
    item?.title,
    item?.product_title,
    item?.handle,
    item?.product_type,
    item?.collection,
    item?.vendor,
    item?.tags
  ].join(' ').toLowerCase();

  return text.includes('icons');
}

function getIconsSize(item) {
  return pick(
    item?.size,
    item?.tamanho,
    item?.selected_size,
    item?.selectedSize,
    item?.properties?.Tamanho,
    item?.properties?.tamanho,
    item?.properties?.Size,
    item?.properties?.size,
    getPropertyValue(item?.properties, ['Tamanho', 'tamanho', 'Size', 'size']),
    item?.variant_title,
    item?.variantTitle,
    item?.option1
  );
}

function getPaymentId(req) {
  const body = req.body || {};
  const query = req.query || {};

  return (
    query['data.id'] ||
    query.id ||
    query.payment_id ||
    body?.data?.id ||
    body?.resource?.split('/').pop() ||
    body?.id ||
    body?.payment_id ||
    ''
  );
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }
  return value;
}

async function shopifyRequest({ shopifyStoreDomain, shopifyApiVersion, shopifyAdminToken, path, method = 'GET', body }) {
  const response = await fetch(`https://${shopifyStoreDomain}/admin/api/${shopifyApiVersion}${path}`, {
    method,
    headers: {
      'X-Shopify-Access-Token': shopifyAdminToken,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(function () {
    return {};
  });

  return { response, data };
}

function orderAlreadyHasPayment(order, paymentId) {
  const id = String(paymentId || '').trim();
  if (!id) return false;

  const note = String(order.note || '');
  const sourceIdentifier = String(order.source_identifier || '');
  const noteAttributes = Array.isArray(order.note_attributes) ? order.note_attributes : [];

  return (
    sourceIdentifier === id ||
    sourceIdentifier === `mp_${id}` ||
    note.includes(id) ||
    noteAttributes.some(function (attr) {
      return (
        String(attr.name || '').toLowerCase() === 'mercado_pago_payment_id' &&
        String(attr.value || '') === id
      );
    })
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Use POST ou GET.' });
  }

  try {
    const paymentId = String(getPaymentId(req)).trim();

    console.log('MP WEBHOOK RECEBIDO:', {
      method: req.method,
      query: req.query,
      body: req.body,
      paymentId
    });

    if (!paymentId) {
      return res.status(200).json({ success: false, message: 'Sem payment id' });
    }

    const mpAccessToken = requiredEnv('MP_ACCESS_TOKEN');
    const shopifyStoreDomain = requiredEnv('SHOPIFY_STORE_DOMAIN');
    const shopifyApiVersion = process.env.SHOPIFY_API_VERSION || '2024-10';
    const shopifyAdminToken = requiredEnv('SHOPIFY_ADMIN_TOKEN');

    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        Authorization: `Bearer ${mpAccessToken}`
      }
    });

    const payment = await paymentResponse.json();

    console.log('MP PAYMENT STATUS:', paymentResponse.status);
    console.log('MP PAYMENT DATA:', JSON.stringify(payment, null, 2));

    if (!paymentResponse.ok) {
      return res.status(200).json({
        success: false,
        message: 'Erro ao consultar pagamento no Mercado Pago',
        mercado_pago_status: paymentResponse.status,
        mercado_pago_error: payment
      });
    }

    if (payment.status !== 'approved') {
      return res.status(200).json({ success: true, ignored: true, status: payment.status });
    }

    const meta = payment.metadata || {};

    const existingOrdersCheck = await shopifyRequest({
      shopifyStoreDomain,
      shopifyApiVersion,
      shopifyAdminToken,
      path: `/orders.json?status=any&limit=250&fields=id,note,name,order_number,note_attributes,source_identifier`
    });

    if (!existingOrdersCheck.response.ok) {
      console.log('SHOPIFY EXISTING ORDERS ERROR:', JSON.stringify(existingOrdersCheck.data, null, 2));
      return res.status(200).json({
        success: false,
        message: 'Erro ao verificar pedidos existentes na Shopify',
        shopify_status: existingOrdersCheck.response.status,
        shopify_error: existingOrdersCheck.data
      });
    }

    const alreadyExists = existingOrdersCheck.data.orders?.some(function (order) {
      return orderAlreadyHasPayment(order, payment.id);
    });

    if (alreadyExists) {
      console.log('PEDIDO DUPLICADO BLOQUEADO PARA PAYMENT ID:', payment.id);
      return res.status(200).json({ success: true, duplicated: true, message: 'Pedido já existia para esse pagamento.' });
    }

    let shopifyItems = [];

    try {
      shopifyItems = JSON.parse(meta.shopify_items || '[]');
    } catch (e) {
      shopifyItems = [];
    }

    const productLineItems = shopifyItems.length
      ? shopifyItems.map(function (item) {
          let properties = normalizeProperties(item.properties);
          const unitPrice = Number(item.unit_price ?? item.price ?? 0);
          const iconsSize = getIconsSize(item);

          if (isIconsItem(item) && iconsSize) {
            properties = upsertProperty(properties, 'Tamanho', iconsSize);
          }

          const lineItem = {
            title: item.title || item.product_title || 'Produto NEWER',
            quantity: Number(item.quantity || 1),
            price: unitPrice.toFixed(2),
            requires_shipping: true,
            taxable: false
          };

          if (item.variant_title || iconsSize) {
            lineItem.variant_title = item.variant_title || iconsSize;
          }

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

    const customerName = meta.customer_name || payment.payer?.first_name || '';
    const nameParts = customerName.trim().split(' ').filter(Boolean);
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

    const shippingServiceId = meta.shipping_service_id || null;
    const shippingCode = shippingServiceId ? `melhorenvio_${shippingServiceId}` : (meta.shipping_name || 'Frete');

    const noteLines = [
      `Mercado Pago Payment ID: ${payment.id}`,
      `Forma de pagamento: ${payment.payment_method_id || ''}`,
      `Status MP: ${payment.status || ''}`,
      `Cliente: ${meta.customer_name || ''}`,
      `CPF: ${meta.customer_cpf || ''}`,
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
        source_name: 'Mercado Pago',
        source_identifier: String(payment.id || ''),
        note: noteLines.join('\n'),
        tags: 'Mercado Pago, NEWER Checkout',
        note_attributes: [
          { name: 'mercado_pago_payment_id', value: String(payment.id || '') },
          { name: 'customer_name', value: meta.customer_name || '' },
          { name: 'customer_email', value: meta.customer_email || payment.payer?.email || '' },
          { name: 'customer_phone', value: meta.customer_phone || '' },
          { name: 'customer_cpf', value: meta.customer_cpf || '' },
          { name: 'customer_cep', value: meta.customer_cep || '' },
          { name: 'customer_address', value: meta.customer_address || '' },
          { name: 'customer_number', value: meta.customer_number || '' },
          { name: 'customer_complement', value: meta.customer_complement || '' },
          { name: 'customer_district', value: meta.customer_district || '' },
          { name: 'customer_city', value: meta.customer_city || '' },
          { name: 'customer_state', value: meta.customer_state || '' },
          { name: 'shipping_name', value: meta.shipping_name || '' },
          { name: 'shipping_price', value: shippingPrice.toFixed(2) },
          { name: 'shipping_service_id', value: String(shippingServiceId || '') },
          { name: 'coupon_code', value: meta.coupon_code || '' },
          { name: 'discount_amount', value: Number(meta.discount_amount || 0).toFixed(2) }
        ],
        currency: 'BRL',
        line_items: productLineItems,
        shipping_lines: [
          {
            title: meta.shipping_name || 'Frete',
            price: shippingPrice.toFixed(2),
            code: shippingCode
          }
        ],
        shipping_address: address,
        billing_address: address,
        customer: {
          first_name: firstName,
          last_name: lastName,
          email: meta.customer_email || payment.payer?.email || ''
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

    const orderCreate = await shopifyRequest({
      shopifyStoreDomain,
      shopifyApiVersion,
      shopifyAdminToken,
      path: '/orders.json',
      method: 'POST',
      body: orderPayload
    });

    console.log('SHOPIFY STATUS:', orderCreate.response.status);
    console.log('SHOPIFY ORDER:', JSON.stringify(orderCreate.data, null, 2));

    return res.status(200).json({
      success: orderCreate.response.ok,
      shopify_status: orderCreate.response.status,
      order: orderCreate.data
    });
  } catch (error) {
    console.log('ERRO WEBHOOK:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
