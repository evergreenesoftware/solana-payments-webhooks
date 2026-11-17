import { describe, expect, it } from 'vitest';
import vectors from '../../../fixtures/cross-language.json' with { type: 'json' };
import { base58Decode, base58Encode, fromBaseUnits, signWebhook, toBaseUnits, verifyWebhook } from '../src/index.js';

describe('cross-language vectors', () => {
  it('base58', () => {
    for (const v of vectors.base58) {
      expect(base58Encode(Buffer.from(v.hex, 'hex'))).toBe(v.base58);
      expect(Buffer.from(base58Decode(v.base58)).toString('hex')).toBe(v.hex);
    }
  });
  it('amounts', () => {
    for (const v of vectors.amounts) {
      expect(toBaseUnits(v.amount, v.decimals).toString()).toBe(v.baseUnits);
      expect(fromBaseUnits(v.baseUnits, v.decimals)).toBe(v.roundTrip);
    }
  });
  it('webhook signature', async () => {
    const w = vectors.webhook;
    expect(await signWebhook(w.body, w.secret, w.timestamp)).toBe(w.header);
    await expect(verifyWebhook(w.body, w.header, w.secret, { now: w.timestamp })).resolves.toMatchObject({ type: 'payment.confirmed' });
  });
});
