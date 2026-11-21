# Kala ERP — Accounting Test Strategy (Rev 3 — Kala Accounting Quality Gate)

> **Document Role:** Authoritative verification strategy defining the **Kala Accounting Quality Gate** (mandatory Stage 3 exit requirement and ongoing gate for Stages 4–8).  
> **Key Distinction:** Single-connection PostgreSQL tests (such as PGlite) validate SQL syntax, triggers, RLS, constraints, and sequential business rules, **but do NOT certify concurrency**. Genuine multi-connection PostgreSQL concurrency tests are required to certify locking, deadlock freedom, and race-condition safety.

---

## 1. Five-Layer Verification Architecture

| Layer | Execution Engine | What It Certifies | Status |
| :--- | :--- | :--- | :---: |
| **L1 — Schema, Trigger & Security Invariants** | PostgreSQL (`BEGIN ... ROLLBACK` SQL suites via PGlite / Postgres) | Post-immutability triggers, deferred balance triggers, composite FKs, single-reversal uniqueness, direct-write revocations, `anon`/internal-helper denials | **IN PROGRESS** (`stage3_accounting.sql`) |
| **L2 — Adversarial Accounting Business Rules** | PostgreSQL SQL suites | C1 control-account entry cap, C2 two-consecutive-FY carry-forward (FY 1 → FY 2 → FY 3), subledger-to-GL tie-out, FX settlements, 3-part cheque bounce, conditional GST matrix, configurable job-work & TDS rules | **IN PROGRESS** (Core) · **PLANNED** (C1/C2/GST/FX/Cheques) |
| **L3 — Genuine Multi-Connection Concurrency Certification** | Real PostgreSQL server with parallel sessions (`pg` pool / CI Postgres service) | Concurrent `allocate_bill_payment_tx` on same invoice/receipt (zero over-settlement, zero double-spend, zero deadlocks), concurrent `post_voucher_tx` vs `close_financial_year_tx` (`FOR SHARE` vs `FOR UPDATE`), concurrent `next_document_no()` uniqueness | **PLANNED** (Mandatory before production certification) |
| **L4 — Accounting Identity & Subledger Tie-Outs** | Automated SQL reconciliation RPCs | Trial Balance (`Opening + Period = Closing`, `SUM(DR) = SUM(CR)`), Balance Sheet (`Assets = Liabilities + Equity + Net Profit`), **Signed Subledger Control Tie-Out** (`Signed Opening + Signed Movements = Signed GL Control Closing`), Inventory-to-GL (`SUM(stock_ledger.value_delta) = 1200–1220`), GSTR-1/3B tie-out | **IN PROGRESS** (`verify_trial_balance`, `verify_inventory_integrity`) · **PLANNED** (`verify_subledger_control_tieout`, full BS/GST) |
| **L5 — Frontend Contract, Regressions & CI** | `npx tsc --noEmit`, `npm run build`, SQL regression suites, GitHub Actions CI | **TypeScript & Vite Build**: **IMPLEMENTED** (on `main`) / verified locally on PR #7 · **Existing Regression Suites (`isolation`, `stage1`, `stage2`)**: **IMPLEMENTED** (on `main`) · **GitHub Actions CI (`ci.yml`)**: **IMPLEMENTED** (on `main`; PR #7 CI checks must pass before merge) · **Stage 3 Suite (`stage3_accounting.sql`)**: **IN PROGRESS** (on open PR #7, not yet merged) | **Split** *(see breakdown)* |

---

## 2. Kala Accounting Quality Gate — Mandatory Test Matrix

### 2.1 Party Subledger & Control-Account Allocation Integrity (`C1`)
- [x] Same-party allocation (`Customer A` receipt → `Customer A` invoice) succeeds and persists `party_id` + `'INR'`.
- [x] Cross-party allocation (`Customer B` receipt → `Customer A` invoice) rejected at DB layer.
- [x] Party-less voucher (`party_id IS NULL`) rejected for bill allocation.
- [x] Wrong-side settlement (`SALES` ← `PAYMENT`) and backdated allocation (`allocation_date < voucher_date`) rejected.
- [x] Dual-side capacity guards reject invoice over-settlement and receipt double-spend with zero partial rows.
- [ ] **Compound Sales Voucher Cap (`₹19,025` total vs `₹11,025` receivable)**: Posting `DR Debtors ₹11,025 + DR COGS ₹8,000` creates a `party_subledger_bills` row for **`₹11,025.00`**; attempting to allocate `₹11,026.00` MUST fail.
- [ ] **Separate Agent Brokerage Voucher (`₹200` for `Agent R`)**: Customer A's receipt cannot allocate against Agent R's brokerage payable; Agent R's payment cannot allocate against Customer A's invoice.
- [ ] **Compound Mill Bill with TDS 194C (`₹2,100` gross, `₹40` TDS, `₹2,060` net mill payable)**: Allocatable payable cap is strictly **`₹2,060.00`**, not `₹2,100.00`.
- [ ] **Freight Recovery Classification Test**: Confirm `4410 Freight & Packing Recovery` is classified as `income` and `5310 Bardana & Packing Expense` as `expense`; confirm sales invoice freight recovery credits `4410`, never `5310`.
- [ ] **Automated Signed Subledger Control Tie-Out**: `verify_subledger_control_tieout()` asserts `Signed Opening Party Subledger + Period Signed Movements = Signed GL Control Closing Balance` AND `party_subledger_bills.allocated_* = SUM(bill_allocations)` after every posting, settlement, reversal, and FY carry-forward.
- [ ] **Opening Balance Uniqueness & Zero-Double-Counting Test**: Reject duplicate `(business_id, fy_id, account_id, branch_id, party_id, currency_code)` rows in `account_opening_balances`; confirm FY 2 `fy_open_bill_snapshots` reconciles to `account_opening_balances(FY 2)` with zero duplicate `voucher_entry_id` and zero double-counted receivables.

### 2.2 Multi-Year Opening Balances & Two Consecutive FY Closures (`C2`)
- [x] Opening balance edits blocked after an FY is locked.
- [x] Unbalanced opening balances block FY close.
- [ ] **Permanent vs. Nominal Distinction on FY 1 Close**:
  - `income` & `expense` accounts close to `₹0.00` in FY 2 (NOT carried forward).
  - Net Profit/Loss transfers accurately into `3100 Retained Earnings / Reserves`.
  - `asset`, `liability`, and `equity` closing balances (including updated `3100`) carry forward into `account_opening_balances(fy_id = FY2)` with `SUM(opening_base_debit) = SUM(opening_base_credit)`.
  - Open customer/supplier bills carry forward into FY 2 and `verify_subledger_control_tieout(FY2)` passes.
- [ ] **Two Consecutive FY Closures (FY 1 → FY 2 → FY 3)**:
  - Post FY 1 invoices/receipts/expenses → close FY 1 → verify FY 2 opening balances & open bills → settle FY 1 open invoice inside FY 2 + post new FY 2 profit/loss → close FY 2 → verify FY 3 opening balances (`3100 Retained Earnings = FY1 Profit + FY2 Profit`) and Balance Sheet equation (`Assets = Liabilities + Equity`) holds across all 3 years!

### 2.3 Foreign Currency & Realised / Unrealised FX
- [x] Unbalanced transaction-currency voucher rejected even when base currency rounds equal.
- [x] Multi-currency voucher (`USD 100 @ 83.50`) posts exact `base_total_amount = 8,350.00`.
- [ ] **Full FX Gain Settlement**: Export `$1,000 @ ₹83` (`₹83,000`) settled at `₹84.50` (`₹84,500`) posts `DR Bank ₹84,500 / CR Debtors ₹83,000 / CR Realised FX Gain ₹1,500` and closes BOTH `$0.00` txn remaining and `₹0.00` base remaining.
- [ ] **Partial Multi-Rate FX Settlements**: `$400 @ ₹84` (+₹400 gain) + `$600 @ ₹82` (-₹600 loss) closes invoice cleanly to `$0.00 / ₹0.00`.
- [ ] **Foreign-Currency Advance**: Adjusted at historical receipt rate with zero FX gain/loss.
- [ ] **Year-End Unrealised FX Revaluation**: Posts unrealised gain/loss at closing rate and auto-reverses on Day 1 of next FY.

### 2.4 Cheque / PDC Lifecycle & Bounce Reopen (Stage 4B)
- [ ] Lifecycle transitions enforce `Received → Deposited → Cleared` or `Received → Deposited → Bounced`.
- [ ] Uncleared cheque increases `1020 Cheques in Hand`, NOT `1010 Bank Account`.
- [ ] **3-Entry Cheque Bounce**: (1) `DR Debtors ₹10,000 / CR Cheques in Hand ₹10,000`, (2) `DR Bank Charges ₹590 / CR Bank ₹590`, (3) optional `DR Debtors ₹590 / CR Bank Charges Recovered ₹590` + append-only counter-allocation reopens original invoice remaining balance to `₹10,000`.

### 2.5 Conditional Indian GST, Configurable Job Work & RELY Migration (Stages 4–5)
- [ ] All 6 discount/return/claim cases (pre-supply Sec 15(3)(a), qualifying post-supply Sec 15(3)(b), commercial discount without GST reversal, rate diff, physical return, claims) verified.
- [ ] Configurable shrinkage tolerances (normal absorbed into lot cost vs. abnormal shortage debited) & configurable TDS 194C/194H/194Q (payee type, thresholds, missing-PAN 206AA).
- [ ] RELY cutover import: `SUM(imported open bills per party) = party opening balance`, `verify_opening_balances()` = `balanced`, `verify_inventory_integrity()` = `balanced`, idempotent replay produces zero duplicates.

### 2.6 Genuine Concurrency Certification Suite (Multi-Connection Postgres with Controlled Transaction Barriers)
- [ ] **Concurrent Receipt Double-Spend Race**: Two parallel Postgres sessions (synchronized via barrier) attempt to allocate `₹6,000` each from the same `₹10,000` receipt → exactly one succeeds, one fails with insufficient unallocated balance, zero deadlocks.
- [ ] **Concurrent Allocation Against Same Invoice**: Two parallel Postgres sessions attempt to allocate `₹7,000` each against an invoice with `₹10,000` remaining → exactly one succeeds, zero over-allocation, zero partial commit, zero deadlock, exact remaining balance `₹3,000`.
- [ ] **Concurrent Receipt Reversal vs. Allocation Race**: Session 1 runs `reverse_voucher_tx(receipt)` while Session 2 runs `allocate_bill_payment_tx(invoice, receipt)` → strict row-lock serialization guarantees they never both succeed (either allocation wins and reversal is rejected, or reversal wins and allocation is rejected).
- [ ] **Concurrent FY Close vs. Voucher Post Race**: Session 1 runs `close_financial_year_tx()` while Session 2 runs `post_voucher_tx()` in the same FY → strict serialization via `FOR UPDATE` / `FOR SHARE`; no voucher ever commits into a closed FY after closing profit is calculated.
- [ ] **Concurrent Stock Deduction & Invoice Confirmation**: Parallel confirmations against limited unreserved stock never drive `sets < reserved_sets`.
