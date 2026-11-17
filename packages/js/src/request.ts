// Solana Pay transfer requests: https://docs.solanapay.com/spec#specification-transfer-request
import { base58Encode, isPublicKey } from './base58.js';

export interface PaymentRequestOptions {
  /** The merchant's own wallet address. Funds go straight here; this library never holds money. */
  recipient: string;
  /** Decimal amount in the token's units (e.g. "25" USDC or "0.1" SOL). Omit to let the payer choose. */
  amount?: string;
  /** SPL token mint (e.g. MINTS.USDC). Omit for native SOL. */
  splToken?: string;
  /** Unique reference to find this payment on chain. Generated for you if omitted. */
  reference?: string;
  label?: string;
  message?: string;
  /** On-chain memo (visible publicly). Use an order id, never personal data. */
  memo?: string;
}

export interface PaymentRequest {
  url: string;
  reference: string;
  recipient: string;
  amount: string | undefined;
  splToken: string | undefined;
  memo: string | undefined;
}

/** Creates a random reference: 32 random bytes encoded like a public key (Solana Pay convention). */
export function createReference(): string {
  return base58Encode(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

/** Builds a `solana:` transfer request URL (render it as a QR code or link) plus the reference to track it. */
export function createPaymentRequest(opts: PaymentRequestOptions): PaymentRequest {
  if (!isPublicKey(opts.recipient)) throw new TypeError('recipient must be a base58 Solana address');
  if (opts.splToken !== undefined && !isPublicKey(opts.splToken)) throw new TypeError('splToken must be a base58 mint address');
  if (opts.amount !== undefined && !/^\d+(\.\d+)?$/.test(opts.amount)) throw new TypeError('amount must be a decimal string like "10.5"');
  const reference = opts.reference ?? createReference();
  if (!isPublicKey(reference)) throw new TypeError('reference must be a base58 32-byte value');

  const params = new URLSearchParams();
  if (opts.amount !== undefined) params.set('amount', opts.amount);
  if (opts.splToken) params.set('spl-token', opts.splToken);
  params.set('reference', reference);
  if (opts.label) params.set('label', opts.label);
  if (opts.message) params.set('message', opts.message);
  if (opts.memo) params.set('memo', opts.memo);
  const query = params.toString().replace(/\+/g, '%20');
  return {
    url: `solana:${opts.recipient}?${query}`,
    reference,
    recipient: opts.recipient,
    amount: opts.amount,
    splToken: opts.splToken,
    memo: opts.memo,
  };
}

/** Parses a `solana:` transfer request URL back into its fields. */
export function parsePaymentRequest(
  url: string,
): Omit<PaymentRequest, 'url' | 'reference'> & { references: string[]; label?: string; message?: string } {
  if (!url.startsWith('solana:')) throw new TypeError('Not a solana: URL');
  const [recipient = '', query = ''] = url.slice('solana:'.length).split('?', 2);
  if (!isPublicKey(recipient)) throw new TypeError('Invalid recipient in URL');
  const params = new URLSearchParams(query);
  const out: ReturnType<typeof parsePaymentRequest> = {
    recipient,
    amount: params.get('amount') ?? undefined,
    splToken: params.get('spl-token') ?? undefined,
    memo: params.get('memo') ?? undefined,
    references: params.getAll('reference'),
  };
  const label = params.get('label');
  const message = params.get('message');
  if (label !== null) out.label = label;
  if (message !== null) out.message = message;
  return out;
}
