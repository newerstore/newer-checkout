export default async function handler(req, res) {
  const response = await fetch('https://melhorenvio.com.br/api/v2/me', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${process.env.MELHOR_ENVIO_TOKEN}`,
      'User-Agent': 'NEWER STORE (neweraimportss2@gmail.com)'
    }
  });

  const data = await response.json();

  return res.status(response.status).json({
    status: response.status,
    data
  });
}
