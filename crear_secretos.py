import json
from pathlib import Path
from secrets import token_hex

files = [Path(name) for name in ("billing.secrets.env", "cliente-propio.env", "cliente-par.env")]
if any(path.exists() for path in files):
    raise SystemExit("Ya existen archivos privados: no se sobrescribieron ni rotaron los tokens.")
clients = {"tienda-a": token_hex(32), "tienda-b": token_hex(32)}
files[0].write_text("BILLING_CLIENTS='" + json.dumps(clients, separators=(",", ":")) + "'\n", encoding="utf-8")
for path, issuer in zip(files[1:], clients):
    path.write_text("BILLING_TOKEN=" + clients[issuer] + "\n", encoding="utf-8")
for path in files:
    try:
        path.chmod(0o600)
    except OSError:
        pass
print("Creados billing.secrets.env, cliente-propio.env y cliente-par.env. No subir a Git.")
