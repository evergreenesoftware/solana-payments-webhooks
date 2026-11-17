// Offline tests for RPC lookups, polling and webhook delivery. A fake fetch serves the real recorded transactions.
import { describe, expect, it } from 'vitest';
import recorded from '../../../fixtures/recorded-transactions.json' with { type: 'json' };
import {
  checkPayment,
  createPaymentEvent,
  deliverWebhook,
  type ExpectedPayment,
  RpcError,
  rpcCall,
  SIGNATURE_HEADER,
  validatePayment,
  verifyWebhook,
  waitForPayment,
} from '../src/index.js';

type Case = { name: string; signature: string; expected: ExpectedPayment; transaction: unknown };
const cases = recorded.cases as Case[];
const byName = (n: string) => cases.find((c) => c.name === n)!;

/** A fake Solana RPC that knows the recorded transactions. */
function fakeRpc(opts: { failFirst?: number; status?: number } = {}) {
  let calls = 0;
  const fetchFn = (async (_url: string, init: RequestInit) => {
    calls++;
    if (opts.failFirst && calls <= opts.failFirst) return new Response('busy', { status: opts.status ?? 429 });
    const { method, params } = JSON.parse(String(init.body));
    let result: unknown = null;
    if (method === 'getSignaturesForAddress') {
      result = cases.filter((c) => c.expected.reference === params[0]).map((c) => ({ signature: c.signature, slot: 1, err: null }));
    } else if (method === 'getTransaction') {
      result = cases.find((c) => c.signature === params[0])?.transaction ?? null;
    } else if (method === 'boom') {
      return Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid params' } });
    }
    return Response.json({ jsonrpc: '2.0', id: 1, result });
  }) as typeof fetch;
  return { fetchFn, calls: () => calls };
}

describe('rpcCall', () => {
  it('retries rate limits then succeeds', async () => {
    const rpc = fakeRpc({ failFirst: 2 });
    const sigs = await rpcCall<unknown[]>('http://rpc', 'getSignaturesForAddress', [byName('sol-valid').expected.reference], {
      fetch: rpc.fetchFn,
      retries: 3,
    });
    expect(sigs).toHaveLength(1);
    expect(rpc.calls()).toBe(3);
  });
  it('does not retry JSON-RPC errors', async () => {
    const rpc = fakeRpc();
    await expect(rpcCall('http://rpc', 'boom', [], { fetch: rpc.fetchFn })).rejects.toBeInstanceOf(RpcError);
    expect(rpc.calls()).toBe(1);
  });
  it('gives up after the retry budget', async () => {
    const rpc = fakeRpc({ failFirst: 99, status: 503 });
    await expect(rpcCall('http://rpc', 'getTransaction', ['x'], { fetch: rpc.fetchFn, retries: 1 })).rejects.toThrow(/503/);
  });
});

describe('checkPayment / waitForPayment', () => {
  const rpc = fakeRpc();
  const opts = { rpcUrl: 'http://rpc', fetch: rpc.fetchFn };
  it('confirms a valid payment found by reference', async () => {
    const r = await checkPayment(byName('spl-valid').expected, opts);
    expect(r.status).toBe('confirmed');
    if (r.status === 'confirmed') expect(r.payment.amount).toBe('25.5');
  });
  it('reports an invalid payment with its code', async () => {
    const r = await checkPayment(byName('spl-underpaid').expected, opts);
    expect(r).toMatchObject({ status: 'invalid', signature: byName('spl-underpaid').signature });
    if (r.status === 'invalid') expect(r.error.code).toBe('AMOUNT_TOO_LOW');
  });
  it('is pending when nothing used the reference yet', async () => {
    const r = await checkPayment({ ...byName('spl-valid').expected, reference: '11111111111111111111111111111112' }, opts);
    expect(r.status).toBe('pending');
  });
  it('waitForPayment returns as soon as the payment is confirmed', async () => {
    const r = await waitForPayment(byName('sol-valid').expected, { ...opts, intervalMs: 1 });
    expect(r.status).toBe('confirmed');
  });
  it('waitForPayment times out while pending', async () => {
    const r = await waitForPayment(
      { ...byName('sol-valid').expected, reference: '11111111111111111111111111111112' },
      { ...opts, intervalMs: 1, maxWaitMs: 5 },
    );
    expect(r).toEqual({ status: 'pending', timedOut: true });
  });
  it('waitForPayment honours an abort signal', async () => {
    const ac = new AbortController();
    ac.abort(new Error('stopped'));
    await expect(waitForPayment(byName('sol-valid').expected, { ...opts, signal: ac.signal })).rejects.toThrow('stopped');
  });
});

describe('deliverWebhook', () => {
  const payment = validatePayment(byName('spl-valid').transaction as never, byName('spl-valid').expected);
  const event = createPaymentEvent(payment);
  it('signs the body so the receiver can verify it, retrying failures', async () => {
    let attempts = 0;
    let received: { body: string; header: string | null } | null = null;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      attempts++;
      if (attempts === 1) return new Response('down', { status: 500 });
      received = { body: String(init.body), header: new Headers(init.headers).get(SIGNATURE_HEADER) };
      return new Response('ok');
    }) as typeof fetch;
    const res = await deliverWebhook('http://merchant/webhook', event, 'whsec_x', { fetch: fetchFn, attempts: 3 });
    expect(res).toEqual({ status: 200, attempts: 2 });
    const verified = await verifyWebhook(received!.body, received!.header, 'whsec_x');
    expect(verified.id).toBe(payment.signature);
  });
  it('throws after the last attempt', async () => {
    const fetchFn = (async () => {
      throw new TypeError('network down');
    }) as typeof fetch;
    await expect(deliverWebhook('http://merchant/webhook', event, 's', { fetch: fetchFn, attempts: 2 })).rejects.toThrow('network down');
  });
});
