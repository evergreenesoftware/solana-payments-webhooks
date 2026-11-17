// Express: create a USDC checkout, poll for payment, notify your order service with a signed webhook.
import express from 'express';
import { CLUSTERS, checkPayment, createPaymentEvent, createPaymentRequest, deliverWebhook, MINTS } from 'solana-payments-webhooks';

const app = express();
const MERCHANT_WALLET = process.env.MERCHANT_WALLET!; // your own wallet: funds go straight here
const RPC_URL = process.env.RPC_URL ?? CLUSTERS.devnet;
const orders = new Map<string, { amount: string; reference: string; paid: boolean }>(); // use your database

app.post('/orders/:id/checkout', (req, res) => {
  const amount = '25';
  const request = createPaymentRequest({
    recipient: MERCHANT_WALLET,
    amount,
    splToken: MINTS.USDC,
    label: 'My Shop',
    memo: `order-${req.params.id}`,
  });
  orders.set(req.params.id, { amount, reference: request.reference, paid: false });
  res.json({ payUrl: request.url }); // render as a QR code with any QR library
});

app.get('/orders/:id/status', async (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.sendStatus(404);
  if (order.paid) return res.json({ status: 'confirmed' });
  const result = await checkPayment(
    { recipient: MERCHANT_WALLET, amount: order.amount, splToken: MINTS.USDC, reference: order.reference },
    { rpcUrl: RPC_URL },
  );
  if (result.status === 'confirmed') {
    order.paid = true;
    await deliverWebhook(process.env.ORDER_WEBHOOK_URL!, createPaymentEvent(result.payment), process.env.WEBHOOK_SECRET!);
  }
  res.json(result.status === 'invalid' ? { status: 'invalid', code: result.error.code } : { status: result.status });
});

app.listen(3000);
