// Human-in-the-loop decision for mock-mode orders.
// In PayPal sandbox mode, approval happens on PayPal's own approval page instead.
import { captureOrder } from '../lib/paypal.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { orderId, approve } = req.body || {};
  if (!orderId || !String(orderId).startsWith('MOCK-')) return res.status(400).json({ error: 'Mock order id required' });
  if (!approve) return res.status(200).json({ id: orderId, status: 'CANCELLED_BY_USER' });
  try {
    return res.status(200).json(await captureOrder(orderId));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
