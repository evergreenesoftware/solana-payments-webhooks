# Security policy

## Supported versions
| Package | Version | Supported |
|---|---|---|
| `solana-payments-webhooks` (npm) | latest 0.x | ✅ |
| `solana-payments-webhooks` (PyPI) | latest 0.x | ✅ |

## Reporting a vulnerability
**Please do not open a public issue.** Use GitHub's **Private vulnerability reporting**
(Security tab → "Report a vulnerability") on this repository. We aim to acknowledge within 3 working days and to ship a
fix or mitigation within 30 days for confirmed issues, crediting you if you wish.

Especially interesting: signature bypasses, timing leaks, raw-body handling mistakes in an adapter, or a provider
changing its signing scheme.

## Security model (summary)
- Signatures are verified over the raw request bytes with constant-time comparison.
- The library never logs secrets, signatures or payloads.
- Some providers offer weak or no body integrity (Flutterwave v3 `verif-hash`, Nomba's unsigned amounts, M-Pesa/MoMo
  unsigned callbacks). Always re-confirm transactions via the provider's API before giving value.
- Unsafe options (`allowUnsignedSandbox`) are off by default and log a warning when enabled.
