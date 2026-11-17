# solana-payments-webhooks

Accept **SOL, USDC and USDT on Solana** in any backend, without a payment processor and without ever holding customer funds.

1. **Create** a [Solana Pay](https://docs.solanapay.com/) payment request (link or QR code) with a unique reference.
2. **Verify** the payment on chain: right wallet, right token, right amount, transaction succeeded.
3. **Notify** your backend with a **signed webhook** (HMAC-SHA256 with timestamp, replay protection, retries) and verify it on the receiving side in one call.

Zero runtime dependencies. TypeScript for Node 20+, Bun, Deno, Cloudflare Workers and Next.js, plus a Python package with the same API and the same signature format.

```bash
npm install solana-payments-webhooks
pip install solana-payments-webhooks
```

> **Non-custodial by design.** Customers pay straight into the merchant's own wallet. This library only reads public chain data and signs webhook messages with your secret. It never signs transactions or moves funds.

## Quickstart (TypeScript)

```ts
import { CLUSTERS, MINTS, createPaymentRequest, waitForPayment, createPaymentEvent, deliverWebhook } from 'solana-payments-webhooks';

// 1. Create the request and show `url` as a QR code or "Pay with wallet" link.
const request = createPaymentRequest({
  recipient: 'YourMerchantWalletAddress...',
  amount: '25',
  splToken: MINTS.USDC,
  label: 'My Shop',
  message: 'Order #1042',
  memo: 'order-1042', // public on chain: use an id, never personal data
});
// Store request.reference with the order.

// 2. Wait for the customer to pay (or call checkPayment from a job every few seconds).
const result = await waitForPayment(
  { recipient: request.recipient, amount: '25', splToken: MINTS.USDC, reference: request.reference },
  { rpcUrl: CLUSTERS['mainnet-beta'], commitment: 'confirmed', maxWaitMs: 15 * 60_000 },
);

if (result.status === 'confirmed') {
  // 3. Tell your backend (or a merchant's server) with a signed webhook.
  await deliverWebhook('https://shop.example.com/webhooks/solana', createPaymentEvent(result.payment), process.env.WEBHOOK_SECRET!);
} else if (result.status === 'invalid') {
  console.warn('Payment found but not valid:', result.error.code); // e.g. AMOUNT_TOO_LOW, WRONG_TOKEN
}
```

### Receiving the webhook

```ts
import { SIGNATURE_HEADER, verifyWebhook } from 'solana-payments-webhooks';

// Next.js App Router: app/webhooks/solana/route.ts
export async function POST(req: Request) {
  const raw = await req.text(); // the RAW body, not re-serialised JSON
  try {
    const event = await verifyWebhook(raw, req.headers.get(SIGNATURE_HEADER), process.env.WEBHOOK_SECRET!);
    // Deduplicate by event.id (the transaction signature), then fulfil the order.
    return new Response('ok');
  } catch {
    return new Response('invalid signature', { status: 400 });
  }
}
```

## Quickstart (Python)

```python
import os
import solana_payments_webhooks as spw

req = spw.create_payment_request("YourMerchantWalletAddress...", amount="25", spl_token=spw.MINTS["USDC"], memo="order-1042")

result = spw.wait_for_payment(
    rpc_url=spw.CLUSTERS["mainnet-beta"],
    recipient=req.recipient, amount="25", spl_token=spw.MINTS["USDC"], reference=req.reference,
    timeout=900,
)
if result["status"] == "confirmed":
    event = spw.create_payment_event(result["payment"])
    spw.deliver_webhook("https://shop.example.com/webhooks/solana", event, os.environ["WEBHOOK_SECRET"])
```

Receiving (FastAPI):

```python
import os
from fastapi import FastAPI, HTTPException, Request
import solana_payments_webhooks as spw

app = FastAPI()

@app.post("/webhooks/solana")
async def solana_webhook(request: Request):
    raw = await request.body()
    try:
        event = spw.verify_webhook(raw, request.headers.get(spw.SIGNATURE_HEADER), os.environ["WEBHOOK_SECRET"])
    except ValueError:
        raise HTTPException(400, "invalid signature")
    # Deduplicate by event["id"], then fulfil the order.
    return {"ok": True}
```

A webhook signed by the TypeScript package verifies in Python and the other way round (both are tested against the same vectors).

## What "verified" means

`validatePayment` / `checkPayment` accept a payment only if **all** of these hold, and otherwise return a machine-readable code:

| Check | Error code |
|---|---|
| A transaction carrying the reference exists | `pending` (keep polling) or `NOT_FOUND` |
| It succeeded on chain | `TRANSACTION_FAILED` |
| It includes your reference | `REFERENCE_MISSING` |
| The recipient's balance went up | `RECIPIENT_NOT_PAID` |
| In the expected token (SPL mint) | `WRONG_TOKEN` |
| By at least the amount (or exactly, with `allowOverpayment: false`) | `AMOUNT_TOO_LOW` / `AMOUNT_MISMATCH` |
| With the expected memo, if you set one | `MEMO_MISMATCH` |

Amounts are handled as exact integers in base units (bigint / int). There is no floating point anywhere in the money path.

The verified payment looks like this (example values):

```json
{
  "signature": "6zgT7tCmDdYmpkpRR68eErv4YekfYwGSu3nWGRrcUYU48Qj...",
  "reference": "...",
  "recipient": "...",
  "payer": "...",
  "token": "USDC",
  "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "amount": "25.5",
  "amountBaseUnits": "25500000",
  "decimals": 6,
  "memo": "order-1042",
  "slot": 312345678,
  "blockTime": 1800000000
}
```

## Webhook signature format

Header `solana-payments-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`. Verification rejects signatures older than 5 minutes by default (`toleranceSeconds`), compares in constant time, and requires the raw body. Event ids are transaction signatures, so receivers can deduplicate safely when deliveries are retried.

## Production notes

- **Use your own RPC endpoint** (Helius, QuickNode, Triton or your own node) for production. The public `CLUSTERS` endpoints are rate limited and are fine for testing.
- **`confirmed` vs `finalized`**: `confirmed` is fast and right for most checkouts. Use `finalized` before releasing high-value goods.
- **Mints**: always pass the mint you expect. `MINTS` contains Circle USDC and Tether USDT on mainnet and Circle USDC on devnet.
- **Memos are public.** Put an order id there, never names, emails or addresses.
- This library verifies on-chain facts. Pricing, exchange rates and tax are your application's responsibility.

## Testing

The test suites validate real recorded Solana transactions (a SOL payment, a token payment, an underpayment, a wrong-token payment and a failed transaction) in both languages, plus shared cross-language vectors for base58, amounts and webhook signatures. Set `RPC_URL` to also run the live `checkPayment` tests against a running cluster.

```bash
npm ci && npm test                                   # TypeScript
cd packages/python && pip install -e '.[dev]' && pytest   # Python
```

## License

MIT, by Popoola Sinaayo ([Evergreene Software LTD](https://evergreenesoftware.com)). Also by the same author: [africa-payments-webhooks](https://github.com/evergreenesoftware/africa-payments-webhooks).
