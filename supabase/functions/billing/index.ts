import { createClient } from "npm:@supabase/supabase-js@2.119.0";

type Item = { product_id: string; name: string; quantity: number; unit_price_cents: number };
type InvoiceInput = { order_id: string; currency: "PEN"; items: Item[]; total_cents: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const columns = "id,issuer_id,order_id,currency,items,total_cents,status,created_at";
const maxBytes = 32_768;

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
const fail = (status: number, code: string, message: string): never => { throw new ApiError(status, code, message); };

function validate(value: unknown): InvoiceInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(422, "VALIDATION_ERROR", "El cuerpo debe ser un objeto.");
  const input = value as Record<string, unknown>;
  const keys = ["currency", "items", "order_id", "total_cents"];
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(keys)) fail(422, "VALIDATION_ERROR", `Campos requeridos y únicos: ${keys.join(", ")}`);
  if (typeof input.order_id !== "string" || !uuid.test(input.order_id) || input.currency !== "PEN") fail(422, "VALIDATION_ERROR", "order_id debe ser UUID en minúsculas y currency debe ser PEN.");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 6) fail(422, "VALIDATION_ERROR", "items debe contener entre 1 y 6 líneas.");
  const products = new Set<string>();
  for (const raw of input.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(422, "VALIDATION_ERROR", "Línea inválida.");
    const item = raw as Record<string, unknown>;
    if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(["name", "product_id", "quantity", "unit_price_cents"])) fail(422, "VALIDATION_ERROR", "Campos de línea inválidos.");
    if (typeof item.product_id !== "string" || !idPattern.test(item.product_id) || products.has(item.product_id) || typeof item.name !== "string" || item.name.length < 1 || item.name.length > 200 || !Number.isInteger(item.quantity) || (item.quantity as number) < 1 || (item.quantity as number) > 100 || !Number.isInteger(item.unit_price_cents) || (item.unit_price_cents as number) < 0 || (item.unit_price_cents as number) > 30000000000) fail(422, "VALIDATION_ERROR", "Línea inválida, producto repetido o entero fuera de rango.");
    products.add(item.product_id);
  }
  const calculated = (input.items as Item[]).reduce((sum, item) => sum + item.quantity * item.unit_price_cents, 0);
  if (!Number.isSafeInteger(input.total_cents) || input.total_cents !== calculated) fail(422, "VALIDATION_ERROR", "total_cents debe ser entero e igual a la suma de las líneas.");
  return input as unknown as InvoiceInput;
}

function canonical(input: InvoiceInput): string {
  return JSON.stringify({
    currency: input.currency,
    items: [...input.items].sort((a, b) => a.product_id.localeCompare(b.product_id)).map((item) => ({
      name: item.name,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
    })),
    order_id: input.order_id,
    total_cents: input.total_cents,
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/billing/, "") || "/";
    if (req.method === "GET" && path === "/health") return reply({ status: "ok", service: "billing" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !secret) fail(503, "CONFIG_ERROR", "Faltan credenciales internas.");
    const db = createClient(supabaseUrl, secret, { auth: { persistSession: false } });
    const provided = req.headers.get("X-Billing-Token") ?? "";
    const tokenHash = await sha256(provided);
    const clientResult = await db.from("billing_clients").select("issuer_id").eq("token_hash", tokenHash).maybeSingle();
    if (clientResult.error) fail(503, "DEPENDENCY_UNAVAILABLE", "No se pudo autenticar al consumidor.");
    const issuer = clientResult.data?.issuer_id;
    if (!issuer) fail(401, "UNAUTHORIZED", "Token inválido.");

    if (req.method === "GET" && /^\/invoices\/[0-9a-f-]+$/.test(path)) {
      const id = path.split("/").pop()!;
      const { data, error } = await db.from("invoices").select(columns).eq("id", id).eq("issuer_id", issuer).maybeSingle();
      if (error) fail(503, "DEPENDENCY_UNAVAILABLE", "No se pudo consultar la factura.");
      if (!data) fail(404, "NOT_FOUND", "Factura no encontrada.");
      return reply(data);
    }
    if (req.method !== "POST" || path !== "/invoices") fail(405, "METHOD_NOT_ALLOWED", "Método o ruta no permitidos.");
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) fail(415, "UNSUPPORTED_MEDIA_TYPE", "Usa application/json.");
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > maxBytes) fail(413, "PAYLOAD_TOO_LARGE", "Cuerpo demasiado grande.");
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { fail(400, "BAD_JSON", "JSON inválido."); }
    const payload = validate(parsed);
    if (req.headers.get("Idempotency-Key") !== payload.order_id) fail(422, "VALIDATION_ERROR", "Idempotency-Key debe ser exactamente order_id.");
    const hash = await sha256(canonical(payload));
    const row = { issuer_id: issuer, ...payload, items: [...payload.items].sort((a, b) => a.product_id.localeCompare(b.product_id)), request_hash: hash };
    const { data, error } = await db.from("invoices").insert(row).select(columns).single();
    if (!error) return reply(data, 201, { "X-Idempotent-Replay": "false" });
    if (error.code !== "23505") fail(503, "DEPENDENCY_UNAVAILABLE", "No se pudo guardar la factura.");
    const existing = await db.from("invoices").select(columns + ",request_hash").eq("issuer_id", issuer).eq("order_id", payload.order_id).single();
    if (existing.error || !existing.data) fail(503, "DEPENDENCY_UNAVAILABLE", "No se pudo recuperar la factura.");
    if (existing.data.request_hash !== hash) fail(409, "IDEMPOTENCY_CONFLICT", "El pedido ya fue facturado con otro contenido.");
    const { request_hash: _hidden, ...snapshot } = existing.data;
    return reply(snapshot, 200, { "X-Idempotent-Replay": "true" });
  } catch (error) {
    if (error instanceof ApiError) return reply({ error: { code: error.code, message: error.message } }, error.status);
    return reply({ error: { code: "INTERNAL_ERROR", message: "Error interno." } }, 500);
  }
});
