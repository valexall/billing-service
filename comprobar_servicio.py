import json
import sys
import uuid
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


def token(path: str) -> str:
    line = Path(path).read_text(encoding="utf-8").strip()
    return line.split("=", 1)[1]


base = sys.argv[1].rstrip("/")
own = token("cliente-propio.env")
peer = token("cliente-par.env")


def call(method: str, path: str, body=None, billing_token=own, key=None):
    data = json.dumps(body, separators=(",", ":")).encode() if body is not None else None
    headers = {"X-Billing-Token": billing_token}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if key:
        headers["Idempotency-Key"] = key
    request = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


order_id = str(uuid.uuid4())
order = {
    "order_id": order_id,
    "currency": "PEN",
    "items": [{"product_id": "concurrent-product", "name": "Prueba concurrente", "quantity": 2, "unit_price_cents": 3000}],
    "total_cents": 6000,
}
with ThreadPoolExecutor(max_workers=5) as pool:
    results = list(pool.map(lambda _: call("POST", "/invoices", order, key=order_id), range(5)))

statuses = sorted(status for status, _ in results)
ids = {body.get("id") for _, body in results}
assert statuses == [200, 200, 200, 200, 201], statuses
assert len(ids) == 1, ids
invoice_id = next(iter(ids))
assert call("GET", f"/invoices/{invoice_id}")[0] == 200
assert call("GET", f"/invoices/{invoice_id}", billing_token=peer)[0] == 404
print(json.dumps({"concurrent_statuses": statuses, "same_invoice": True, "cross_store": 404}))
