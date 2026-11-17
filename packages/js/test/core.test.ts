import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  base58Decode,
  base58Encode,
  createPaymentEvent,
  createPaymentRequest,
  fromBaseUnits,
  isPublicKey,
  MINTS,
  parsePaymentRequest,
  signWebhook,
  toBaseUnits,
  verifyWebhook,
} from '../src/index.js';

describe('base58', () => {
  it('matches @solana/web3.js for random keys', () => {
    for (let i = 0; i < 200; i++) {
      const pk = Keypair.generate().publicKey;
      expect(base58Encode(pk.toBytes())).toBe(pk.toBase58());
      expect(Array.from(base58Decode(pk.toBase58()))).toEqual(Array.from(pk.toBytes()));
    }
  });
  it('handles leading zero bytes', () => {
    const bytes = new Uint8Array(32);
    bytes[31] = 7;
    expect(base58Encode(bytes)).toBe(new PublicKey(bytes).toBase58());
  });
  it('validates public keys', () => {
    expect(isPublicKey(MINTS.USDC)).toBe(true);
    expect(isPublicKey('not-a-key')).toBe(false);
    expect(isPublicKey('0OIl'.repeat(10))).toBe(false);
  });
});

describe('amounts', () => {
  it('converts exactly without floating point', () => {
    expect(toBaseUnits('10.5', 6)).toBe(10_500_000n);
    expect(toBaseUnits('0.000001', 6)).toBe(1n);
    expect(toBaseUnits('1', 9)).toBe(1_000_000_000n);
    expect(toBaseUnits(0.1, 9)).toBe(100_000_000n);
    expect(fromBaseUnits(10_500_000n, 6)).toBe('10.5');
    expect(fromBaseUnits('1', 9)).toBe('0.000000001');
  });
  it('rejects bad amounts', () => {
    expect(() => toBaseUnits('1.0000001', 6)).toThrow(/decimal places/);
    expect(() => toBaseUnits('-1', 6)).toThrow();
    expect(() => toBaseUnits('1e3', 6)).toThrow();
  });
});

describe('payment requests', () => {
  const recipient = Keypair.generate().publicKey.toBase58();
  it('builds a Solana Pay URL and parses it back', () => {
    const req = createPaymentRequest({
      recipient,
      amount: '25',
      splToken: MINTS.USDC,
      label: 'My Shop',
      message: 'Order #42',
      memo: 'order-42',
    });
    expect(req.url.startsWith(`solana:${recipient}?`)).toBe(true);
    expect(req.url).toContain('spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(req.url).toContain('label=My%20Shop');
    expect(isPublicKey(req.reference)).toBe(true);
    const parsed = parsePaymentRequest(req.url);
    expect(parsed).toMatchObject({
      recipient,
      amount: '25',
      splToken: MINTS.USDC,
      memo: 'order-42',
      references: [req.reference],
      label: 'My Shop',
      message: 'Order #42',
    });
  });
  it('generates unique references', () => {
    const refs = new Set(Array.from({ length: 100 }, () => createPaymentRequest({ recipient }).reference));
    expect(refs.size).toBe(100);
  });
  it('rejects invalid input', () => {
    expect(() => createPaymentRequest({ recipient: 'nope' })).toThrow();
    expect(() => createPaymentRequest({ recipient, amount: '1,000' })).toThrow();
  });
});

describe('webhooks', () => {
  const payment = {
    signature: '5'.repeat(88),
    reference: MINTS.USDC_DEVNET,
    recipient: MINTS.USDT,
    payer: null,
    token: 'USDC',
    mint: MINTS.USDC,
    amount: '25',
    amountBaseUnits: '25000000',
    decimals: 6,
    memo: null,
    slot: 1,
    blockTime: 1,
  };
  it('signs and verifies', async () => {
    const body = JSON.stringify(createPaymentEvent(payment));
    const header = await signWebhook(body, 'whsec_test', 1_800_000_000);
    const event = await verifyWebhook(body, header, 'whsec_test', { now: 1_800_000_010 });
    expect(event.id).toBe(payment.signature);
  });
  it('rejects tampering, wrong secrets and replays', async () => {
    const body = JSON.stringify(createPaymentEvent(payment));
    const header = await signWebhook(body, 'whsec_test', 1_800_000_000);
    await expect(verifyWebhook(body.replace('25', '26'), header, 'whsec_test', { now: 1_800_000_000 })).rejects.toThrow(
      /Invalid signature/,
    );
    await expect(verifyWebhook(body, header, 'other', { now: 1_800_000_000 })).rejects.toThrow(/Invalid signature/);
    await expect(verifyWebhook(body, header, 'whsec_test', { now: 1_800_001_000 })).rejects.toThrow(/tolerance/);
    await expect(verifyWebhook(body, null, 'whsec_test')).rejects.toThrow(/Missing/);
  });
});
