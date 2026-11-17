// Well-known token mints. Always pass the mint you expect explicitly; these are conveniences.
export const MINTS = {
  /** Circle USDC on Solana mainnet. */
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  /** Tether USDT on Solana mainnet. */
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  /** Circle USDC on Solana devnet. */
  USDC_DEVNET: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
} as const;

export const KNOWN_SYMBOLS: Record<string, string> = {
  [MINTS.USDC]: 'USDC',
  [MINTS.USDT]: 'USDT',
  [MINTS.USDC_DEVNET]: 'USDC',
};

export const CLUSTERS = {
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
} as const;

export const SOL_DECIMALS = 9;

/** SPL Memo program ids (v1 and v2). */
export const MEMO_PROGRAM_IDS = new Set(['MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo']);

/** Name of the HTTP header carrying the webhook signature. */
export const SIGNATURE_HEADER = 'solana-payments-signature';
