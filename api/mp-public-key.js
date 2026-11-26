export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).json({ public_key: process.env.MP_PUBLIC_KEY || '' });
}
