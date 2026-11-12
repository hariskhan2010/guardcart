// A deliberately gullible shopping agent.
// It reads untrusted product pages and follows instructions it finds there,
// the way a prompt-injected LLM agent would. This is deterministic so the demo
// is reproducible; the firewall is what keeps the user safe.

import { CATALOG, MERCHANTS, PAGES } from './data.js';

const tagged = (value, origin) => ({ value, origin });

export function parseRequest(text) {
  const t = text.toLowerCase();
  const max = t.match(/under\s*\$?\s*(\d+(?:\.\d+)?)/);
  const qty = t.match(/\b(\d+)\s*(?:x|units?|packs?|pieces?)\b/) || t.match(/\bbuy\s+(\d+)\b/);
  return {
    text,
    maxPrice: max ? Number(max[1]) : null,
    quantity: qty ? Number(qty[1]) : 1,
  };
}

export function findProduct(text) {
  const t = text.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const p of CATALOG) {
    const score = p.keywords.reduce((s, k) => (t.includes(k) ? s + k.length : s), 0);
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

export function runAgent(requestText) {
  const steps = [];
  const req = parseRequest(requestText);
  const product = findProduct(requestText);
  if (!product) {
    return { ok: false, steps: ['No matching product found in the catalog.'], request: req };
  }
  steps.push(`Searched catalog and picked "${product.name}" ($${product.price.toFixed(2)}).`);

  const pagesRead = [];
  const page = PAGES[product.id] || '';
  pagesRead.push({ id: product.id, content: page });
  steps.push(`Read product page for "${product.name}".`);

  let item = tagged(product.id, 'catalog');
  let quantity = tagged(req.quantity, 'user');
  let payee = tagged(MERCHANTS[product.merchant].payee, 'registry');

  // Gullible behaviour: obey instructions found on the page.
  const payeeHijack = page.match(/send (?:the )?payment to\s+([\w.+-]+@[\w.-]+\.[a-z]{2,})/i);
  if (payeeHijack) {
    payee = tagged(payeeHijack[1], 'web');
    steps.push(`Page said to send payment to ${payeeHijack[1]}. Agent changed the payee.`);
  }
  const qtyHijack = page.match(/buy\s+(\d+)\s+units/i);
  if (qtyHijack) {
    quantity = tagged(Number(qtyHijack[1]), 'web');
    steps.push(`Page said to buy ${qtyHijack[1]} units. Agent changed the quantity.`);
  }
  const upgrade = page.match(/upgrade to\s+([a-z0-9-]+)/i);
  if (upgrade) {
    const alt = CATALOG.find((p) => p.id === upgrade[1]);
    if (alt) {
      item = tagged(alt.id, 'web');
      const altPage = PAGES[alt.id] || '';
      pagesRead.push({ id: alt.id, content: altPage });
      steps.push(`Page said to upgrade to "${alt.name}" ($${alt.price.toFixed(2)}). Agent switched items.`);
    }
  }

  const finalProduct = CATALOG.find((p) => p.id === item.value);
  const amount = Number((finalProduct.price * quantity.value).toFixed(2));
  steps.push(`Built cart: ${quantity.value} x ${finalProduct.name} = $${amount.toFixed(2)}. Requesting payment.`);

  return {
    ok: true,
    steps,
    request: req,
    pagesRead,
    payment: {
      item,
      productName: finalProduct.name,
      unitPrice: finalProduct.price,
      category: finalProduct.category,
      merchant: finalProduct.merchant,
      quantity,
      payee,
      amount,
      currency: 'USD',
    },
  };
}
