export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  return res.status(200).json({ sent: 0 });
}
