export default async function handler(req, res) {
  const token = process.env.MELHOR_ENVIO_TOKEN || '';

  return res.status(200).json({
    exists: !!token,
    length: token.length,
    startsWith: token.substring(0, 10),
    endsWith: token.substring(token.length - 10)
  });
}
