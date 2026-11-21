# Kala ERP — Platform & Developer Console Architecture

> **Document Role:** Authoritative target architecture for Kala's future **Super-Admin & Developer Console** (tenant lifecycle, subscription plans, module gating, observability, and support governance).  
> **Implementation Status:** **Designed / Planned (Stage 8 — Migrations `042`–`044`)** — Not yet implemented in the repository.

---

## 1. Why a Separate Platform Layer?

As Kala scales from individual wholesale shops into a multi-tenant SaaS + Enterprise ERP platform, platform operators need visibility and governance across tenants **without** weakening tenant RLS or granting blanket database access inside the tenant application.

The Platform / Developer Console is a strictly separated administrative surface (`platform.*` schema + dedicated Edge Functions + isolated console routes) that **never shares tenant `memberships` or `x-business-id` session logic**.

---

## 2. Core Capabilities (Planned — Stage 8)

| Domain | Capabilities |
| :--- | :--- |
| **Tenant Lifecycle** | View onboarded businesses, inspect slug/domain status, suspend/reactivate delinquent tenants, manage enterprise dedicated-instance metadata, trigger safe offboarding exports. |
| **Plans & Module Gating** | Manage `subscription_plans` (e.g., *Catalog & QR*, *Inventory & Taka*, *Full Accounting & GST*, *Manufacturing & Mill*, *Enterprise*) and `business_subscriptions`. Server-side `public.has_module(p_business_id, p_module_key)` gates premium RPCs and UI modules consistently. |
| **Health & Reconciliation Telemetry** | Cross-tenant health checks: failed Edge Function invocations, public rate-limit spikes (`public_request_log`), scheduled `verify_inventory_integrity()` and accounting trial-balance anomaly alerts (aggregate status only—no silent tenant data browsing). |
| **Support & Break-Glass Governance** | Time-boxed, reason-coded, read-only support access logged into an immutable `platform_audit_events` table; every break-glass session expires automatically and notifies the tenant owner. |
| **Developer & Release Operations** | Migration version tracking per environment, feature flags per business, webhook delivery logs (E-Invoice, WhatsApp, Desktop sync health). |

---

## 3. Planned Data Model (`platform` Schema)

- `platform.admins (user_id UUID PK, role IN ('super_admin','support_readonly','billing_admin'), is_active, created_at)`
- `platform.subscription_plans (id, code, name, included_modules TEXT[], max_users INT, max_branches INT, monthly_price_inr NUMERIC, is_active)`
- `platform.business_subscriptions (id, business_id REFERENCES public.businesses(id), plan_id, status IN ('trial','active','past_due','suspended','cancelled'), current_period_start, current_period_end, module_overrides JSONB)`
- `platform.audit_events (id, actor_admin_id, target_business_id, action, reason, metadata_json, created_at)` — strictly append-only.

---

## 4. Security Boundaries

1. **Zero Implicit Access to Tenant Tables**: Being listed in `platform.admins` does **not** bypass tenant RLS on `public.*` tables.
2. **Server-Side Module Gating**: `has_module(p_business_id, p_module_key)` is evaluated inside PostgreSQL RPCs and Edge Functions—never trusted purely on frontend flags.
3. **Enterprise Self-Hosted Parity**: Enterprise deployments run the exact same `001`–`0NN` migrations with an `ENTERPRISE_ALL` plan seed so no code forks are required.
