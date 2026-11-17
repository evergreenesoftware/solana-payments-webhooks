// Runs the BUILT package on Node 20, Bun and Deno: no test framework, just the public API.
import {
  base58Decode,
  base58Encode,
  createPaymentEvent,
  createPaymentRequest,
  MINTS,
  signWebhook,
  toBaseUnits,
  verifyWebhook,
} from '../dist/index.js';

const fail = (m) => {
  console.error(`[smoke] FAIL: ${m}`);
  throw new Error(m);
};
if (base58Encode(base58Decode(MINTS.USDC)) !== MINTS.USDC) fail('base58 round trip');
if (toBaseUnits('25.5', 6) !== 25_500_000n) fail('amounts');
const req = createPaymentRequest({ recipient: MINTS.USDT, amount: '1', splToken: MINTS.USDC });
if (!req.url.startsWith(`solana:${MINTS.USDT}?`)) fail('payment request');
const body = JSON.stringify(
  createPaymentEvent({
    signature: 'sig',
    reference: req.reference,
    recipient: MINTS.USDT,
    payer: null,
    token: 'USDC',
    mint: MINTS.USDC,
    amount: '1',
    amountBaseUnits: '1000000',
    decimals: 6,
    memo: null,
    slot: 1,
    blockTime: null,
  }),
);
const header = await signWebhook(body, 'secret');
const event = await verifyWebhook(body, header, 'secret');
if (event.id !== 'sig') fail('webhook');
console.log(`[smoke] ok (${typeof Bun !== 'undefined' ? 'bun' : typeof Deno !== 'undefined' ? 'deno' : `node ${process.versions.node}`})`);
