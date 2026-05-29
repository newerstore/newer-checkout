export default async function handler(req, res) {
  try {
    const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
    const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';
    const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'Variáveis Shopify ausentes na Vercel.',
        required: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_TOKEN', 'SHOPIFY_API_VERSION']
      });
    }

    const orderPayload = {
      order: {
        email: 'teste@newer.com',
        phone: '11999999999',
        financial_status: 'paid',
        send_receipt: false,
        send_fulfillment_receipt: false,
        tags: 'TESTE NEWER API',
        note: 'Pedido teste criado pela API NEWER para validar dados de cliente e entrega.',

        note_attributes: [
          { name: 'Nome teste', value: 'Cliente Teste' },
          { name: 'Email teste', value: 'teste@newer.com' },
          { name: 'Telefone teste', value: '11999999999' },
          { name: 'Endereço teste', value: 'Rua Teste 123' },
          { name: 'CEP teste', value: '01001000' }
        ],

        customer: {
          first_name: 'Cliente',
          last_name: 'Teste',
          email: 'teste@newer.com',
          phone: '+5511999999999'
        },

        shipping_address: {
          first_name: 'Cliente',
          last_name: 'Teste',
          name: 'Cliente Teste',
          company: '',
          address1: 'Rua Teste 123',
          address2: 'Apto 45',
          city: 'São Paulo',
          province: 'São Paulo',
          province_code: 'SP',
          country: 'Brazil',
          country_code: 'BR',
          zip: '01001-000',
          phone: '+5511999999999'
        },

        billing_address: {
          first_name: 'Cliente',
          last_name: 'Teste',
          name: 'Cliente Teste',
          company: '',
          address1: 'Rua Teste 123',
          address2: 'Apto 45',
          city: 'São Paulo',
          province: 'São Paulo',
          province_code: 'SP',
          country: 'Brazil',
          country_code: 'BR',
          zip: '01001-000',
          phone: '+5511999999999'
        },

        line_items: [
          {
            title: 'Produto Teste NEWER',
            quantity: 1,
            price: '1.00',
            requires_shipping: true,
            taxable: false
          }
        ],

        shipping_lines: [
          {
            title: 'Frete Teste',
            code: 'Frete Teste',
            price: '0.00'
          }
        ],

        transactions: [
          {
            kind: 'sale',
            status: 'success',
            amount: '1.00',
            gateway: 'Teste NEWER'
          }
        ]
      }
    };

    console.log('SHOPIFY TEST PAYLOAD:', JSON.stringify(orderPayload, null, 2));

    const response = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN
        },
        body: JSON.stringify(orderPayload)
      }
    );

    const data = await response.json();

    console.log('SHOPIFY TEST STATUS:', response.status);
    console.log('SHOPIFY TEST RESPONSE:', JSON.stringify(data, null, 2));

    return res.status(response.status).json({
      success: response.ok,
      shopify_status: response.status,
      sent_payload: orderPayload,
      shopify_response: data
    });
  } catch (error) {
    console.log('ERRO TEST CREATE SHOPIFY ORDER:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
