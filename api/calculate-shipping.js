export default async function handler(req, res) {
  res.status(200).json({
    success: true,
    shipping: [
      {
        name: "Frete Padrão",
        price: 19.90,
        delivery_time: "5 a 9 dias úteis"
      }
    ]
  });
}
