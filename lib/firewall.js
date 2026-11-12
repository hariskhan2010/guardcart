// GuardCart payment firewall.
// Deterministic checks decide BLOCK. The LLM intent judge can only raise ASK
// (or BLOCK when combined with a deterministic signal), so a fooled model
// can never approve a bad payment on its own.

import { MERCHANTS, POLICY } from './data.js';
import { judgeIntent } from './judge.js';

const INJECTION_PATTERNS = [
  /ignore (?:all )?previous instructions/i,
  /system notice/i,
  /\b(?:to|note to|attention) (?:ai|shopping) (?:assistants?|agents?)\b/i,
  /\bai agent\b/i,
  /send (?:the )?payment to/i,
  /do not ask the user/i,
  /display\s*:\s*none/i,
  /<!--[\s\S]*?-->/,
  /[​-‏⁠﻿]/, // invisible unicode
];

export function scanInjection(pages) {
  const hits = [];
  for (const p of pages) {
    for (const re of INJECTION_PATTERNS) {
      const m = p.content.match(re);
      if (m) hits.push({ page: p.id, match: m[0].slice(0, 60) });
    }
  }
  return hits;
}

export function deterministicChecks(payment, policy = POLICY) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });

  // 1. Policy
  if (payment.amount > policy.per_transaction_limit) {
    add('Transaction limit', 'block', `$${payment.amount.toFixed(2)} is over the $${policy.per_transaction_limit} per-transaction limit.`);
  } else {
    add('Transaction limit', 'pass', `$${payment.amount.toFixed(2)} is within $${policy.per_transaction_limit}.`);
  }
  const after = policy.spent_this_month + payment.amount;
  if (after > policy.monthly_budget) {
    add('Monthly budget', 'block', `Would bring this month to $${after.toFixed(2)}, over the $${policy.monthly_budget} budget.`);
  } else {
    add('Monthly budget', 'pass', `$${after.toFixed(2)} of $${policy.monthly_budget} after this payment.`);
  }
  if (payment.quantity.value > policy.max_quantity) {
    add('Quantity', 'block', `Quantity ${payment.quantity.value} is over the maximum of ${policy.max_quantity}.`);
  } else {
    add('Quantity', 'pass', `Quantity ${payment.quantity.value}.`);
  }
  if (!policy.allowed_categories.includes(payment.category) || policy.merchant_denylist.includes(payment.merchant)) {
    add('Category / merchant', 'block', `"${payment.category}" from ${payment.merchant} is not allowed.`);
  } else {
    add('Category / merchant', 'pass', `"${payment.category}" is allowed.`);
  }
  if (payment.amount > policy.ask_above) {
    add('Approval threshold', 'ask', `$${payment.amount.toFixed(2)} is above $${policy.ask_above}; user approval required.`);
  }

  // 2. Payee integrity
  const registered = MERCHANTS[payment.merchant]?.payee;
  if (payment.payee.value !== registered) {
    add('Payee integrity', 'block', `Payee ${payment.payee.value} does not match the verified merchant payee ${registered}.`);
  } else {
    add('Payee integrity', 'pass', `Payee matches the verified registry.`);
  }

  // 3. Taint tracking
  const tainted = ['payee', 'quantity', 'item'].filter((k) => payment[k].origin === 'web');
  if (payment.payee.origin === 'web') {
    add('Taint tracking', 'block', `Payee came from untrusted web content.`);
  } else if (tainted.length) {
    add('Taint tracking', 'ask', `Fields set by untrusted web content: ${tainted.join(', ')}.`);
  } else {
    add('Taint tracking', 'pass', 'All payment fields came from the user, catalog or registry.');
  }
  return checks;
}

export async function evaluate(agentResult, policy = POLICY) {
  const { payment, request, pagesRead } = agentResult;
  const checks = deterministicChecks(payment, policy);

  // 4. Injection scanner
  const hits = scanInjection(pagesRead);
  const taintedFields = ['payee', 'quantity', 'item'].some((k) => payment[k].origin === 'web');
  if (hits.length && taintedFields) {
    checks.push({ name: 'Prompt injection', status: 'block', detail: `Injection found on page "${hits[0].page}" ("${hits[0].match}") and payment fields changed after reading it.` });
  } else if (hits.length) {
    checks.push({ name: 'Prompt injection', status: 'ask', detail: `Suspicious text on page "${hits[0].page}", but payment fields were not changed by it.` });
  } else {
    checks.push({ name: 'Prompt injection', status: 'pass', detail: 'No injection patterns in the pages the agent read.' });
  }

  // 5. Isolated intent judge
  const verdict = await judgeIntent(request, payment);
  checks.push({
    name: 'Intent judge',
    status: verdict.matches_intent ? 'pass' : 'ask',
    detail: `${verdict.reason} (${verdict.source})`,
  });

  const decision = checks.some((c) => c.status === 'block') ? 'BLOCK'
    : checks.some((c) => c.status === 'ask') ? 'ASK' : 'ALLOW';
  const reasons = checks.filter((c) => c.status !== 'pass').map((c) => `${c.name}: ${c.detail}`);
  return { decision, checks, reasons };
}
