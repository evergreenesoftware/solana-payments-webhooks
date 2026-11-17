"""Accept SOL and USDC on Solana without a payment processor.

Create Solana Pay requests, verify payments on chain, and send or verify signed webhooks.
Zero dependencies. Mirrors the TypeScript package of the same name.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Literal
from urllib.parse import parse_qs, quote, urlencode

__all__ = [
    "CLUSTERS",
    "MINTS",
    "SIGNATURE_HEADER",
    "PaymentDetails",
    "PaymentRequest",
    "PaymentValidationError",
    "base58_decode",
    "base58_encode",
    "check_payment",
    "create_payment_event",
    "create_payment_request",
    "create_reference",
    "deliver_webhook",
    "from_base_units",
    "is_public_key",
    "parse_payment_request",
    "sign_webhook",
    "to_base_units",
    "validate_payment",
    "verify_webhook",
    "wait_for_payment",
]

MINTS = {
    "USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "USDT": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    "USDC_DEVNET": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
}
KNOWN_SYMBOLS = {MINTS["USDC"]: "USDC", MINTS["USDT"]: "USDT", MINTS["USDC_DEVNET"]: "USDC"}
CLUSTERS = {
    "mainnet-beta": "https://api.mainnet-beta.solana.com",
    "devnet": "https://api.devnet.solana.com",
    "testnet": "https://api.testnet.solana.com",
}
SOL_DECIMALS = 9
MEMO_PROGRAM_IDS = {"MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"}
SIGNATURE_HEADER = "solana-payments-signature"
Commitment = Literal["confirmed", "finalized"]

# --- base58 -------------------------------------------------------------------------------------

_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_INDEX = {c: i for i, c in enumerate(_ALPHABET)}


def base58_encode(data: bytes) -> str:
    zeros = len(data) - len(data.lstrip(b"\0"))
    n = int.from_bytes(data, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = _ALPHABET[r] + out
    return "1" * zeros + out


def base58_decode(text: str) -> bytes:
    zeros = len(text) - len(text.lstrip("1"))
    n = 0
    for c in text:
        if c not in _INDEX:
            raise ValueError(f'Invalid base58 character "{c}"')
        n = n * 58 + _INDEX[c]
    body = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    return b"\0" * zeros + body


def is_public_key(value: object) -> bool:
    if not isinstance(value, str) or not 32 <= len(value) <= 44:
        return False
    try:
        return len(base58_decode(value)) == 32
    except ValueError:
        return False


# --- amounts ------------------------------------------------------------------------------------


def to_base_units(amount: str | int | Decimal, decimals: int) -> int:
    """Converts a decimal amount ("10.5") into integer base units. Never uses floats."""
    if isinstance(amount, float):
        raise TypeError("Pass amounts as strings or Decimal, not float")
    text = str(amount).strip()
    try:
        value = Decimal(text)
    except InvalidOperation as err:
        raise ValueError(f'Invalid amount "{text}"') from err
    if not value.is_finite() or value < 0 or "e" in text.lower():
        raise ValueError(f'Invalid amount "{text}": use a positive decimal string such as "10.5"')
    scaled = value * (Decimal(10) ** decimals)
    if scaled != scaled.to_integral_value():
        raise ValueError(f'Amount "{text}" has more than {decimals} decimal places')
    return int(scaled)


def from_base_units(units: int | str, decimals: int) -> str:
    value = int(units)
    sign = "-" if value < 0 else ""
    whole, frac = divmod(abs(value), 10**decimals)
    frac_text = str(frac).rjust(decimals, "0").rstrip("0")
    return f"{sign}{whole}{'.' + frac_text if frac_text else ''}"


# --- payment requests (Solana Pay) --------------------------------------------------------------


@dataclass(frozen=True)
class PaymentRequest:
    url: str
    reference: str
    recipient: str
    amount: str | None = None
    spl_token: str | None = None
    memo: str | None = None


def create_reference() -> str:
    return base58_encode(secrets.token_bytes(32))


def create_payment_request(
    recipient: str,
    amount: str | None = None,
    spl_token: str | None = None,
    reference: str | None = None,
    label: str | None = None,
    message: str | None = None,
    memo: str | None = None,
) -> PaymentRequest:
    """Builds a `solana:` transfer request URL (render as QR code or link) and the reference to track it."""
    if not is_public_key(recipient):
        raise ValueError("recipient must be a base58 Solana address")
    if spl_token is not None and not is_public_key(spl_token):
        raise ValueError("spl_token must be a base58 mint address")
    if amount is not None:
        to_base_units(amount, 18)  # validates format
    ref = reference or create_reference()
    if not is_public_key(ref):
        raise ValueError("reference must be a base58 32-byte value")
    params: list[tuple[str, str]] = []
    if amount is not None:
        params.append(("amount", amount))
    if spl_token:
        params.append(("spl-token", spl_token))
    params.append(("reference", ref))
    for key, val in (("label", label), ("message", message), ("memo", memo)):
        if val:
            params.append((key, val))
    query = urlencode(params, quote_via=quote)
    return PaymentRequest(f"solana:{recipient}?{query}", ref, recipient, amount, spl_token, memo)


def parse_payment_request(url: str) -> dict[str, Any]:
    if not url.startswith("solana:"):
        raise ValueError("Not a solana: URL")
    recipient, _, query = url[len("solana:") :].partition("?")
    if not is_public_key(recipient):
        raise ValueError("Invalid recipient in URL")
    q = parse_qs(query, keep_blank_values=True)

    def first(k: str) -> str | None:
        return q[k][0] if k in q else None

    return {
        "recipient": recipient,
        "amount": first("amount"),
        "spl_token": first("spl-token"),
        "memo": first("memo"),
        "references": q.get("reference", []),
        "label": first("label"),
        "message": first("message"),
    }


# --- validation ---------------------------------------------------------------------------------


class PaymentValidationError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class PaymentDetails:
    signature: str
    reference: str
    recipient: str
    payer: str | None
    token: str
    mint: str | None
    amount: str
    amount_base_units: str
    decimals: int
    memo: str | None
    slot: int
    block_time: int | None

    def to_dict(self) -> dict[str, Any]:
        """camelCase keys, identical to the TypeScript package's PaymentDetails."""
        d = asdict(self)
        return {
            "signature": d["signature"],
            "reference": d["reference"],
            "recipient": d["recipient"],
            "payer": d["payer"],
            "token": d["token"],
            "mint": d["mint"],
            "amount": d["amount"],
            "amountBaseUnits": d["amount_base_units"],
            "decimals": d["decimals"],
            "memo": d["memo"],
            "slot": d["slot"],
            "blockTime": d["block_time"],
        }


def _key(k: Any) -> str:
    return k if isinstance(k, str) else str(k["pubkey"])


def _memos(tx: dict[str, Any]) -> list[str]:
    meta = tx.get("meta") or {}
    instructions = list(tx["transaction"]["message"]["instructions"])
    for inner in meta.get("innerInstructions") or []:
        instructions.extend(inner["instructions"])
    out: list[str] = []
    for ix in instructions:
        is_memo = ix.get("programId") in MEMO_PROGRAM_IDS or ix.get("program") == "spl-memo"
        if is_memo and isinstance(ix.get("parsed"), str) and ix["parsed"]:
            out.append(ix["parsed"])
    return out


def validate_payment(
    tx: dict[str, Any] | None,
    *,
    recipient: str,
    amount: str,
    reference: str,
    spl_token: str | None = None,
    memo: str | None = None,
    allow_overpayment: bool = True,
) -> PaymentDetails:
    """Checks a jsonParsed transaction against the expected payment. Raises PaymentValidationError with a `code`."""
    if not tx or not tx.get("meta"):
        raise PaymentValidationError("NOT_FOUND", "Transaction not found")
    meta = tx["meta"]
    if meta.get("err"):
        raise PaymentValidationError("TRANSACTION_FAILED", "Transaction failed on chain")
    keys = [_key(k) for k in tx["transaction"]["message"]["accountKeys"]]
    if reference not in keys:
        raise PaymentValidationError("REFERENCE_MISSING", "Reference is not part of this transaction")

    mint: str | None = None
    if spl_token:
        mint = spl_token
        pre, post = meta.get("preTokenBalances") or [], meta.get("postTokenBalances") or []
        touched = [b for b in pre + post if b.get("owner") == recipient]
        if not touched:
            raise PaymentValidationError(
                "RECIPIENT_NOT_PAID", "Recipient has no token balance change in this transaction"
            )
        for_mint = [b for b in touched if b["mint"] == mint]
        if not for_mint:
            raise PaymentValidationError("WRONG_TOKEN", f"Recipient received a different token, not {mint}")
        decimals = int(for_mint[0]["uiTokenAmount"]["decimals"])

        def total(lst: list[dict[str, Any]]) -> int:
            return sum(
                int(b["uiTokenAmount"]["amount"]) for b in lst if b["mint"] == mint and b.get("owner") == recipient
            )

        received = total(post) - total(pre)
    else:
        if recipient not in keys:
            raise PaymentValidationError("RECIPIENT_NOT_PAID", "Recipient is not part of this transaction")
        i = keys.index(recipient)
        decimals = SOL_DECIMALS
        received = int(meta["postBalances"][i]) - int(meta["preBalances"][i])

    want = to_base_units(amount, decimals)
    if received <= 0:
        raise PaymentValidationError("RECIPIENT_NOT_PAID", "Recipient balance did not increase")
    if received < want:
        raise PaymentValidationError(
            "AMOUNT_TOO_LOW", f"Received {from_base_units(received, decimals)}, expected {amount}"
        )
    if not allow_overpayment and received != want:
        raise PaymentValidationError(
            "AMOUNT_MISMATCH", f"Received {from_base_units(received, decimals)}, expected exactly {amount}"
        )
    memo_list = _memos(tx)
    if memo is not None and memo not in memo_list:
        raise PaymentValidationError("MEMO_MISMATCH", "Expected memo not found in transaction")
    return PaymentDetails(
        signature=tx["transaction"]["signatures"][0],
        reference=reference,
        recipient=recipient,
        payer=keys[0] if keys else None,
        token=(KNOWN_SYMBOLS.get(mint, "SPL") if mint else "SOL"),
        mint=mint,
        amount=from_base_units(received, decimals),
        amount_base_units=str(received),
        decimals=decimals,
        memo=memo_list[0] if memo_list else None,
        slot=int(tx["slot"]),
        block_time=tx.get("blockTime"),
    )


# --- RPC and polling ----------------------------------------------------------------------------


def _rpc(url: str, method: str, params: list[Any], timeout: float = 20.0, retries: int = 3) -> Any:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    last: Exception | None = None
    for attempt in range(retries + 1):
        if attempt:
            time.sleep(0.4 * 2 ** (attempt - 1))
        req = urllib.request.Request(url, body, {"content-type": "application/json"})  # noqa: S310
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 (caller-supplied RPC URL)
                payload = json.loads(res.read())
        except urllib.error.HTTPError as err:
            last = err
            if err.code == 429 or err.code >= 500:
                continue
            raise
        except urllib.error.URLError as err:
            last = err
            continue
        if "error" in payload:
            raise RuntimeError(f"RPC error {payload['error'].get('code')}: {payload['error'].get('message')}")
        return payload["result"]
    raise RuntimeError(f"RPC request failed: {last}")


def check_payment(
    *,
    rpc_url: str,
    recipient: str,
    amount: str,
    reference: str,
    spl_token: str | None = None,
    memo: str | None = None,
    allow_overpayment: bool = True,
    commitment: Commitment = "confirmed",
) -> dict[str, Any]:
    """Returns {"status": "pending"} | {"status": "confirmed", "payment": PaymentDetails} | {"status": "invalid", ...}."""
    sigs = _rpc(rpc_url, "getSignaturesForAddress", [reference, {"limit": 1000, "commitment": commitment}])
    if not sigs:
        return {"status": "pending"}
    first_invalid: dict[str, Any] | None = None
    for s in reversed(sigs):
        tx = _rpc(
            rpc_url,
            "getTransaction",
            [s["signature"], {"encoding": "jsonParsed", "commitment": commitment, "maxSupportedTransactionVersion": 0}],
        )
        if not tx:
            continue
        try:
            payment = validate_payment(
                tx,
                recipient=recipient,
                amount=amount,
                reference=reference,
                spl_token=spl_token,
                memo=memo,
                allow_overpayment=allow_overpayment,
            )
            return {"status": "confirmed", "payment": payment}
        except PaymentValidationError as err:
            first_invalid = first_invalid or {"status": "invalid", "signature": s["signature"], "error": err}
    return first_invalid or {"status": "pending"}


def wait_for_payment(*, interval: float = 2.0, timeout: float = 600.0, **kwargs: Any) -> dict[str, Any]:
    """Polls check_payment until confirmed, invalid or timed out (then returns {"status": "pending", "timed_out": True})."""
    deadline = time.monotonic() + timeout
    while True:
        result = check_payment(**kwargs)
        if result["status"] != "pending":
            return result
        if time.monotonic() >= deadline:
            return {"status": "pending", "timed_out": True}
        time.sleep(interval)


# --- webhooks -----------------------------------------------------------------------------------


def create_payment_event(payment: PaymentDetails, commitment: Commitment = "confirmed") -> dict[str, Any]:
    return {
        "id": payment.signature,
        "type": "payment.confirmed",
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "commitment": commitment,
        "data": payment.to_dict(),
    }


def sign_webhook(body: str | bytes, secret: str, timestamp: int | None = None) -> str:
    """Returns the header value `t=<unix seconds>,v1=<hex hmac-sha256 of "t.body">` (same as the TS package)."""
    if not secret:
        raise ValueError("secret is required")
    ts = int(time.time()) if timestamp is None else timestamp
    raw = body.encode() if isinstance(body, str) else body
    digest = hmac.new(secret.encode(), f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    return f"t={ts},v1={digest}"


def verify_webhook(
    raw_body: str | bytes, header: str | None, secret: str, tolerance_seconds: int = 300, now: int | None = None
) -> dict[str, Any]:
    """Verifies a webhook. Pass the RAW request body. Returns the parsed event or raises ValueError."""
    if not header:
        raise ValueError(f"Missing {SIGNATURE_HEADER} header")
    parts = dict(p.strip().split("=", 1) for p in header.split(",") if "=" in p)
    try:
        ts = int(parts["t"])
        given = parts["v1"]
    except (KeyError, ValueError) as err:
        raise ValueError("Malformed signature header") from err
    current = int(time.time()) if now is None else now
    if tolerance_seconds > 0 and abs(current - ts) > tolerance_seconds:
        raise ValueError("Signature timestamp outside tolerance (possible replay)")
    raw = raw_body.encode() if isinstance(raw_body, str) else raw_body
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, given):
        raise ValueError("Invalid signature")
    event: dict[str, Any] = json.loads(raw)
    return event


def deliver_webhook(url: str, event: dict[str, Any], secret: str, attempts: int = 5, timeout: float = 10.0) -> int:
    """POSTs a signed event, retrying non-2xx and network errors. Returns the HTTP status. Receivers dedupe by event id."""
    body = json.dumps(event, separators=(",", ":"))
    last: Exception | None = None
    for i in range(1, attempts + 1):
        req = urllib.request.Request(  # noqa: S310
            url, body.encode(), {"content-type": "application/json", SIGNATURE_HEADER: sign_webhook(body, secret)}
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310
                return int(res.status)
        except (urllib.error.HTTPError, urllib.error.URLError) as err:
            last = err
        if i < attempts:
            time.sleep(0.5 * 2 ** (i - 1))
    raise RuntimeError(f"Webhook delivery failed after {attempts} attempts: {last}")
