// Generates fixtures/cross-language.json from the TypeScript implementation. Both packages test against it.
import { writeFileSync } from 'node:fs';
import { base58Encode, createPaymentEvent, fromBaseUnits, signWebhook, toBaseUnits } from '../src/index.js';

const bytes = (seed: number) => Uint8Array.from({ length: 32 }, (_, i) => (i * 31 + seed * 17) % 256);
const base58 = [new Uint8Array(32), Uint8Array.from([0, 0, ...bytes(1).slice(2)]), bytes(2), bytes(3), new Uint8Array(32).fill(255)].map((b) => ({
  hex: Buffer.from(b).toString('hex'),
  base58: base58Encode(b),
}));
const amounts = [
  ['0', 6], ['1', 6], ['10.5', 6], ['0.000001', 6], ['123456789.123456', 6], ['1', 9], ['0.1', 9], ['0.000000001', 9],
].map(([a, d]) => ({ amount: a as string, decimals: d as number, baseUnits: toBaseUnits(a as string, d as number).toString(), roundTrip: fromBaseUnits(toBaseUnits(a as string, d as number), d as number) }));
const payment = {
  signature: '4Nd1mYwSx1Xn8iZr6xGq3a3P9hQ7mJk2cYb5uT8wE1rL9vF6sD2gH7jK3nM5pQ8rS1tU4vW6xY9zA2bC5dE7fG',
  reference: base58Encode(bytes(4)),
  recipient: base58Encode(bytes(5)),
  payer: base58Encode(bytes(6)),
  token: 'USDC',
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '25.5',
  amountBaseUnits: '25500000',
  decimals: 6,
  memo: 'order-42',
  slot: 312345678,
  blockTime: 1800000000,
};
const event = { ...createPaymentEvent(payment), createdAt: '2027-01-15T10:00:00.000Z' };
const body = JSON.stringify(event);
const webhook = { secret: 'whsec_cross_language_test', timestamp: 1800000000, body, header: await signWebhook(body, 'whsec_cross_language_test', 1800000000) };
writeFileSync(new URL('../../../fixtures/cross-language.json', import.meta.url), `${JSON.stringify({ base58, amounts, webhook }, null, 2)}\n`);
console.log('vectors written');
