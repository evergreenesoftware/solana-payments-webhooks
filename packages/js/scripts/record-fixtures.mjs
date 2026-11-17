// Records real devnet transactions as test fixtures (fixtures/recorded-transactions.json).
// Dev-only: uses @solana/web3.js and @solana/spl-token to SEND test payments; the library itself never signs anything.
// Usage: PAYER_KEYPAIR=/path/to/devnet-keypair.json node packages/js/scripts/record-fixtures.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMint,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

// Devnet by default. RPC_URL=http://127.0.0.1:8899 records against a local solana-test-validator instead.
const RPC = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const CLUSTER = RPC.includes('devnet') ? 'devnet' : RPC.includes('127.0.0.1') || RPC.includes('localhost') ? 'localnet' : 'custom';
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const conn = new Connection(RPC, 'confirmed');
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.PAYER_KEYPAIR, 'utf8'))));
const merchant = Keypair.generate(); // receives payments; never signs
const ref = () => Keypair.generate().publicKey;
const memoIx = (text) => new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(text, 'utf8') });
const withRef = (ix, reference) => {
  ix.keys.push({ pubkey: reference, isSigner: false, isWritable: false });
  return ix;
};

console.log('payer', payer.publicKey.toBase58(), (await conn.getBalance(payer.publicKey)) / 1e9, 'SOL');
console.log('merchant', merchant.publicKey.toBase58());

async function send(ixs, opts = {}) {
  const tx = new Transaction().add(...ixs);
  if (opts.skipPreflight) {
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign(payer);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await conn.confirmTransaction(sig, 'confirmed');
    return sig;
  }
  return sendAndConfirmTransaction(conn, tx, [payer], { commitment: 'confirmed' });
}

const cases = [];

// 1. Valid SOL payment with memo (0.01 SOL covers rent for the new merchant account).
const r1 = ref();
const s1 = await send([
  withRef(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: merchant.publicKey, lamports: 10_000_000 }), r1),
  memoIx('order-sol-1'),
]);
cases.push({
  name: 'sol-valid',
  signature: s1,
  expected: { recipient: merchant.publicKey.toBase58(), amount: '0.01', reference: r1.toBase58(), memo: 'order-sol-1' },
  outcome: 'confirmed',
});

// 2. Token setup: a 6-decimal test token (stands in for USDC) and a second token for the wrong-token case.
const mint = await createMint(conn, payer, payer.publicKey, null, 6);
const otherMint = await createMint(conn, payer, payer.publicKey, null, 6);
const payerAta = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
const payerOtherAta = await getOrCreateAssociatedTokenAccount(conn, payer, otherMint, payer.publicKey);
await mintTo(conn, payer, mint, payerAta.address, payer, 1_000_000_000n);
await mintTo(conn, payer, otherMint, payerOtherAta.address, payer, 1_000_000_000n);
const merchantAta = getAssociatedTokenAddressSync(mint, merchant.publicKey);
const merchantOtherAta = getAssociatedTokenAddressSync(otherMint, merchant.publicKey);

const tokenPay = async (m, from, to, amount, reference, memo) =>
  send([
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, to, merchant.publicKey, m),
    withRef(createTransferCheckedInstruction(from, m, to, payer.publicKey, amount, 6), reference),
    ...(memo ? [memoIx(memo)] : []),
  ]);

// 3. Valid token payment of 25.5 (creates the merchant token account in the same transaction).
const r3 = ref();
const s3 = await tokenPay(mint, payerAta.address, merchantAta, 25_500_000n, r3, 'order-usdc-1');
cases.push({
  name: 'spl-valid',
  signature: s3,
  expected: {
    recipient: merchant.publicKey.toBase58(),
    amount: '25.5',
    splToken: mint.toBase58(),
    reference: r3.toBase58(),
    memo: 'order-usdc-1',
  },
  outcome: 'confirmed',
});

// 4. Underpayment: 10 sent, 25.5 expected.
const r4 = ref();
const s4 = await tokenPay(mint, payerAta.address, merchantAta, 10_000_000n, r4);
cases.push({
  name: 'spl-underpaid',
  signature: s4,
  expected: { recipient: merchant.publicKey.toBase58(), amount: '25.5', splToken: mint.toBase58(), reference: r4.toBase58() },
  outcome: 'AMOUNT_TOO_LOW',
});

// 5. Wrong token: paid in otherMint, expected mint.
const r5 = ref();
const s5 = await tokenPay(otherMint, payerOtherAta.address, merchantOtherAta, 25_500_000n, r5);
cases.push({
  name: 'spl-wrong-token',
  signature: s5,
  expected: { recipient: merchant.publicKey.toBase58(), amount: '25.5', splToken: mint.toBase58(), reference: r5.toBase58() },
  outcome: 'WRONG_TOKEN',
});

// 6. Failed transaction: tries to send far more SOL than the payer has (lands on chain with an error).
const r6 = ref();
const s6 = await send(
  [withRef(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: merchant.publicKey, lamports: 1_000_000_000_000n }), r6)],
  { skipPreflight: true },
).catch((e) => {
  console.log('failed-tx case could not be recorded:', e.message);
  return null;
});
if (s6)
  cases.push({
    name: 'sol-failed',
    signature: s6,
    expected: { recipient: merchant.publicKey.toBase58(), amount: '1', reference: r6.toBase58() },
    outcome: 'TRANSACTION_FAILED',
  });

// Fetch each transaction exactly as the library will see it.
for (const c of cases) {
  for (let i = 0; i < 20 && !c.transaction; i++) {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [c.signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
      }),
    });
    c.transaction = (await res.json()).result;
    if (!c.transaction) await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(c.name, c.signature, c.transaction ? 'recorded' : 'NOT FOUND');
}

writeFileSync(
  new URL('../../../fixtures/recorded-transactions.json', import.meta.url),
  `${JSON.stringify({ cluster: CLUSTER, recordedAt: new Date().toISOString(), mint: mint.toBase58(), merchant: merchant.publicKey.toBase58(), cases }, null, 2)}\n`,
);
console.log('done');
if (CLUSTER === 'devnet') for (const c of cases) console.log(`  ${c.name}: https://explorer.solana.com/tx/${c.signature}?cluster=devnet`);
