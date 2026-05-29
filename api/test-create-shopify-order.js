export default async function handler(req, res) {
  try {
    const response = await fetch(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${process.env.SHOPIFY_API_VERSION}/orders.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN
        },
        body: JSON.stringify({
          order: {
            email: 'teste@newer.com',
            financial_status: 'paid',

            customer: {
              first_name: 'Cliente',
              last_name: 'Teste',
              email: 'teste@newer.com',
              phone: '11999999999'
            },

            shipping_address: {
              first_name: 'Cliente',
              last_name: 'Teste',
              address1: 'Rua Teste 123',
              city: 'São Paulo',
              province: 'SP',
              country: 'Brazil',
              zip: '01001000',
              phone: '11999999999'
            },

            billing_address: {
              first_name: 'Cliente',
              last_name: 'Teste',
              address1: 'Rua Teste 123',
              city: 'São Paulo',
              province: 'SP',
              country: 'Brazil',
              zip: '01001000',
              phone: '11999999999'
            },

            line_items: [
              {
                title: 'Produto Teste NEWER',
                quantity: 1,
                price: '1.00'
              }
            ],

            shipping_lines: [
              {
                title: 'Frete Teste',
                price: '0.00'
              }
            ]
          }
        })
      }
    );

    const data = await response.json();

    return res.status(response.status).json(data);

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
