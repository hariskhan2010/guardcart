import { runAgent } from '../lib/agent.js';
import { evaluate } from '../lib/firewall.js';
import { createOrder, captureOrder, isMock } from '../lib/paypal.js';

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const text = String(req.body?.request || '').slice(0, 300).trim();
  if (!text) return res.status(400).json({ error: 'Missing "request"' });

  try {
    const agent = runAgent(text);
    if (!agent.ok) return res.status(200).json({ agent, decision: 'NONE' });

    const fw = await evaluate(agent);
    const out = { agent: { steps: agent.steps, payment: agent.payment }, firewall: fw, mode: isMock() ? 'mock' : 'paypal-sandbox' };

    if (fw.decision === 'BLOCK') {
      out.order = null;
      out.message = 'Payment blocked. No PayPal order was created.';
      return res.status(200).json(out);
    }

    const base = baseUrl(req);
    const order = await createOrder(agent.payment, { returnUrl: `${base}/api/return`, cancelUrl: `${base}/?cancelled=1` });

    if (fw.decision === 'ALLOW' && order.mock) {
      const cap = await captureOrder(order.id);
      out.order = { ...order, status: cap.status };
      out.message = 'Payment allowed and captured automatically.';
    } else {
      out.order = order;
      out.message = fw.decision === 'ALLOW'
        ? 'Payment allowed. Approve it in PayPal to complete.'
        : 'Firewall needs your approval before this payment can go through.';
    }
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
