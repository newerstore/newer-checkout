export default async function handler(req, res) {
  try {
    console.log('WEBHOOK MERCADO PAGO:', req.body);

    return res.status(200).json({
      success: true,
      received: true
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
