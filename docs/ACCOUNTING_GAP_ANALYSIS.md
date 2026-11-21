# Kala ERP — Accounting Gap Analysis & Defect Register (Rev 3 — Migrations `020`–`026`)

> **Document Role:** Deep technical investigation of Kala's Stage 3 accounting implementation (`feat/stage-3-accounting`, migrations `020`–`026`, `src/services/accounting.ts`, `src/types/index.ts`, `supabase/tests/stage3_accounting.sql`) against production Indian textile accounting and **Tripta RELY** replacement requirements.  
> **Scope:** Investigation and architecture analysis only — no code or SQL migrations were modified.

---

## 1. Critical Investigation Summary

### 1.1 Party-Level Allocation Integrity (`020`–`025` vs. `026` vs. Target `C1`)
- **In `020`–`025`**: **Critical Defect.** No `party_id` existed on `vouchers`, `voucher_entries`, or `bill_allocations`. Customer B's receipt could be allocated against Customer A's invoice.
- **In `026` (`10a9b5d`)**: Added composite-FK `party_id` to `vouchers`, `voucher_entries`, and `bill_allocations` and blocked cross-party and party-less allocations in `allocate_bill_payment_tx()`.
- **Remaining Structural Defect (`C1`)**: `allocate_bill_payment_tx()` STILL caps allocations against `vouchers.base_total_amount` rather than the **party control-account `voucher_entry_id`**.
  - On a two-component sales voucher (`DR Sundry Debtors ₹11,025`, `CR Sales ₹10,500`, `CR Output GST ₹525`, `DR COGS ₹8,000`, `CR Inventory ₹8,000` → **`base_total_amount = ₹19,025`**), Customer A owes **`₹11,025`**, NOT `₹19,025`.
  - On a mill bill with TDS 194C (`DR Job Work ₹2,000`, `DR Input GST ₹100`, `CR Mill Payable ₹2,060`, `CR TDS Payable ₹40` → **`base_total_amount = ₹2,100`**), the mill is owed **`₹2,060`**, NOT `₹2,100`.
  - Furthermore, Agent Brokerage (`₹200` for `Agent R`) involves a **different counterparty** from `Customer A` and must be posted as a separate voucher (or multi-party journal with distinct `voucher_entry_id` subledger rows).
  - **Required Architecture**: Explicit `party_subledger_bills` table referencing `voucher_entry_id` (see [`ACCOUNTING_MASTER_SPECIFICATION.md`](ACCOUNTING_MASTER_SPECIFICATION.md#31-c1--party-subledger--open-bill-allocation-model-designed)) + automated `verify_subledger_control_tieout()`.

### 1.2 Per-Financial-Year Opening Balances & Carry-Forward (`C2`)
- **Current State (`020`, `024`)**: `accounts.opening_balance` is a single global column. `close_financial_year_tx()` (`024`) posts the Net Profit closing journal and locks `p_fy_id`, but **does not** store per-FY opening balances or carry forward closing Asset/Liability/Equity balances into the next FY.
- **Required Architecture**: Separate `account_opening_balances (business_id, fy_id, account_id, branch_id, party_id, currency_code, opening_txn_debit/credit, opening_base_debit/credit, source_type, source_fy_id, source_ref)` where FY close:
  - **Carries forward** permanent accounts (`asset`, `liability`, `equity` — with `3100 Retained Earnings` reflecting Net P&L) and open party subledger bills into `next_fy_id`,
  - **Closes to zero** nominal accounts (`income`, `expense`), and
  - **Reconciles** `SUM(next_fy opening_base_debit) = SUM(next_fy opening_base_credit)` AND `SUM(party subledger) = control accounts`.

### 1.3 Currency Model & Realised / Unrealised FX (`H1`)
- **Current State (`022`, `025`, `026`)**: Dual-currency balance is enforced on `post_voucher_tx()`, and `026` locks `bill_allocations.currency_code = 'INR'`.
- **Gap**: Foreign-currency settlements (e.g., `$1,000` invoiced @ `₹83 = ₹83,000`, received @ `₹84.50 = ₹84,500` → `+₹1,500` Realised FX Gain) cannot reconcile both `$1,000` foreign-currency remaining AND `₹83,000` carrying INR without recording `txn_currency_code`, `allocated_txn_amount`, `carrying_base_amount`, `settled_base_amount`, and `realised_fx_diff` on `bill_allocations` + posting the INR receipt voucher (`DR Bank ₹84,500 / CR Debtors ₹83,000 / CR Realised FX Gain ₹1,500`). Partial multi-rate FX receipts, foreign-currency advances (non-monetary, no FX gain/loss), and year-end unrealised FX revaluation must also be modeled.

---

## 2. Severity-Ranked Defect & Architectural Gap Register

| ID | Severity | Defect / Gap | Location | Required Correction |
| :---: | :---: | :--- | :--- | :--- |
| **C1** | **Critical** | Allocation cap uses `vouchers.base_total_amount` instead of the exact party control-account `voucher_entry_id`; no separate party subledger table, canonical signed reconciliation, or settlement-entry lifecycle | `023`, `025`, `026` | Introduce `party_subledger_bills` keyed by `(business_id, voucher_entry_id)`, link `bill_allocations` to `source_bill_id`/`settlement_bill_id` (authoritative audit history with cached aggregates), and enforce signed `verify_subledger_control_tieout()`. |
| **C2** | **Critical** | Global `accounts.opening_balance` instead of per-FY `account_opening_balances`; FY close does not carry forward permanent accounts or snapshot open bills cleanly without double-counting | `020`, `024` | Introduce fully constrained `account_opening_balances` (unique per `(business, fy, account, branch, party, currency)`) + `fy_open_bill_snapshots` (composition only, zero extra GL posting) so permanent accounts carry forward while nominal accounts close to `3100 Retained Earnings`. |
| **C3** | **Critical** | Freight / packing recovery account classification conflict (`5310` Expense vs `4410` Income) in COA seed | `020` (COA seed) | Seed `4410 Freight & Packing Recovery` (Income) separately from `5310 Bardana & Packing Expense` (Expense) and `4400 Bank Charges Recovered` (Income); enforce immutable account classification. |
| **H1** | **High** | Incomplete foreign-currency settlement & no Realised/Unrealised FX Gain/Loss model distinguishing invoice currency vs. settlement currency | `022`, `026` | Track `invoice_currency_code`, `allocated_invoice_txn_amount`, `invoice_carrying_base_amount`, `settlement_currency_code`, `settlement_txn_amount`, `settlement_exchange_rate`, `settled_base_amount`, and `realised_fx_diff` on `bill_allocations`, supporting both USD-converted-to-INR and INR-against-USD paths. |
| **H2** | **High** | No 4-state Cheque/PDC lifecycle (`Received → Deposited → Cleared / Bounced`) or 3-entry bounce-reopen workflow | Missing (Stage 4B/6) | Add `cheque_instruments` + `bounce_cheque_tx()` posting 3 distinct entries (reverse dishonoured cheque, record bank charge expense, optional customer charge recovery) + append-only counter-allocation reopening the invoice. |
| **H3** | **High** | Conditional GST & Discount / Incidental Charges not yet parameterized (must not hardcode one GST treatment) | Missing (Stage 4) | Distinguish all 6 tax/discount cases (pre-supply discount, qualifying post-supply Sec 15(3)(b), commercial discount, rate diff, goods return, claims) and configurable freight/packing/brokerage rules. |
| **H4** | **High** | Textile job-work shrinkage tolerances and TDS (194C/194H/194Q) must be configurable compliance rules, not fixed constants | Missing (Stages 4–5) | Parameterize shrinkage tolerance by `(business, process, material)` and TDS by payee type, thresholds, PAN status (206AA), and credit/payment timing. |
| **H5** | **High** | Operational events & accounting events need explicit atomic bridge (Sales/Purchase/Returns → Stock + GST Snapshot + Party Subledger + GL) | Missing (Stage 4) | Implement Stage 4 orchestrators keeping stock movement, invoice confirmation, and financial posting as distinct, independently auditable records inside one transaction. |
| **M1** | **Medium** | `verify_trial_balance()` (`024`) sums only period `voucher_entries` and omits opening balances | `024` | Upgrade to full Trial Balance (`Opening + Period = Closing`) backed by `account_opening_balances`. |
| **M2** | **Medium** | Flat `accounts.sub_group TEXT` instead of recursive `account_groups` hierarchy | `020` | Add `account_groups (parent_group_id)` for Indian Schedule III / Tally-style Balance Sheet & P&L drill-down. |
| **M3** | **Medium** | Multi-line FX rounding (`₹0.01` base drift across lines) | `022`, `025` | Support explicit `5500 Round Off` / FX rounding allocation rule in multi-currency invoice orchestrators. |
| **M4** | **Medium** | No RELY opening-bill cutover import RPC reconciling open bills to party opening balances | Missing (Stage 4B) | Add idempotent `import_opening_bills_tx()` asserting `SUM(open bills per party) = party opening balance`. |
| **L1** | **Low** | No Maker-Checker approval workflow (`draft → pending_approval → posted`) | Missing (Stage 6) | Optional approval gate for high-value payments/credit notes without weakening posted immutability. |

---

## 3. Revised Implementation Order (10-Step Sequence)

| Order | Work | Priority | Status |
| :---: | :--- | :---: | :---: |
| **1** | Correct the Accounting Master Specification, Gap Analysis, and Test Strategy | Immediate | **Done (Rev 3 — ready for review)** |
| **2** | Finalise the party subledger / open-bill architecture (`C1`) | Critical | **Designed in Rev 3 — awaiting approval** |
| **3** | Finalise per-FY opening balances and carry-forward (`C2`) | Critical | **Designed in Rev 3 — awaiting approval** |
| **4** | Finalise the complete voucher-entry-to-party allocation relationship | Critical | **Designed in Rev 3 — awaiting approval** |
| **5** | Implement corrective migrations `027` onward on `feat/stage-3-accounting` | Critical | **On Hold (awaiting review)** |
| **6** | Expand adversarial accounting tests (including 2 consecutive FY closes + C1 compound cap) | Critical | **On Hold (awaiting review)** |
| **7** | Run full migration (`001`–HEAD) and regression testing + concurrency harness | Mandatory | **On Hold** |
| **8** | Complete PR #7 security & accounting review | Mandatory | **PR #7 Open** |
| **9** | Merge Stage 3 into `main` & sync docs | After approval | **On Hold** |
| **10** | Begin Stage 4 (ERP Operations: Sales, Purchases, Returns & Inventory-to-Accounting) | Next stage | **On Hold** |
