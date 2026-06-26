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

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }
  return value;
}

function centsToMoney(value) {
  const number = Number(value || 0);
  if (number > 1000) return (number / 100).toFixed(2);
  return number.toFixed(2);
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

function getWebhookEvent(req) {
  return String(
    req.body?.type ||
    req.body?.event ||
    req.body?.event_type ||
    req.query?.type ||
    ''
  ).trim();
}

function getWebhookData(req) {
  return req.body?.data || req.body || {};
}

function getPagarmeId(data, event) {
  return String(
    data?.id ||
    data?.code ||
    data?.order?.id ||
    data?.order?.code ||
    data?.charge?.id ||
    data?.charges?.[0]?.id ||
    `${event}_${Date.now()}`
  ).trim();
}

function getOrderCode(data) {
  return String(
    data?.code ||
    data?.order_code ||
    data?.order?.code ||
    data?.metadata?.order_code ||
    data?.charges?.[0]?.metadata?.order_code ||
    ''
  ).trim();
}

function getMetadata(data) {
  const possible = [
    data?.metadata,
    data?.order?.metadata,
    data?.charge?.metadata,
    data?.charges?.[0]?.metadata,
    data?.payment_link?.metadata,
    data?.checkout?.metadata
  ];

  for (const item of possible) {
    if (item && typeof item === 'object') return item;
  }

  return {};
}

function isPaidEvent(event, data) {
  const status = String(data?.status || data?.order?.status || data?.charges?.[0]?.status || '').toLowerCase();

  return (
    event === 'order.paid' ||
    event === 'charge.paid' ||
    event === 'payment-link.finished' ||
    status === 'paid'
  );
}

async function checkDuplicate(identifier, { shopifyStoreDomain, shopifyApiVersion, shopifyAdminToken }) {
  const id = String(identifier).trim();

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 1500));
    }

    const result = await shopifyRequest({
      shopifyStoreDomain,
      shopifyApiVersion,
      shopifyAdminToken,
      path: `/orders.json?status=any&source_identifier=pagarme_${encodeURIComponent(id)}&fields=id,source_identifier&limit=5`
    });

    const found = Array.isArray(result.data.orders) && result.data.orders.length > 0;

    if (found) return true;
  }

  return false;
}

function parseShopifyItems(meta) {
  const raw = meta.shopify_items || meta.shopifyItems || '[]';

  if (Array.isArray(raw)) return raw;

  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function getPaidAmount(data) {
  return (
    data?.amount ||
    data?.paid_amount ||
    data?.total_amount ||
    data?.charges?.[0]?.amount ||
    data?.charges?.[0]?.paid_amount ||
    0
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Use POST ou GET.' });
  }

  try {
    const event = getWebhookEvent(req);
    const data = getWebhookData(req);
    const pagarmeId = getPagarmeId(data, event);
    const orderCode = getOrderCode(data);
    const meta = getMetadata(data);

    console.log('PAGARME WEBHOOK RECEBIDO:', JSON.stringify({
      method: req.method,
      query: req.query,
      event,
      pagarmeId,
      orderCode,
      body: req.body
    }, null, 2));

    if (!event) {
      return res.status(200).json({ success: true, ignored: true, message: 'Evento sem type/event.' });
    }

    if (!isPaidEvent(event, data)) {
      return res.status(200).json({ success: true, ignored: true, event, status: data?.status || '' });
    }

    const shopifyStoreDomain = requiredEnv('SHOPIFY_STORE_DOMAIN');
    const shopifyApiVersion = process.env.SHOPIFY_API_VERSION || '2024-10';
    const shopifyAdminToken = requiredEnv('SHOPIFY_ADMIN_TOKEN');

    const shopifyConfig = { shopifyStoreDomain, shopifyApiVersion, shopifyAdminToken };
    const uniqueIdentifier = orderCode || pagarmeId;

    const isDuplicate = await checkDuplicate(uniqueIdentifier, shopifyConfig);

    if (isDuplicate) {
      console.log('PEDIDO PAGARME DUPLICADO BLOQUEADO:', uniqueIdentifier);
      return res.status(200).json({
        success: true,
        duplicated: true,
        message: 'Pedido já existia para esse pagamento.'
      });
    }

    const shopifyItems = parseShopifyItems(meta);

    if (!shopifyItems.length) {
      console.log('ATENÇÃO: metadata.shopify_items não encontrado no webhook da Pagar.me.');
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
            price: centsToMoney(getPaidAmount(data)),
            requires_shipping: true,
            taxable: false
          }
        ];

    const shippingPrice = Number(meta.shipping_price || 0);

    const customerName = meta.customer_name || data?.customer?.name || data?.order?.customer?.name || '';
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

    const paymentMethod =
      data?.payment_method ||
      data?.charges?.[0]?.payment_method ||
      data?.last_transaction?.transaction_type ||
      '';

    const shippingServiceId = meta.shipping_service_id || null;
    const shippingCode = shippingServiceId ? `melhorenvio_${shippingServiceId}` : (meta.shipping_name || 'Frete');

    const amount = centsToMoney(getPaidAmount(data));

    const noteLines = [
      `Pagar.me ID: ${pagarmeId}`,
      `Pagar.me Order Code: ${orderCode}`,
      `Evento Pagar.me: ${event}`,
      `Forma de pagamento: ${paymentMethod}`,
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

    const orderPayload = {
      order: {
        email: meta.customer_email || data?.customer?.email || data?.order?.customer?.email || '',
        financial_status: 'paid',
        fulfillment_status: null,
        source_name: 'Pagar.me',
        source_identifier: `pagarme_${uniqueIdentifier}`,
        note: noteLines.join('\n'),
        tags: 'Pagar.me, NEWER Checkout',
        note_attributes: [
          { name: 'pagarme_id', value: String(pagarmeId || '') },
          { name: 'pagarme_order_code', value: String(orderCode || '') },
          { name: 'customer_name', value: meta.customer_name || '' },
          { name: 'customer_email', value: meta.customer_email || data?.customer?.email || '' },
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
          email: meta.customer_email || data?.customer?.email || data?.order?.customer?.email || ''
        },
        transactions: [
          {
            kind: 'sale',
            status: 'success',
            amount: amount,
            gateway: 'Pagar.me'
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

    console.log('SHOPIFY STATUS PAGARME:', orderCreate.response.status);
    console.log('SHOPIFY ORDER PAGARME:', JSON.stringify(orderCreate.data, null, 2));

    return res.status(200).json({
      success: orderCreate.response.ok,
      shopify_status: orderCreate.response.status,
      order: orderCreate.data
    });
  } catch (error) {
    console.log('ERRO WEBHOOK PAGARME:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
