// Signed webhooks: build an event, sign it (HMAC-SHA256 with a timestamp), deliver it, and verify it on the receiving side.
import { SIGNATURE_HEADER } from './constants.js';
import type { Commitment, PaymentDetails, PaymentEvent } from './types.js';

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function createPaymentEvent(payment: PaymentDetails, commitment: Commitment = 'confirmed'): PaymentEvent {
  return { id: payment.signature, type: 'payment.confirmed', createdAt: new Date().toISOString(), commitment, data: payment };
}

/** Returns the header value `t=<unix seconds>,v1=<hex hmac of "t.body">`. */
export async function signWebhook(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  if (!secret) throw new TypeError('secret is required');
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${body}`)}`;
}

export interface VerifyOptions {
  /** Reject signatures older than this many seconds (default 300). Set 0 to disable. */
  toleranceSeconds?: number;
  /** Override "now" (unix seconds), for tests. */
  now?: number;
}

/**
 * Verifies a webhook on the receiving side. Pass the RAW request body (exact bytes as text), not re-serialised JSON.
 * Returns the parsed event, or throws.
 */
export async function verifyWebhook(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  opts: VerifyOptions = {},
): Promise<PaymentEvent> {
  if (!header) throw new Error(`Missing ${SIGNATURE_HEADER} header`);
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=', 2) as [string, string]));
  const t = Number(parts.t);
  const given = parts.v1;
  if (!Number.isInteger(t) || !given) throw new Error('Malformed signature header');
  const tolerance = opts.toleranceSeconds ?? 300;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (tolerance > 0 && Math.abs(now - t) > tolerance) throw new Error('Signature timestamp outside tolerance (possible replay)');
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  if (!timingSafeEqual(expected, given)) throw new Error('Invalid signature');
  return JSON.parse(rawBody) as PaymentEvent;
}

export interface DeliverOptions {
  /** Attempts including the first (default 5), with exponential backoff. */
  attempts?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

/** POSTs a signed event to your endpoint. Retries on network errors and non-2xx responses. Receivers should dedupe by `event.id`. */
export async function deliverWebhook(
  url: string,
  event: PaymentEvent,
  secret: string,
  opts: DeliverOptions = {},
): Promise<{ status: number; attempts: number }> {
  const body = JSON.stringify(event);
  const attempts = opts.attempts ?? 5;
  const doFetch = opts.fetch ?? fetch;
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: await signWebhook(body, secret), ...opts.headers },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (res.ok) return { status: res.status, attempts: i };
      last = new Error(`Webhook endpoint returned HTTP ${res.status}`);
    } catch (err) {
      last = err;
    }
    if (i < attempts) await new Promise((r) => setTimeout(r, 500 * 2 ** (i - 1)));
  }
  throw last instanceof Error ? last : new Error(String(last));
}
