# Billing service — Semana 11

Microservicio serverless de facturación interna para AIS86. Persiste comprobantes en Supabase PostgreSQL, aísla consumidores por token y garantiza una factura por `(issuer_id, order_id)`.

## Preparación

1. Ejecuta `sql/invoices.sql` en el SQL Editor del proyecto Supabase.
2. Ejecuta `python crear_secretos.py` y conserva los tres archivos fuera de Git. Registra únicamente los hashes SHA-256 de los tokens en `billing_clients`; nunca los tokens originales.
3. Instala la CLI con `npm install`.
4. Despliega:

```sh
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase functions deploy billing --use-api --remote=TU_PROJECT_REF
```

Configura S09 con `BILLING_BASE_URL=https://TU_PROJECT_REF.supabase.co/functions/v1/billing` y el `BILLING_TOKEN` de `cliente-propio.env`.

En Windows puedes aplicar esa configuración sin imprimir el token:

```powershell
.\configurar_s09.ps1 -EnvPath ..\ais86-flash-sale-lab\.env -BillingBaseUrl https://TU_PROJECT_REF.supabase.co/functions/v1/billing
```

Verifica concurrencia e aislamiento con:

```sh
python comprobar_servicio.py https://TU_PROJECT_REF.supabase.co/functions/v1/billing
```
