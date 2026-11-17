import json
from pathlib import Path

import pytest

import solana_payments_webhooks as spw

VECTORS = json.loads((Path(__file__).parents[3] / "fixtures" / "cross-language.json").read_text())


def test_base58_vectors() -> None:
    for v in VECTORS["base58"]:
        assert spw.base58_encode(bytes.fromhex(v["hex"])) == v["base58"]
        assert spw.base58_decode(v["base58"]).hex() == v["hex"]


def test_amount_vectors() -> None:
    for v in VECTORS["amounts"]:
        assert str(spw.to_base_units(v["amount"], v["decimals"])) == v["baseUnits"]
        assert spw.from_base_units(v["baseUnits"], v["decimals"]) == v["roundTrip"]


def test_webhook_vector_matches_typescript() -> None:
    w = VECTORS["webhook"]
    assert spw.sign_webhook(w["body"], w["secret"], w["timestamp"]) == w["header"]
    event = spw.verify_webhook(w["body"], w["header"], w["secret"], now=w["timestamp"])
    assert event["type"] == "payment.confirmed"


def test_webhook_rejections() -> None:
    w = VECTORS["webhook"]
    with pytest.raises(ValueError, match="Invalid signature"):
        spw.verify_webhook(w["body"].replace("25.5", "99"), w["header"], w["secret"], now=w["timestamp"])
    with pytest.raises(ValueError, match="Invalid signature"):
        spw.verify_webhook(w["body"], w["header"], "wrong", now=w["timestamp"])
    with pytest.raises(ValueError, match="tolerance"):
        spw.verify_webhook(w["body"], w["header"], w["secret"], now=w["timestamp"] + 3600)
    with pytest.raises(ValueError, match="Missing"):
        spw.verify_webhook(w["body"], None, w["secret"])


def test_amount_rejections() -> None:
    with pytest.raises(ValueError):
        spw.to_base_units("1.0000001", 6)
    with pytest.raises(ValueError):
        spw.to_base_units("-1", 6)
    with pytest.raises(ValueError):
        spw.to_base_units("1e3", 6)
    with pytest.raises(TypeError):
        spw.to_base_units(0.1, 9)  # type: ignore[arg-type]


def test_payment_request_round_trip() -> None:
    recipient = spw.create_reference()
    req = spw.create_payment_request(
        recipient, amount="25", spl_token=spw.MINTS["USDC"], label="My Shop", memo="order-42"
    )
    assert req.url.startswith(f"solana:{recipient}?")
    assert "label=My%20Shop" in req.url
    parsed = spw.parse_payment_request(req.url)
    assert parsed["amount"] == "25"
    assert parsed["spl_token"] == spw.MINTS["USDC"]
    assert parsed["references"] == [req.reference]
    assert parsed["memo"] == "order-42"
    assert spw.is_public_key(req.reference)
    with pytest.raises(ValueError):
        spw.create_payment_request("nope")
