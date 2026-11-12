// PayPal redirects here after the buyer approves the order (sandbox mode).
import { captureOrder } from '../lib/paypal.js';

export default async function handler(req, res) {
  const token = String(req.query?.token || '');
  if (!/^[A-Z0-9-]{5,40}$/i.test(token)) {
    res.writeHead(302, { Location: '/?error=invalid_token' });
    return res.end();
  }
  try {
    const cap = await captureOrder(token);
    res.writeHead(302, { Location: `/?paid=${encodeURIComponent(cap.id)}&status=${encodeURIComponent(cap.status)}` });
  } catch (e) {
    res.writeHead(302, { Location: `/?error=${encodeURIComponent(e.message.slice(0, 120))}` });
  }
  return res.end();
}
