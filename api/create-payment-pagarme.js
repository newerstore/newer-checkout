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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function pickNumber(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      const normalized = String(value).replace(',', '.').trim();
      const number = Number(normalized);
      if (!Number.isNaN(number)) return number;
    }
  }
  return 0;
}

function toCents(value) {
  return Math.max(0, Math.round(Number(value || 0) * 100));
}

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

function normalizeShopifyItems(items) {
  if (!Array.isArray(items)) return [];

  return items.map(function (item) {
    const iconsSize = getIconsSize(item);
    const normalized = {
      title: item.title || item.product_title || 'Produto NEWER',
      product_title: item.product_title || item.title || 'Produto NEWER',
      quantity: Number(item.quantity || 1),
      price: pickNumber(item.price, item.unit_price, item.final_price, 0),
      unit_price: pickNumber(item.unit_price, item.price, item.final_price, 0),
      variant_id: item.variant_id || item.id || '',
      variant_title: item.variant_title || item.variantTitle || iconsSize || '',
      sku: item.sku || '',
      handle: item.handle || '',
      product_type: item.product_type || '',
      vendor: item.vendor || '',
      tags: item.tags || '',
      properties: normalizeProperties(item.properties)
    };

    if (isIconsItem(normalized) || isIconsItem(item)) {
      normalized.size = iconsSize;
      normalized.tamanho = iconsSize;
      normalized.properties = upsertProperty(normalized.properties, 'Tamanho', iconsSize || 'Não informado');
    }

    return normalized;
  });
}

function calculateTotal(body, shopifyItems, shippingPrice) {
  const explicitTotal = pickNumber(
    body.total,
    body.amount,
    body.total_amount,
    body.transaction_amount,
    body.final_total,
    body.order_total
  );

  if (explicitTotal > 0) return explicitTotal;

  const itemsTotalFromBodyItems = Array.isArray(body.items)
    ? body.items.reduce(function (sum, item) {
        return sum + pickNumber(item.unit_price, item.price, item.amount, 0) * Number(item.quantity || 1);
      }, 0)
    : 0;

  const itemsTotal = itemsTotalFromBodyItems > 0
    ? itemsTotalFromBodyItems
    : shopifyItems.reduce(function (sum, item) {
        return sum + Number(item.unit_price || item.price || 0) * Number(item.quantity || 1);
      }, 0);

  const discount = pickNumber(body.discount_amount, body.discount, 0);

  return Math.max(0, itemsTotal + Number(shippingPrice || 0) - discount);
}

function pagarmeAuthHeader(secretKey) {
  return `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, message: 'Use POST.' });
    }

    const pagarmeSecretKey = process.env.PAGARME_SECRET_KEY;

    if (!pagarmeSecretKey) {
      return res.status(500).json({ success: false, error: 'Variável de ambiente ausente: PAGARME_SECRET_KEY' });
    }

    const pagarmeBaseUrl = process.env.PAGARME_BASE_URL || 'https://api.pagar.me/core/v5';

    const body = req.body || {};
    const rawShopifyItems = body.shopify_items || body.cart_items || [];
    const shopifyItems = normalizeShopifyItems(rawShopifyItems);

    const customerName = pick(
      body.name,
      body.nome,
      body.full_name,
      body.customer_name,
      body.customer?.name,
      body.customer?.full_name,
      body.shipping_address?.name
    );

    const customerEmail = pick(
      body.email,
      body.customer_email,
      body.customer?.email
    );

    const customerPhone = pick(
      body.phone,
      body.telefone,
      body.whatsapp,
      body.customer_phone,
      body.customer?.phone,
      body.shipping_address?.phone
    );

    const customerCpf = String(body.customer_cpf || body.cpf || '').replace(/\D/g, '');

    const customerCep = pick(
      body.cep,
      body.zip,
      body.postal_code,
      body.customer_cep,
      body.shipping_address?.zip
    );

    const customerAddress = pick(
      body.address,
      body.endereco,
      body.street,
      body.customer_address,
      body.shipping_address?.address1
    );

    const customerNumber = pick(
      body.number,
      body.numero,
      body.customer_number,
      body.shipping_address?.number
    );

    const customerComplement = pick(
      body.complement,
      body.complemento,
      body.customer_complement,
      body.shipping_address?.address2
    );

    const customerDistrict = pick(
      body.district,
      body.neighborhood,
      body.bairro,
      body.customer_district,
      body.shipping_address?.neighborhood
    );

    const customerCity = pick(
      body.city,
      body.cidade,
      body.customer_city,
      body.shipping_address?.city
    );

    const customerState = pick(
      body.state,
      body.uf,
      body.estado,
      body.customer_state,
      body.shipping_address?.province,
      body.shipping_address?.province_code
    );

    const shippingName = pick(
      body.shipping_name,
      body.shipping?.name,
      body.shipping_method,
      body.freight_name
    );

    const shippingPrice = pickNumber(
      body.shipping_price,
      body.shipping?.price,
      body.frete,
      body.freight_price
    );

    const shippingServiceId = body.shipping_service_id || body.shipping?.service_id || null;

    const total = calculateTotal(body, shopifyItems, shippingPrice);
    const totalCents = toCents(total);

    if (!totalCents || totalCents < 100) {
      return res.status(400).json({
        success: false,
        error: 'Total inválido para criar pagamento na Pagar.me',
        total,
        totalCents
      });
    }

    const orderCode = `newer_${Date.now()}`;

    const metadata = {
      provider: 'pagarme',
      order_code: orderCode,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      customer_cpf: customerCpf,
      customer_cep: customerCep,
      customer_address: customerAddress,
      customer_number: customerNumber,
      customer_complement: customerComplement,
      customer_district: customerDistrict,
      customer_city: customerCity,
      customer_state: customerState,
      shipping_name: shippingName,
      shipping_price: shippingPrice,
      shipping_service_id: shippingServiceId,
      coupon_code: body.coupon_code || '',
      discount_amount: body.discount_amount || 0,
      subtotal_before_discount: body.subtotal_before_discount || 0,
      products_total: body.products_total || 0,
      shopify_items: JSON.stringify(shopifyItems)
    };

    const installments = [];
    for (let i = 1; i <= 6; i++) {
      installments.push({
        number: i,
        total: totalCents
      });
    }

    const payload = {
      is_building: false,
      name: `NEWER STORE ${orderCode}`.slice(0, 64),
      order_code: orderCode,
      type: 'order',
      expires_in: 120,
      max_sessions: 1,
      max_paid_sessions: 1,
      // A Pagar.me v5 costuma preservar metadata nos objetos gerados a partir do checkout.
      // O webhook usa esses dados para criar o pedido completo na Shopify.
      metadata,
      payment_settings: {
        accepted_payment_methods: ['credit_card', 'pix'],
        credit_card_settings: {
          operation_type: 'auth_and_capture',
          installments
        },
        pix_settings: {
          expires_in: 3600
        }
      },
      cart_settings: {
        items: [
          {
            amount: totalCents,
            name: `Pedido NEWER STORE ${orderCode}`,
            description: `Pedido NEWER STORE ${orderCode}`,
            default_quantity: 1
          }
        ]
      }
    };

    const response = await fetch(`${pagarmeBaseUrl}/paymentlinks`, {
      method: 'POST',
      headers: {
        Authorization: pagarmeAuthHeader(pagarmeSecretKey),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'newer-store-checkout/1.0'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(function () {
      return {};
    });

    if (!response.ok) {
      console.log('PAGARME ERROR:', JSON.stringify(data, null, 2));
      return res.status(400).json({
        success: false,
        pagarme_error: data,
        sent_payload: payload
      });
    }

    const checkoutUrl = data.url || data.payment_url || data.checkout_url;

    if (!checkoutUrl) {
      return res.status(400).json({
        success: false,
        error: 'A Pagar.me criou o link, mas não retornou URL de pagamento.',
        pagarme_response: data
      });
    }

    return res.status(200).json({
      success: true,
      provider: 'pagarme',
      init_point: checkoutUrl,
      checkout_url: checkoutUrl,
      payment_link_id: data.id,
      preference_id: data.id,
      order_code: orderCode
    });
  } catch (error) {
    console.log('ERRO CREATE PAYMENT PAGARME:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
