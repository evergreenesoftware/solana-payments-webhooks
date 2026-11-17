# Security policy

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab) rather than a public issue. You will get a reply within 72 hours.

Especially interesting: ways to make `validatePayment` / `checkPayment` accept a payment that did not happen (wrong recipient, token, amount or failed transaction), signature or timestamp bypasses in `verifyWebhook`, and timing leaks.

## Design notes for integrators

- The library never signs transactions or holds funds. Payments go straight to the recipient wallet you configure.
- Verify on your server, never only in the browser.
- Use `finalized` commitment before releasing high-value goods.
- Pass the raw request body to `verifyWebhook`, keep the default timestamp tolerance, and deduplicate events by `id`.
- Memos are public on chain. Never put personal data in them.
