# FastAPI webhook receiver: uvicorn fastapi_receiver:app
import os

from fastapi import FastAPI, HTTPException, Request

import solana_payments_webhooks as spw

app = FastAPI()
processed: set[str] = set()  # use a unique index in your database


@app.post("/webhooks/solana")
async def solana_webhook(request: Request) -> dict[str, bool]:
    raw = await request.body()
    try:
        event = spw.verify_webhook(raw, request.headers.get(spw.SIGNATURE_HEADER), os.environ["WEBHOOK_SECRET"])
    except ValueError as err:
        raise HTTPException(400, "invalid signature") from err
    if event["id"] in processed:
        return {"ok": True}  # duplicate delivery; acknowledge
    processed.add(event["id"])
    # fulfil the order using event["data"]["memo"] / event["data"]["reference"]
    return {"ok": True}
