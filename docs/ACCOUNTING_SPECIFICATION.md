# Kala ERP — Accounting & Indian GST Specification

> **Document Role:** Authoritative engineering specification for **Stage 3 (Accounting Core)**, **Stage 4 (Sales/Purchases & GST Engine)**, and **Stage 6 (Financial Reports)**.  
> **Implementation Status:** **Designed** — Not yet implemented in SQL migrations (planned for migrations `020`–`030` and `036`–`038`). No accounting tables exist on `main` today.

---

## 1. Accounting Principles & Non-Negotiable Invariants

1. **True Double-Entry Bookkeeping**: Every posted voucher MUST satisfy `SUM(base_debit) = SUM(base_credit) AND SUM(base_debit) > 0`, enforced by a PostgreSQL `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` on `voucher_entries`.
2. **Absolute Post-Immutable Ledger**: Once `vouchers.status = 'posted'`, a `BEFORE UPDATE OR DELETE` trigger unconditionally rejects any modification to `vouchers` or `voucher_entries`—no admin override, no soft-edit.
3. **Separate Reversal Vouchers Only**: Corrections create a new `REVERSAL` voucher (`reversed_voucher_id = original_id`) with swapped debits/credits. A partial unique index `uq_vouchers_single_reversal` guarantees a voucher can never be reversed twice.
4. **Financial Year Lock Enforcement**: No voucher or bill allocation may be posted inside a locked FY or outside an active FY date range (`assert_financial_year_open()` — already implemented in Stage 1 `012`/`014`).
5. **Single-Transaction Document-to-Ledger Atomicity**: Confirming a Sales Invoice, Purchase Bill, or Return updates `stock_ledger`, freezes the GST tax snapshot, and posts the balanced `vouchers` + `voucher_entries` inside **one** PostgreSQL transaction.

---

## 2. Planned Stage 3 Schema (`020`–`024`)

### 2.1 Chart of Accounts & Cost Centres
- **`accounts`**:
  - `(id, business_id, code, name, account_group IN ('asset','liability','equity','income','expense'), sub_group, party_id NULL, opening_balance NUMERIC(14,2), opening_balance_type IN ('DR','CR'), is_system, is_active)`.
  - Default textile COA seeded per business (Cash, Bank, Sundry Debtors, Sundry Creditors, Inventory Asset, Sales, Purchase, COGS, Job Work Expense, Output CGST/SGST/IGST, Input CGST/SGST/IGST, Freight, Discount, Round-Off, Capital/Reserves).
  - `verify_opening_balances(p_business_id, p_fy_id)` validates `SUM(DR) = SUM(CR)`.
- **`cost_centers`**:
  - `(id, business_id, code, name, is_active)` for branch, mill, or product-line P&L analysis.

### 2.2 Vouchers & Entries
- **`vouchers`**:
  - `(id, business_id, branch_id, fy_id, voucher_no, voucher_type IN ('SALES','PURCHASE','SALES_RETURN','PURCHASE_RETURN','RECEIPT','PAYMENT','JOURNAL','CONTRA','REVERSAL'), voucher_date, currency_code CHAR(3) DEFAULT 'INR', exchange_rate NUMERIC(14,6) DEFAULT 1.0, ref_doc_type, ref_doc_id, reversed_voucher_id NULL, narration, total_amount NUMERIC(14,2), base_total_amount NUMERIC(14,2), status IN ('draft','posted'), created_by UUID, posted_at TIMESTAMPTZ)`.
- **`voucher_entries`**:
  - `(id, business_id, voucher_id, account_id, cost_center_id NULL, debit NUMERIC(14,2), credit NUMERIC(14,2), base_debit NUMERIC(14,2), base_credit NUMERIC(14,2))`.
  - Check constraint: `debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0) AND (debit > 0 OR credit > 0)`.

### 2.3 Dual-Locked Bill Allocations (`bill_allocations`)
- Tracks settlement of Sales/Purchase invoices against Receipts/Payments/Credit Notes/Debit Notes for exact bill-by-bill party ageing.
- `allocate_bill_payment_tx` locks **both** `invoice_voucher_id` AND `settlement_voucher_id` in deterministic `ORDER BY id ASC FOR UPDATE` to prevent race conditions and asserts:
  1. Total allocated against `invoice_voucher_id` `<= invoice_voucher.total_amount` (no over-settlement).
  2. Total allocated from `settlement_voucher_id` `<= settlement_voucher.total_amount` (no double-spending of a receipt/payment).

### 2.4 Financial Year Close (`close_financial_year_tx`)
1. Verifies caller has `finance.fy_close` permission and `p_business_id = current_business_id()`.
2. Blocks closing if unposted draft documents or unallocated pending settlements exist in that FY (unless explicitly cancelled/resolved).
3. Verifies Trial Balance (`SUM(base_debit) = SUM(base_credit)`) and `verify_inventory_integrity(p_business_id)`.
4. Posts closing entry transferring Net Profit/Loss to Reserves/Capital, seeds next FY opening balances, and sets `financial_years.is_locked = TRUE`.

---

## 3. Planned Stage 4 Indian GST Engine (`025`–`030`)

Products never store a hardcoded `DEFAULT 5%` GST rate. Instead:

- **`tax_categories`**: `(id, business_id, name, hsn_sac_code, supply_nature IN ('GOODS','SERVICES'), is_exempt, is_nil_rated)`.
- **`tax_rates`**: `(id, business_id, tax_category_id, effective_from DATE, effective_to DATE NULL, cgst_rate, sgst_rate, igst_rate, cess_rate, rate_threshold_amount NUMERIC(12,2) NULL)` — supports historical rate changes and Indian textile price-slab GST rules (e.g., garments `<= ₹1,000` vs `> ₹1,000`).
- **Tax Determination Inputs**:
  - `place_of_supply_state_code` (from branch state vs. buyer ship-to/bill-to state → Intra-State CGST+SGST vs. Inter-State IGST).
  - `supply_type`: `B2B_REGULAR`, `B2C`, `SEZ_WITH_PAY`, `SEZ_WITHOUT_PAY`, `EXPORT_WITH_PAY`, `EXPORT_WITHOUT_PAY`, `EXEMPT`, `NIL_RATED`.
  - `is_reverse_charge`, `is_tax_inclusive`, line/header discounts, freight (taxed at applicable rate), cess, and round-off.
- **Immutable Tax Snapshots**: On invoice confirmation, seller GSTIN/state, buyer GSTIN/state, addresses, place of supply, supply type, reverse charge, HSN, rate breakdown, and tax totals are frozen so future master edits never mutate filed GSTR-1 or GSTR-3B figures.

---

## 4. Planned Stage 6 Financial & GST Reports (`036`–`038`)

- **Party & Account Ledger** (running DR/CR balance, bill-by-bill view)
- **Trial Balance** (`SUM(DR) = SUM(CR)`)
- **Profit & Loss Statement** (including COGS from frozen `stock_ledger.unit_cost`)
- **Balance Sheet** (`Assets = Liabilities + Equity + Net Profit`)
- **Receivables & Payables Ageing** (0–30 / 31–60 / 61–90 / 90+ days from `bill_allocations`)
- **GSTR-1 & GSTR-3B Summary Exports** (from immutable invoice tax snapshots)
