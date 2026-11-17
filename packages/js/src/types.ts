export type Commitment = 'confirmed' | 'finalized';

/** What you expect to have been paid. */
export interface ExpectedPayment {
  /** The merchant wallet that must receive the funds. */
  recipient: string;
  /** Decimal amount, e.g. "25" or "0.1". */
  amount: string;
  /** SPL mint for token payments (e.g. MINTS.USDC). Omit for native SOL. */
  splToken?: string;
  /** The reference from createPaymentRequest. */
  reference: string;
  /** If set, the transaction must carry exactly this memo. */
  memo?: string;
  /** Accept payments larger than `amount` (default true). Set false to require an exact amount. */
  allowOverpayment?: boolean;
}

/** Normalised, verified payment. Safe to store and to send to your backend. */
export interface PaymentDetails {
  signature: string;
  reference: string;
  recipient: string;
  /** Fee payer of the transaction (usually the customer's wallet). */
  payer: string | null;
  /** "SOL" for native payments, otherwise the token symbol if well known, else "SPL". */
  token: string;
  /** Mint address for token payments, null for SOL. */
  mint: string | null;
  /** Decimal amount received by the recipient, e.g. "25.5". */
  amount: string;
  /** Exact amount in base units, as a string. */
  amountBaseUnits: string;
  decimals: number;
  memo: string | null;
  slot: number;
  /** Unix seconds, if the cluster reported it. */
  blockTime: number | null;
}

export interface PaymentEvent {
  /** Stable id: the transaction signature. Use it to deduplicate. */
  id: string;
  type: 'payment.confirmed';
  /** ISO time the event was created. */
  createdAt: string;
  commitment: Commitment;
  data: PaymentDetails;
}

export type ValidationCode =
  | 'NOT_FOUND'
  | 'TRANSACTION_FAILED'
  | 'REFERENCE_MISSING'
  | 'RECIPIENT_NOT_PAID'
  | 'WRONG_TOKEN'
  | 'AMOUNT_TOO_LOW'
  | 'AMOUNT_MISMATCH'
  | 'MEMO_MISMATCH';

export class PaymentValidationError extends Error {
  readonly code: ValidationCode;
  constructor(code: ValidationCode, message: string) {
    super(message);
    this.name = 'PaymentValidationError';
    this.code = code;
  }
}

export type CheckResult =
  | { status: 'pending' }
  | { status: 'confirmed'; payment: PaymentDetails }
  | { status: 'invalid'; signature: string; error: PaymentValidationError };
