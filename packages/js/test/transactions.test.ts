import { describe, expect, it } from 'vitest';
import recorded from '../../../fixtures/recorded-transactions.json' with { type: 'json' };
import { checkPayment, type ExpectedPayment, type ParsedTransaction, PaymentValidationError, validatePayment } from '../src/index.js';

type Case = { name: string; signature: string; expected: ExpectedPayment; outcome: string; transaction: unknown };
const cases = recorded.cases as Case[];
const sol = cases.find((c) => c.name === 'sol-valid')!;
const spl = cases.find((c) => c.name === 'spl-valid')!;

describe(`recorded transactions (${recorded.cluster})`, () => {
  for (const c of cases) {
    it(`${c.name} -> ${c.outcome}`, () => {
      const tx = c.transaction as ParsedTransaction;
      if (c.outcome === 'confirmed') {
        const p = validatePayment(tx, c.expected);
        expect(p.signature).toBe(c.signature);
        expect(p.amount).toBe(c.expected.amount);
        expect(p.recipient).toBe(c.expected.recipient);
        expect(p.memo).toBe(c.expected.memo ?? null);
        expect(p.payer).not.toBeNull();
      } else {
        try {
          validatePayment(tx, c.expected);
          expect.unreachable('should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(PaymentValidationError);
          expect((err as PaymentValidationError).code).toBe(c.outcome);
        }
      }
    });
  }

  it('rejects the wrong recipient, missing reference, wrong memo and inexact amounts', () => {
    const tx = spl.transaction as ParsedTransaction;
    const code = (e: Partial<ExpectedPayment>) => {
      try {
        validatePayment(tx, { ...spl.expected, ...e });
        return 'ok';
      } catch (err) {
        return (err as PaymentValidationError).code;
      }
    };
    expect(code({ recipient: sol.expected.reference })).toBe('RECIPIENT_NOT_PAID');
    expect(code({ reference: sol.expected.reference })).toBe('REFERENCE_MISSING');
    expect(code({ memo: 'someone-elses-order' })).toBe('MEMO_MISMATCH');
    expect(code({ amount: '25', allowOverpayment: false })).toBe('AMOUNT_MISMATCH');
    expect(code({ amount: '25' })).toBe('ok');
    expect(code({ amount: '25.500001' })).toBe('AMOUNT_TOO_LOW');
  });
  it('reports SOL amounts exactly', () => {
    const p = validatePayment(sol.transaction as ParsedTransaction, sol.expected);
    expect(p).toMatchObject({ token: 'SOL', mint: null, decimals: 9, amountBaseUnits: '10000000', amount: '0.01' });
  });
});

// Live check against a running cluster (set RPC_URL, e.g. a local solana-test-validator with the recorded ledger).
describe.skipIf(!process.env.RPC_URL)('live checkPayment', () => {
  it('finds and confirms payments by reference', async () => {
    const rpcUrl = process.env.RPC_URL!;
    const ok = await checkPayment(spl.expected, { rpcUrl });
    expect(ok.status).toBe('confirmed');
    const under = await checkPayment(cases.find((c) => c.name === 'spl-underpaid')!.expected, { rpcUrl });
    expect(under).toMatchObject({ status: 'invalid' });
    const none = await checkPayment({ ...spl.expected, reference: '11111111111111111111111111111112' }, { rpcUrl });
    expect(none.status).toBe('pending');
  });
});
