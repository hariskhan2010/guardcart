// Intent judge. Sees ONLY the user's original request and the final cart,
// never the web pages, so injected text cannot reach it.
// Uses Claude when ANTHROPIC_API_KEY is set, otherwise a deterministic heuristic.

import { findProduct } from './agent.js';

export function heuristicJudge(request, payment) {
  const expected = findProduct(request.text);
  const reasons = [];
  if (expected && expected.id !== payment.item.value) {
    reasons.push(`User asked for "${expected.name}" but the cart holds "${payment.productName}".`);
  }
  if (request.maxPrice != null && payment.unitPrice > request.maxPrice) {
    reasons.push(`Unit price $${payment.unitPrice.toFixed(2)} is above the user's limit of $${request.maxPrice.toFixed(2)}.`);
  }
  if (payment.quantity.value !== request.quantity) {
    reasons.push(`User asked for ${request.quantity}, cart has ${payment.quantity.value}.`);
  }
  return {
    matches_intent: reasons.length === 0,
    confidence: reasons.length ? 0.9 : 0.8,
    reason: reasons.length ? reasons.join(' ') : 'Cart matches the request.',
    source: 'heuristic',
  };
}

export async function judgeIntent(request, payment) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return heuristicJudge(request, payment);
  try {
    const cart = {
      item: payment.productName,
      unit_price: payment.unitPrice,
      quantity: payment.quantity.value,
      total: payment.amount,
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        max_tokens: 200,
        system:
          'You check whether a shopping cart matches what the user asked for. ' +
          'Reply with JSON only: {"matches_intent": boolean, "confidence": number 0-1, "reason": string}.',
        messages: [{ role: 'user', content: `User request: ${JSON.stringify(request.text)}\nCart: ${JSON.stringify(cart)}` }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    return { ...parsed, source: 'claude' };
  } catch (e) {
    return { ...heuristicJudge(request, payment), source: `heuristic (LLM unavailable: ${e.message})` };
  }
}
