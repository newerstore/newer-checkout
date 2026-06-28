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

function pagarmeAuthHeader(secretKey) {
  return `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
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

async function pagarmeGet(path) {
  const secretKey = process.env.PAGARME_SECRET_KEY;
  if (!secretKey) return null;

  const baseUrl = process.env.PAGARME_BASE_URL || 'https://api.pagar.me/core/v5';

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      Authorization: pagarmeAuthHeader(secretKey),
      Accept: 'application/json',
      'User-Agent': 'newer-store-checkout/1.0'
    }
  });

  const data = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    console.log('PAGARME GET ERROR:', path, response.status, JSON.stringify(data, null, 2));
    return null;
  }

  return data;
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

function getChargeId(data) {
  return String(
    data?.id ||
    data?.charge?.id ||
    data?.charges?.[0]?.id ||
    ''
  ).trim();
}

function getOrderId(data) {
  return String(
    data?.order?.id ||
    data?.order_id ||
    data?.charges?.[0]?.order?.id ||
    ''
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

function getMetadata(data, fetchedOrder) {
  const possible = [
    data?.metadata,
    data?.order?.metadata,
    fetchedOrder?.metadata,
    data?.charge?.metadata,
    data?.charges?.[0]?.metadata,
    data?.payment_link?.metadata,
    data?.checkout?.metadata
  ];

  const useful = possible.find(function (item) {
    return item &&
      typeof item === 'object' &&
      (
        item.shopify_items ||
        item.customer_name ||
        item.customer_email ||
        item.customer_cep ||
        item.shipping_name
      );
  });

  if (useful) return useful;

  for (const item of possible) {
    if (item && typeof item === 'object' && Object.keys(item).length) return item;
  }

  return {};
}

async function checkDuplicate(identifiers, { shopifyStoreDomain, shopifyApiVersion, shopifyAdminToken }) {
  const ids = Array.from(new Set((Array.isArray(identifiers) ? identifiers : [identifiers])
    .map(function (id) { return String(id || '').trim(); })
    .filter(Boolean)));

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 1500));
    }

    for (const id of ids) {
      const result = await shopifyRequest({
        shopifyStoreDomain,
        shopifyApiVersion,
        shopifyAdminToken,
        path: `/orders.json?status=any&source_identifier=${encodeURIComponent(id)}&fields=id,source_identifier&limit=5`
      });

      const found = Array.isArray(result.data.orders) && result.data.orders.length > 0;
      if (found) return true;
    }
  }

  return false;
}


async function enrichMetadataFromPaymentLink(meta, data, fetchedOrder) {
  if (meta && meta.shopify_items) return meta;

  const paymentLinkId = pick(
    meta?.payment_link_id,
    data?.metadata?.payment_link_id,
    data?.order?.metadata?.payment_link_id,
    fetchedOrder?.metadata?.payment_link_id
  );

  if (!paymentLinkId) return meta || {};

  const paymentLink = await pagarmeGet(`/paymentlinks/${paymentLinkId}`);

  const possible = [
    paymentLink?.metadata,
    paymentLink?.payment_link?.metadata,
    paymentLink?.checkout?.metadata
  ];

  const useful = possible.find(function (item) {
    return item && typeof item === 'object' && (item.shopify_items || item.customer_name || item.customer_email);
  });

  return useful || meta || {};
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

function getPagarmeItems(data, fetchedOrder) {
  const possible = [
    data?.order?.items,
    data?.items,
    fetchedOrder?.items
  ];

  for (const item of possible) {
    if (Array.isArray(item) && item.length) return item;
  }

  return [];
}

function isShippingTitle(title) {
  const clean = String(title || '').toLowerCase().trim();
  return clean.startsWith('frete') || clean.includes(' entrega');
}

function pagarmeItemTitle(item) {
  return pick(item?.name, item?.description, item?.title, item?.code, 'Produto NEWER');
}

function pagarmeItemQuantity(item) {
  return Math.max(1, Number(item?.quantity || item?.default_quantity || 1));
}

function pagarmeItemAmount(item) {
  return Number(
    item?.amount ||
    item?.unit_amount ||
    item?.pricing_scheme?.price ||
    item?.price ||
    0
  );
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

function getCustomer(data, fetchedOrder) {
  return data?.customer || data?.order?.customer || fetchedOrder?.customer || {};
}

function getAddress(customer, meta) {
  const addr = customer?.address || {};

  const line1 = pick(addr.line_1, addr.line1, '');
  const street = pick(meta.customer_address, addr.street, line1.split(',')[1], line1);
  const number = pick(meta.customer_number, addr.number, line1.split(',')[0]);

  return {
    street,
    number,
    complement: pick(meta.customer_complement, addr.line_2, addr.line2, addr.complement),
    district: pick(meta.customer_district, addr.neighborhood, addr.district),
    city: pick(meta.customer_city, addr.city),
    state: pick(meta.customer_state, addr.state),
    cep: pick(meta.customer_cep, addr.zip_code, addr.zipcode, addr.zip),
    country: 'Brazil'
  };
}

function getPhone(customer, meta) {
  const mobile = customer?.phones?.mobile_phone || {};
  const home = customer?.phones?.home_phone || {};
  const full = pick(
    meta.customer_phone,
    `${mobile.area_code || ''}${mobile.number || ''}`,
    `${home.area_code || ''}${home.number || ''}`
  );

  return String(full || '').replace(/\D/g, '');
}

function buildLineItemsFromShopify(shopifyItems) {
  return shopifyItems.map(function (item) {
    let properties = normalizeProperties(item.properties);
    const unitPrice = Number(item.unit_price ?? item.price ?? 0);
    const iconsSize = getIconsSize(item);
    const variantId = Number(item.variant_id || item.id || 0);

    if (iconsSize) {
      properties = upsertProperty(properties, 'Tamanho', iconsSize);
    }

    if (item.image) {
      properties = upsertProperty(properties, '_imagem_produto', item.image);
    }

    const lineItem = {
      quantity: Number(item.quantity || 1),
      requires_shipping: true,
      taxable: false
    };

    // IMPORTANTE:
    // Quando tem variant_id, a Shopify vincula o item ao produto real.
    // Assim aparecem foto, variação/tamanho e vínculo com estoque/produto.
    // Se NÃO tiver variant_id, cai como item manual.
    if (variantId && !Number.isNaN(variantId)) {
      lineItem.variant_id = variantId;
    } else {
      lineItem.title = item.title || item.product_title || 'Produto NEWER';
      lineItem.price = unitPrice.toFixed(2);
      if (item.variant_title || iconsSize) {
        lineItem.variant_title = item.variant_title || iconsSize;
      }
      if (item.sku) {
        lineItem.sku = String(item.sku);
      }
    }

    if (properties.length) {
      lineItem.properties = properties;
    }

    return lineItem;
  });
}

function buildLineItemsFromPagarme(pagarmeItems) {
  return pagarmeItems
    .filter(function (item) {
      return !isShippingTitle(pagarmeItemTitle(item));
    })
    .map(function (item) {
      const variantId = Number(item?.code || item?.variant_id || item?.metadata?.variant_id || 0);
      const lineItem = {
        quantity: pagarmeItemQuantity(item),
        requires_shipping: true,
        taxable: false
      };

      if (variantId && !Number.isNaN(variantId)) {
        lineItem.variant_id = variantId;
      } else {
        lineItem.title = pagarmeItemTitle(item);
        lineItem.price = centsToMoney(pagarmeItemAmount(item));
      }

      const description = pick(item?.description, item?.metadata?.variant_title, '');
      if (description) {
        lineItem.properties = [{ name: 'Tamanho', value: description }];
      }

      return lineItem;
    });
}

function getShippingFromPagarmeItems(pagarmeItems) {
  const shippingItem = pagarmeItems.find(function (item) {
    return isShippingTitle(pagarmeItemTitle(item));
  });

  if (!shippingItem) {
    return { title: 'Frete', price: 0 };
  }

  return {
    title: pagarmeItemTitle(shippingItem),
    price: Number(centsToMoney(pagarmeItemAmount(shippingItem)))
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Use POST ou GET.' });
  }

  try {
    const event = getWebhookEvent(req);
    const data = getWebhookData(req);
    const chargeId = getChargeId(data);
    const orderId = getOrderId(data);
    const orderCode = getOrderCode(data);

    console.log('PAGARME WEBHOOK RECEBIDO:', JSON.stringify({
      method: req.method,
      query: req.query,
      event,
      chargeId,
      orderId,
      orderCode,
      body: req.body
    }, null, 2));

    // IMPORTANTE: só cria pedido Shopify quando a cobrança for paga.
    // Eventos de pedido e payment-link são ignorados para evitar duplicação.
    if (event !== 'charge.paid') {
      return res.status(200).json({
        success: true,
        ignored: true,
        event,
        status: data?.status || ''
      });
    }

    if (!chargeId) {
      return res.status(200).json({ success: false, message: 'charge.paid sem charge id' });
    }

    const fetchedOrder = orderId ? await pagarmeGet(`/orders/${orderId}`) : null;
    let meta = getMetadata(data, fetchedOrder);
    meta = await enrichMetadataFromPaymentLink(meta, data, fetchedOrder);
    const pagarmeItems = getPagarmeItems(data, fetchedOrder);
    const shopifyItems = parseShopifyItems(meta);

    const shopifyStoreDomain = requiredEnv('SHOPIFY_STORE_DOMAIN');
    const shopifyApiVersion = process.env.SHOPIFY_API_VERSION || '2024-10';
    const shopifyAdminToken = requiredEnv('SHOPIFY_ADMIN_TOKEN');

    const shopifyConfig = { shopifyStoreDomain, shopifyApiVersion, shopifyAdminToken };
    const sourceIdentifiers = [
      `pagarme_${chargeId}`,
      orderCode ? `pagarme_${orderCode}` : ''
    ].filter(Boolean);

    const isDuplicate = await checkDuplicate(sourceIdentifiers, shopifyConfig);

    if (isDuplicate) {
      console.log('PEDIDO PAGARME DUPLICADO BLOQUEADO:', sourceIdentifiers);
      return res.status(200).json({
        success: true,
        duplicated: true,
        message: 'Pedido já existia para esse pagamento.'
      });
    }

    let productLineItems = [];

    if (shopifyItems.length) {
      productLineItems = buildLineItemsFromShopify(shopifyItems);
    } else if (pagarmeItems.length) {
      productLineItems = buildLineItemsFromPagarme(pagarmeItems);
    }

    if (!productLineItems.length) {
      productLineItems = [
        {
          title: 'Pedido NEWER',
          quantity: 1,
          price: centsToMoney(getPaidAmount(data)),
          requires_shipping: true,
          taxable: false
        }
      ];
    }

    const customer = getCustomer(data, fetchedOrder);
    const customerName = pick(meta.customer_name, customer?.name, '');
    const nameParts = customerName.trim().split(' ').filter(Boolean);
    const firstName = nameParts.shift() || customerName || 'Cliente';
    const lastName = nameParts.join(' ') || '.';

    const parsedAddress = getAddress(customer, meta);
    const customerPhone = getPhone(customer, meta);
    const customerEmail = pick(meta.customer_email, customer?.email, '');
    const customerCpf = pick(meta.customer_cpf, customer?.document, '');

    const shippingFromItems = getShippingFromPagarmeItems(pagarmeItems);
    const shippingPrice = Number(meta.shipping_price || shippingFromItems.price || 0);
    const shippingTitle = pick(meta.shipping_name, shippingFromItems.title, 'Frete');
    const shippingServiceId = meta.shipping_service_id || null;
    const shippingCode = shippingServiceId ? `melhorenvio_${shippingServiceId}` : shippingTitle;

    const address = {
      first_name: firstName,
      last_name: lastName,
      address1: `${parsedAddress.street || ''}, ${parsedAddress.number || ''}`.trim(),
      address2: parsedAddress.complement || '',
      city: parsedAddress.city || '',
      province: parsedAddress.state || '',
      country: 'Brazil',
      zip: parsedAddress.cep || '',
      phone: customerPhone || ''
    };

    const paymentMethod =
      data?.payment_method ||
      data?.charges?.[0]?.payment_method ||
      data?.last_transaction?.transaction_type ||
      '';

    const amount = centsToMoney(getPaidAmount(data));

    const noteLines = [
      `Pagar.me Charge ID: ${chargeId}`,
      `Pagar.me Order ID: ${orderId}`,
      `Pagar.me Order Code: ${orderCode}`,
      `Evento Pagar.me: ${event}`,
      `Forma de pagamento: ${paymentMethod}`,
      `Cliente: ${customerName || ''}`,
      `CPF: ${customerCpf || ''}`,
      `Telefone: ${customerPhone || ''}`,
      `CEP: ${parsedAddress.cep || ''}`,
      `Endereço: ${parsedAddress.street || ''}, ${parsedAddress.number || ''}`,
      `Complemento: ${parsedAddress.complement || ''}`,
      `Bairro: ${parsedAddress.district || ''}`,
      `Cidade/UF: ${parsedAddress.city || ''}/${parsedAddress.state || ''}`,
      `Frete: ${shippingTitle || ''} - R$ ${shippingPrice.toFixed(2)}`,
      `Cupom: ${meta.coupon_code || ''}`,
      `Desconto: R$ ${Number(meta.discount_amount || 0).toFixed(2)}`
    ];

    const orderPayload = {
      order: {
        email: customerEmail,
        financial_status: 'paid',
        fulfillment_status: null,
        source_name: 'Pagar.me',
        source_identifier: `pagarme_${chargeId}`,
        note: noteLines.join('\n'),
        tags: 'Pagar.me, NEWER Checkout',
        note_attributes: [
          { name: 'pagarme_charge_id', value: String(chargeId || '') },
          { name: 'pagarme_order_id', value: String(orderId || '') },
          { name: 'pagarme_order_code', value: String(orderCode || '') },
          { name: 'customer_name', value: customerName || '' },
          { name: 'customer_email', value: customerEmail || '' },
          { name: 'customer_phone', value: customerPhone || '' },
          { name: 'customer_cpf', value: customerCpf || '' },
          { name: 'customer_cep', value: parsedAddress.cep || '' },
          { name: 'customer_address', value: parsedAddress.street || '' },
          { name: 'customer_number', value: parsedAddress.number || '' },
          { name: 'customer_complement', value: parsedAddress.complement || '' },
          { name: 'customer_district', value: parsedAddress.district || '' },
          { name: 'customer_city', value: parsedAddress.city || '' },
          { name: 'customer_state', value: parsedAddress.state || '' },
          { name: 'shipping_name', value: shippingTitle || '' },
          { name: 'shipping_price', value: shippingPrice.toFixed(2) },
          { name: 'shipping_service_id', value: String(shippingServiceId || '') },
          { name: 'coupon_code', value: meta.coupon_code || '' },
          { name: 'discount_amount', value: Number(meta.discount_amount || 0).toFixed(2) }
        ],
        currency: 'BRL',
        line_items: productLineItems,
        shipping_lines: [
          {
            title: shippingTitle || 'Frete',
            price: shippingPrice.toFixed(2),
            code: shippingCode || 'Frete'
          }
        ],
        shipping_address: address,
        billing_address: address,
        customer: {
          first_name: firstName,
          last_name: lastName,
          email: customerEmail
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
