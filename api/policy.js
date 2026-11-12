import { POLICY } from '../lib/data.js';
import { isMock } from '../lib/paypal.js';

export default function handler(req, res) {
  res.status(200).json({ policy: POLICY, mode: isMock() ? 'mock' : 'paypal-sandbox', llmJudge: Boolean(process.env.ANTHROPIC_API_KEY) });
}
