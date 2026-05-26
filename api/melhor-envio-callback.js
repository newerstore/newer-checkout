export default async function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send('Código não recebido.');
  }

  const response = await fetch('https://melhorenvio.com.br/oauth/token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'NEWER STORE (neweraimportss2@gmail.com)'
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: process.env.MELHOR_ENVIO_CLIENT_ID,
      client_secret: process.env.MELHOR_ENVIO_CLIENT_SECRET,
      redirect_uri: 'https://newer-checkout.vercel.app/api/melhor-envio-callback',
      code
    })
  });

  const data = await response.json();

  return res.status(200).json(data);
}
