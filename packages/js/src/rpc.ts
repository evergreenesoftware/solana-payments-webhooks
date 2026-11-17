// Minimal Solana JSON-RPC client over fetch. Works on Node 20+, Bun, Deno, Cloudflare Workers and browsers.
import type { Commitment } from './types.js';

export interface RpcOptions {
  /** Extra headers (e.g. an API key for a paid RPC provider). */
  headers?: Record<string, string>;
  /** Retries for 429 / 5xx / network errors (default 3). */
  retries?: number;
  /** Per-request timeout in ms (default 20000). */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

let nextId = 1;

export async function rpcCall<T>(endpoint: string, method: string, params: unknown[], opts: RpcOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const doFetch = opts.fetch ?? fetch;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
    try {
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...opts.headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
      if (res.status === 429 || res.status >= 500) throw new RpcError(`RPC HTTP ${res.status}`, res.status);
      const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
      if (body.error) throw new RpcError(body.error.message, body.error.code);
      return body.result as T;
    } catch (err) {
      lastError = err;
      // JSON-RPC errors other than rate limits are not retried.
      if (err instanceof RpcError && err.code !== undefined && err.code !== 429 && err.code < 500) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new RpcError(String(lastError));
}

export interface SignatureInfo {
  signature: string;
  slot: number;
  err: unknown;
  blockTime?: number | null;
  confirmationStatus?: string | null;
}

/** Signatures that touched `address`, newest first. */
export function getSignaturesForAddress(endpoint: string, address: string, commitment: Commitment, limit = 1000, opts?: RpcOptions) {
  return rpcCall<SignatureInfo[]>(endpoint, 'getSignaturesForAddress', [address, { limit, commitment }], opts);
}

/** A jsonParsed transaction, or null if not found at this commitment. */
export function getParsedTransaction(endpoint: string, signature: string, commitment: Commitment, opts?: RpcOptions) {
  return rpcCall<ParsedTransaction | null>(
    endpoint,
    'getTransaction',
    [signature, { encoding: 'jsonParsed', commitment, maxSupportedTransactionVersion: 0 }],
    opts,
  );
}

// The subset of the jsonParsed transaction shape this library reads.
export interface ParsedTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}
export interface ParsedInstruction {
  programId?: string;
  program?: string;
  parsed?: unknown;
  data?: string;
}
export interface ParsedTransaction {
  slot: number;
  blockTime?: number | null;
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: ParsedTokenBalance[];
    postTokenBalances?: ParsedTokenBalance[];
    innerInstructions?: { index: number; instructions: ParsedInstruction[] }[];
    logMessages?: string[];
  } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: ({ pubkey: string; signer: boolean; writable: boolean } | string)[];
      instructions: ParsedInstruction[];
    };
  };
}
