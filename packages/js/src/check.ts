// Finds a payment by its reference and verifies it. Polling helper for checkout pages and workers.
import { getParsedTransaction, getSignaturesForAddress, type RpcOptions } from './rpc.js';
import { type CheckResult, type Commitment, type ExpectedPayment, PaymentValidationError } from './types.js';
import { validatePayment } from './validate.js';

export interface CheckOptions extends RpcOptions {
  /** RPC endpoint, e.g. CLUSTERS.devnet or your provider URL. */
  rpcUrl: string;
  /** 'confirmed' (fast, default) or 'finalized' (slower, irreversible). */
  commitment?: Commitment;
}

/**
 * Looks for a transaction carrying `expected.reference` and validates it.
 * - `pending`: nothing on chain yet (keep polling)
 * - `confirmed`: paid correctly
 * - `invalid`: a transaction exists but does not satisfy the payment (wrong amount, token, ...)
 */
export async function checkPayment(expected: ExpectedPayment, opts: CheckOptions): Promise<CheckResult> {
  const commitment = opts.commitment ?? 'confirmed';
  const sigs = await getSignaturesForAddress(opts.rpcUrl, expected.reference, commitment, 1000, opts);
  if (!sigs.length) return { status: 'pending' };
  // Oldest first: the first transaction to use the reference is the payment (Solana Pay convention).
  const ordered = [...sigs].reverse();
  let firstInvalid: CheckResult | null = null;
  for (const s of ordered) {
    const tx = await getParsedTransaction(opts.rpcUrl, s.signature, commitment, opts);
    if (!tx) continue; // not yet visible at this commitment
    try {
      return { status: 'confirmed', payment: validatePayment(tx, expected) };
    } catch (err) {
      if (!(err instanceof PaymentValidationError)) throw err;
      firstInvalid ??= { status: 'invalid', signature: s.signature, error: err };
    }
  }
  return firstInvalid ?? { status: 'pending' };
}

export interface WaitOptions extends CheckOptions {
  /** Poll interval in ms (default 2000). */
  intervalMs?: number;
  /** Give up after this many ms (default 10 minutes). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Polls checkPayment until the payment is confirmed, invalid, timed out or aborted. */
export async function waitForPayment(expected: ExpectedPayment, opts: WaitOptions): Promise<CheckResult & { timedOut?: boolean }> {
  const deadline = Date.now() + (opts.timeoutMs ?? 600_000);
  for (;;) {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('aborted');
    const result = await checkPayment(expected, opts);
    if (result.status !== 'pending') return result;
    if (Date.now() >= deadline) return { status: 'pending', timedOut: true };
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 2000));
  }
}
