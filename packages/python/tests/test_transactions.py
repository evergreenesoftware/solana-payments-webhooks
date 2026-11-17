import json
import os
from pathlib import Path
from typing import Any

import pytest

import solana_payments_webhooks as spw

RECORDED = json.loads((Path(__file__).parents[3] / "fixtures" / "recorded-transactions.json").read_text())
CASES = {c["name"]: c for c in RECORDED["cases"]}


def _kwargs(expected: dict[str, Any]) -> dict[str, Any]:
    return {
        "recipient": expected["recipient"],
        "amount": expected["amount"],
        "reference": expected["reference"],
        "spl_token": expected.get("splToken"),
        "memo": expected.get("memo"),
    }


@pytest.mark.parametrize("name", list(CASES))
def test_recorded_transactions(name: str) -> None:
    c = CASES[name]
    if c["outcome"] == "confirmed":
        p = spw.validate_payment(c["transaction"], **_kwargs(c["expected"]))
        assert p.signature == c["signature"]
        assert p.amount == c["expected"]["amount"]
        assert p.memo == c["expected"].get("memo")
    else:
        with pytest.raises(spw.PaymentValidationError) as info:
            spw.validate_payment(c["transaction"], **_kwargs(c["expected"]))
        assert info.value.code == c["outcome"]


def test_matches_typescript_shape() -> None:
    c = CASES["spl-valid"]
    d = spw.validate_payment(c["transaction"], **_kwargs(c["expected"])).to_dict()
    assert set(d) == {
        "signature",
        "reference",
        "recipient",
        "payer",
        "token",
        "mint",
        "amount",
        "amountBaseUnits",
        "decimals",
        "memo",
        "slot",
        "blockTime",
    }
    assert d["amountBaseUnits"] == "25500000"


@pytest.mark.skipif(not os.environ.get("RPC_URL"), reason="set RPC_URL to run against a live cluster")
def test_live_check_payment() -> None:
    url = os.environ["RPC_URL"]
    assert spw.check_payment(rpc_url=url, **_kwargs(CASES["spl-valid"]["expected"]))["status"] == "confirmed"
    assert spw.check_payment(rpc_url=url, **_kwargs(CASES["spl-underpaid"]["expected"]))["status"] == "invalid"
