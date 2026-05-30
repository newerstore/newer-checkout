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

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, message: 'Use POST.' });
    }

    const body = req.body || {};
    const shopifyItems = body.shopify_items || body.cart_items || [];

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

    const customerCpf = (body.customer_cpf || '').replace(/\D/g, ''); // ← CPF

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

    const shippingServiceId = body.shipping_service_id || null; // ← ID do serviço ME

    const metadata = {
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      customer_cpf: customerCpf,           // ← CPF
      customer_cep: customerCep,
      customer_address: customerAddress,
      customer_number: customerNumber,
      customer_complement: customerComplement,
      customer_district: customerDistrict,
      customer_city: customerCity,
      customer_state: customerState,
      shipping_name: shippingName,
      shipping_price: shippingPrice,
      shipping_service_id: shippingServiceId, // ← ID do serviço ME
      coupon_code: body.coupon_code || '',
      discount_amount: body.discount_amount || 0,
      subtotal_before_discount: body.subtotal_before_discount || 0,
      products_total: body.products_total || 0,
      shopify_items: JSON.stringify(shopifyItems)
    };

    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: body.items,
        payer: {
          name: customerName,
          email: customerEmail,
          phone: {
            number: customerPhone
          }
        },
        metadata,
        payment_methods: {
          installments: 6
        },
        back_urls: {
          success: 'https://newer-store.com/pages/pedido-confirmado',
          failure: 'https://newer-store.com/pages/checkout?status=failed',
          pending: 'https://newer-store.com/pages/pedido-confirmado'
        },
        auto_return: 'approved'
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({ success: false, mercado_pago_error: data });
    }

    return res.status(200).json({
      success: true,
      init_point: data.init_point,
      preference_id: data.id
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
