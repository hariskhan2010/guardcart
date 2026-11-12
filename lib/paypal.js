// PayPal Orders v2 client (sandbox). Only the firewall layer calls this.
// Without PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET it runs in mock mode so the
// demo still works end to end.

const BASE = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';

export const isMock = () => !(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

async function token() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

export async function createOrder(payment, { returnUrl, cancelUrl }) {
  if (isMock()) {
    const id = `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    return { id, status: 'CREATED', mock: true, approveUrl: null };
  }
  const t = await token();
  const res = await fetch(`${BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        description: `${payment.quantity.value} x ${payment.productName} (GuardCart)`,
        amount: { currency_code: payment.currency, value: payment.amount.toFixed(2) },
        // Payee comes from the firewall's verified registry value, never the agent.
        ...(process.env.PAYPAL_USE_PAYEE === 'true' ? { payee: { email_address: payment.payee.value } } : {}),
      }],
      application_context: { return_url: returnUrl, cancel_url: cancelUrl, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal create order failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  const approve = data.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  return { id: data.id, status: data.status, mock: false, approveUrl: approve?.href || null };
}

export async function captureOrder(orderId) {
  if (isMock() || orderId.startsWith('MOCK-')) {
    return { id: orderId, status: 'COMPLETED', mock: true };
  }
  const t = await token();
  const res = await fetch(`${BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal capture failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return { id: data.id, status: data.status, mock: false };
}
