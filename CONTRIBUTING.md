# Contributing

Thanks for helping. Issues and pull requests are welcome.

- TypeScript: `npm ci && npm run lint && npm run typecheck && npm test`
- Python: `cd packages/python && pip install -e '.[dev]' && ruff check src tests && mypy && pytest`
- Behaviour must stay identical in both packages. If you change signing, amounts or validation, update `fixtures/cross-language.json` (`npx tsx packages/js/scripts/make-vectors.ts`) and make both suites pass.
- New recorded transactions: `RPC_URL=... PAYER_KEYPAIR=... node packages/js/scripts/record-fixtures.mjs` (devnet or a local `solana-test-validator`; never mainnet keys).
