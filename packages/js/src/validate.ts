// Validates that a confirmed transaction actually paid the expected recipient, token and amount.
import { fromBaseUnits, toBaseUnits } from './amount.js';
import { KNOWN_SYMBOLS, MEMO_PROGRAM_IDS, SOL_DECIMALS } from './constants.js';
import type { ParsedInstruction, ParsedTransaction } from './rpc.js';
import { type ExpectedPayment, type PaymentDetails, PaymentValidationError } from './types.js';

const keyOf = (k: { pubkey: string } | string) => (typeof k === 'string' ? k : k.pubkey);

function memos(tx: ParsedTransaction): string[] {
  const all: ParsedInstruction[] = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions),
  ];
  return all
    .filter((i) => (i.programId && MEMO_PROGRAM_IDS.has(i.programId)) || i.program === 'spl-memo')
    .map((i) => (typeof i.parsed === 'string' ? i.parsed : ''))
    .filter(Boolean);
}

/**
 * Checks a jsonParsed transaction against what you expected to be paid.
 * Returns normalised payment details, or throws PaymentValidationError with a machine-readable `code`.
 */
export function validatePayment(tx: ParsedTransaction | null, expected: ExpectedPayment): PaymentDetails {
  if (!tx?.meta) throw new PaymentValidationError('NOT_FOUND', 'Transaction not found');
  if (tx.meta.err) throw new PaymentValidationError('TRANSACTION_FAILED', 'Transaction failed on chain');

  const keys = tx.transaction.message.accountKeys.map(keyOf);
  if (!keys.includes(expected.reference))
    throw new PaymentValidationError('REFERENCE_MISSING', 'Reference is not part of this transaction');

  let received: bigint;
  let decimals: number;
  let mint: string | null = null;
  if (expected.splToken) {
    mint = expected.splToken;
    const sum = (list: typeof tx.meta.preTokenBalances) =>
      (list ?? [])
        .filter((b) => b.mint === mint && b.owner === expected.recipient)
        .reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    const touched = [...(tx.meta.preTokenBalances ?? []), ...(tx.meta.postTokenBalances ?? [])].filter(
      (b) => b.owner === expected.recipient,
    );
    if (!touched.length)
      throw new PaymentValidationError('RECIPIENT_NOT_PAID', 'Recipient has no token balance change in this transaction');
    const forMint = touched.filter((b) => b.mint === mint);
    if (!forMint.length) throw new PaymentValidationError('WRONG_TOKEN', `Recipient received a different token, not ${mint}`);
    decimals = forMint[0]!.uiTokenAmount.decimals;
    received = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
  } else {
    const i = keys.indexOf(expected.recipient);
    if (i < 0) throw new PaymentValidationError('RECIPIENT_NOT_PAID', 'Recipient is not part of this transaction');
    decimals = SOL_DECIMALS;
    received = BigInt(tx.meta.postBalances[i] ?? 0) - BigInt(tx.meta.preBalances[i] ?? 0);
  }

  const want = toBaseUnits(expected.amount, decimals);
  if (received <= 0n) throw new PaymentValidationError('RECIPIENT_NOT_PAID', 'Recipient balance did not increase');
  if (received < want) {
    throw new PaymentValidationError('AMOUNT_TOO_LOW', `Received ${fromBaseUnits(received, decimals)}, expected ${expected.amount}`);
  }
  if (expected.allowOverpayment === false && received !== want) {
    throw new PaymentValidationError(
      'AMOUNT_MISMATCH',
      `Received ${fromBaseUnits(received, decimals)}, expected exactly ${expected.amount}`,
    );
  }

  const memoList = memos(tx);
  if (expected.memo !== undefined && !memoList.includes(expected.memo)) {
    throw new PaymentValidationError('MEMO_MISMATCH', 'Expected memo not found in transaction');
  }

  return {
    signature: tx.transaction.signatures[0]!,
    reference: expected.reference,
    recipient: expected.recipient,
    payer: keys[0] ?? null,
    token: mint ? (KNOWN_SYMBOLS[mint] ?? 'SPL') : 'SOL',
    mint,
    amount: fromBaseUnits(received, decimals),
    amountBaseUnits: received.toString(),
    decimals,
    memo: memoList[0] ?? null,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
  };
}
