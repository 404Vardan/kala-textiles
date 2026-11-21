# Kala ERP — Accounting Master Specification (Rev 3 — Tripta RELY Replacement Grade)

> **Document Role:** Authoritative functional and technical accounting specification for **Kala ERP**, engineered to replace legacy desktop textile accounting systems (including **Tripta RELY**) for Indian textile wholesalers, traders, fabric stockists, manufacturers, dyeing/printing mills, embroidery units, and agents—with particular focus on the **Surat textile market**.  
> **Repository Baseline Audited:** `404Vardan/kala-textiles` (`feat/stage-3-accounting` at `10a9b5d`, migrations `001`–`026`, `src/services/accounting.ts`, `src/types/index.ts`, `supabase/tests/stage3_accounting.sql`).  
> **Honesty Rule:** Every capability is explicitly labelled **IMPLEMENTED** (merged on `main`), **IN PROGRESS** (on open PR #7 `feat/stage-3-accounting`), **DESIGNED** (specified here, not yet migrated), or **PLANNED** (future stage).

---

## 1. Chart of Accounts & Account Hierarchy

### Status
- **IN PROGRESS (PR #7 `020`)**: Flat `accounts` table with `account_group IN ('asset','liability','equity','income','expense')`, `sub_group TEXT`, optional `party_id`, `opening_balance`, `is_system`, `guard_system_accounts()`, and 21 seeded Indian textile accounts.
- **DESIGNED (Target C1/C2 Architecture)**: Recursive `account_groups(parent_group_id)` tree for Schedule III / Tally-style Balance Sheet & P&L drill-down, `account_sub_ledger_type ('NONE'|'PARTY'|'BANK'|'CASH'|'TAX'|'INVENTORY')`, separate **Party Subledger (`party_subledger_bills`)**, and per-FY **`account_opening_balances`**.

### Standard Indian Textile Chart of Accounts Hierarchy

| Root Group | Account Nature | FY Close Behaviour | Key Textile Control & Ledger Accounts |
| :--- | :--- | :--- | :--- |
| **Asset** (`1xxx`) | Permanent (Real) | **Carry Forward** | `1000 Cash in Hand`, `1010 Bank Account`, `1020 Cheques in Hand (Uncleared/PDC)`, `1100 Sundry Debtors (Control)`, `1200 Grey Fabric Inventory`, `1210 Work-in-Progress (At Mills)`, `1220 Finished Goods Inventory`, `1300 Input CGST`, `1310 Input SGST`, `1320 Input IGST`, `1330 Input Cess`, `1400 TDS Receivable` |
| **Liability** (`2xxx`) | Permanent (Real) | **Carry Forward** | `2000 Sundry Creditors (Control)`, `2010 Mill / Job-Worker Payables (Control)`, `2020 Agent Brokerage Payable (Control)`, `2030 Customer Advances`, `2040 Cheques Issued (Uncleared/PDC)`, `2100 Output CGST`, `2110 Output SGST`, `2120 Output IGST`, `2130 Output Cess`, `2200 TDS Payable (194C/194H/194Q)` |
| **Equity** (`3xxx`) | Permanent (Real) | **Carry Forward** *(Retained Earnings absorbs Net P&L)* | `3000 Owner / Partner Capital`, `3100 Retained Earnings / Reserves`, `3200 Partner Drawings` |
| **Income** (`4xxx`) | Nominal | **Close to P&L (Zeroed)** | `4000 Wholesale Sales`, `4010 Export Sales`, `4100 Sales Returns / Rate Diff (DR)`, `4200 Cash Discount Received`, `4300 Realised Foreign Exchange Gain`, `4310 Unrealised Foreign Exchange Gain`, `4400 Bank Charges Recovered`, `4410 Freight & Packing Recovery`, `4450 Scrap / Cut-Piece Sales` |
| **Expense** (`5xxx`) | Nominal | **Close to P&L (Zeroed)** | `5000 Grey/Finished Purchases`, `5010 Purchase Returns (CR)`, `5100 Cost of Goods Sold (COGS)`, `5200 Job Work & Mill Processing`, `5250 Abnormal Mill Shortage / Wastage`, `5300 Freight & Forwarding Expense (LR)`, `5310 Bardana & Packing Expense`, `5400 Discount Allowed`, `5450 Agent Brokerage / Adat`, `5500 Round Off`, `5600 Bank & Cheque Bounce Charges`, `5700 Realised Foreign Exchange Loss`, `5710 Unrealised Foreign Exchange Loss` |

> **Classification Rule:** Every account has a single permanent financial-statement classification (`asset`, `liability`, `equity`, `income`, `expense`). Freight/packing recovered from customers MUST credit `4410 Freight & Packing Recovery` (Income)—never `5310 Bardana & Packing Expense` (Expense). An account's classification never changes based on whether it is debited or credited.

---

## 2. Double-Entry Bookkeeping & Core Architectural Principles

1. **Dual-Currency Balance (`IN PROGRESS` `021`/`025`)**: Every posted voucher MUST satisfy BOTH `SUM(debit) = SUM(credit) > 0` (transaction currency) AND `SUM(base_debit) = SUM(base_credit) > 0` (base currency `INR`), enforced by `post_voucher_tx()` and deferred `CONSTRAINT TRIGGER`.
2. **Absolute Post-Immutability (`IN PROGRESS` `021`)**: Posted `vouchers` and `voucher_entries` can never be updated or deleted; corrections use separate `REVERSAL` vouchers (protected by `uq_vouchers_single_reversal`) or GST Credit/Debit Notes.
3. **Separation of General Ledger & Party Subledgers (`DESIGNED — C1`)**:
   - The General Ledger holds **control accounts** (`1100 Sundry Debtors`, `2000 Sundry Creditors`, `2010 Mill Payables`, `2020 Agent Brokerage Payable`) rather than cluttering the COA with thousands of party accounts.
   - Individual customer, supplier, mill, and agent balances live in the **Party Subledger (`party_subledger_bills`)** linked directly to the exact control-account `voucher_entry_id`.
   - Automated reconciliation (`verify_subledger_control_tieout()`) MUST prove at all times:
     - `SUM(Customer Subledger) = GL 1100 Sundry Debtors`
     - `SUM(Supplier Subledger) = GL 2000 Sundry Creditors`
     - `SUM(Mill Subledger) = GL 2010 Mill Payables`
     - `SUM(Agent Subledger) = GL 2020 Agent Brokerage Payable`
4. **Separation of Operational Events & Accounting Events (`DESIGNED`)**:
   - Confirming a sales invoice executes atomically inside **one** PostgreSQL transaction, yet records **independently auditable domain records**: (1) Sales document confirmation, (2) `stock_ledger` deduction, (3) COGS recognition, (4) immutable `invoice_tax_snapshots`, (5) `party_subledger_bills` receivable creation, (6) GL `vouchers` + `voucher_entries`, and (7) `audit_events`.
5. **Financial Year Serialization (`IN PROGRESS` `014`/`024`/`025`)**: Posting RPCs acquire `FOR SHARE` on `financial_years`, strictly serializing against `close_financial_year_tx()` (`FOR UPDATE`).

---

## 3. Target Architecture for C1 (Open-Bill / Party Subledger) & C2 (Per-FY Opening Balances)

### 3.1 C1 — Party Subledger, Signed Balance Convention & Settlement Lifecycle (`DESIGNED`)

**Core Rule:** A voucher's `base_total_amount` is **never** used as the allocatable bill amount. Every party-affecting line on a control account (`1100`, `2000`, `2010`, `2020`, `2030`, `1450`) creates a `party_subledger_bills` record tied directly to that exact **`voucher_entry_id`**:

```sql
-- Target Design (Not Yet Migrated)
party_subledger_bills (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id            BIGINT NOT NULL,
  branch_id              BIGINT NOT NULL,
  origin_fy_id           BIGINT NOT NULL,         -- FY in which the bill/settlement originated (long-lived across FYs)
  voucher_id             BIGINT NOT NULL,
  voucher_entry_id       BIGINT NOT NULL,         -- Exact control-account line (UNIQUE per business)
  account_id             BIGINT NOT NULL,         -- Control account (1100 Debtors, 2000 Creditors, 2010 Mill, 2020 Agent)
  party_id               BIGINT NOT NULL,         -- Composite FK -> parties(business_id, id)
  bill_role              TEXT NOT NULL,           -- 'RECEIVABLE_BILL', 'PAYABLE_BILL', 'RECEIVABLE_SETTLEMENT', 'PAYABLE_SETTLEMENT', 'ADVANCE_RECEIVED', 'ADVANCE_PAID'
  normal_side            TEXT NOT NULL CHECK (normal_side IN ('DR','CR')),
  bill_no                TEXT NOT NULL,
  document_date          DATE NOT NULL,
  due_date               DATE NULL,
  currency_code          CHAR(3) NOT NULL DEFAULT 'INR',
  exchange_rate          NUMERIC(14,6) NOT NULL DEFAULT 1.0,
  original_txn_amount    NUMERIC(14,2) NOT NULL CHECK (original_txn_amount > 0),
  original_base_amount   NUMERIC(14,2) NOT NULL CHECK (original_base_amount > 0),
  allocated_txn_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (allocated_txn_amount >= 0 AND allocated_txn_amount <= original_txn_amount),
  allocated_base_amount  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (allocated_base_amount >= 0 AND allocated_base_amount <= original_base_amount),
  remaining_txn_amount   NUMERIC(14,2) GENERATED ALWAYS AS (original_txn_amount - allocated_txn_amount) STORED,
  remaining_base_amount  NUMERIC(14,2) GENERATED ALWAYS AS (original_base_amount - allocated_base_amount) STORED,
  status                 TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_settled','settled','reversed')),
  UNIQUE (business_id, voucher_entry_id)
)
```

#### Canonical Signed Balance Convention & GL Control Reconciliation
Positive amounts on individual bills reconcile to signed GL balances using `signed_balance = SUM(base_debit) - SUM(base_credit)` (`+` = Debit balance, `-` = Credit balance):

| Subledger Transaction Type | Control Account | Normal GL Side | Signed Effect (`DR - CR`) |
| :--- | :--- | :---: | :---: |
| Customer Invoice (`RECEIVABLE_BILL`) | `1100 Sundry Debtors` | DR | `+amount` |
| Customer Receipt / Credit Note (`RECEIVABLE_SETTLEMENT`) | `1100 Sundry Debtors` | CR | `-amount` |
| Customer Advance (`ADVANCE_RECEIVED`) | `2030 Customer Advances` (or `1100`) | CR | `-amount` |
| Supplier / Mill Invoice (`PAYABLE_BILL`) | `2000 Creditors` / `2010 Mill` | CR | `-amount` |
| Supplier Payment / Purchase Return DN (`PAYABLE_SETTLEMENT`) | `2000 Creditors` / `2010 Mill` | DR | `+amount` |
| Supplier Advance (`ADVANCE_PAID`) | `1450 Supplier Advances` (or `2000`) | DR | `+amount` |
| Reversal Voucher | Same control account | Opposite | Exact negation of original |
| FX Revaluation / Realised FX | Same control account | DR or CR | Signed carrying-value adjustment |

**Canonical Reconciliation Equation** (enforced per `(business_id, fy_id, control_account_id)` by `verify_subledger_control_tieout()`):
> `Signed Opening Party Subledger + Period Signed Subledger Movements (Bills + Settlements + Advances + CN/DN + Reversals + FX Adjustments) = Signed GL Control Account Closing Balance (Opening + Period DR − Period CR)`

#### Complete Settlement Record Lifecycle (`voucher → voucher_entry → party_subledger_bills → bill_allocations`)
1. **Creation**: When Customer A pays `₹5,000` (`DR 1010 Bank ₹5,000 / CR 1100 Sundry Debtors ₹5,000`), the **`CR 1100 Sundry Debtors` `voucher_entry`** (NOT the Bank/Cash entry!) creates a `party_subledger_bills` row with `bill_role = 'RECEIVABLE_SETTLEMENT'`, `normal_side = 'CR'`, `original_base_amount = 5000.00`.
2. **Allocation Reference**: `bill_allocations` links `source_bill_id` (`DR 1100 RECEIVABLE_BILL`) and `settlement_bill_id` (`CR 1100 RECEIVABLE_SETTLEMENT`), enforcing same `business_id`, same `party_id`, same `account_id`, compatible settlement direction, and compatible currency / explicit FX conversion.
3. **Authoritative Audit History vs. Cached Aggregates**: Immutable `bill_allocations` rows are the **authoritative audit history**. `allocated_*` / `remaining_*` columns on `party_subledger_bills` are transactionally maintained cached aggregates under dual-side `ORDER BY id ASC FOR UPDATE` locks, and are independently verified against `SUM(bill_allocations)` in `verify_subledger_control_tieout()`.
4. **1:N and N:1 Allocations**: One receipt can allocate across multiple invoices, and one invoice can be settled by multiple receipts/credit notes via M:N rows in `bill_allocations`.
5. **Reversal of Settlement**: `reverse_voucher_tx()` is blocked while active `bill_allocations` reference the settlement; for cheque bounce, an explicit append-only counter-allocation reopens the invoice before/with the dishonour entry.

### 3.2 C2 — Per-Financial-Year Opening Balances & Zero-Double-Counting Carry-Forward (`DESIGNED`)

Replacing the single global `accounts.opening_balance` column with per-FY `public.account_opening_balances`:

```sql
-- Target Design (Not Yet Migrated)
-- Grain: One row per (business_id, fy_id, account_id, COALESCE(branch_id, 0), COALESCE(party_id, 0), currency_code)
account_opening_balances (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id         BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  fy_id               BIGINT NOT NULL,
  account_id          BIGINT NOT NULL,
  branch_id           BIGINT NULL,
  party_id            BIGINT NULL,
  currency_code       CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency_code ~ '^[A-Z]{3}$'),
  opening_txn_debit   NUMERIC(14,2) NOT NULL DEFAULT 0,
  opening_txn_credit  NUMERIC(14,2) NOT NULL DEFAULT 0,
  opening_base_debit  NUMERIC(14,2) NOT NULL DEFAULT 0,
  opening_base_credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  source_type         TEXT NOT NULL CHECK (source_type IN ('MANUAL','FY_CARRY_FORWARD','RELY_MIGRATION')),
  source_fy_id        BIGINT NULL,
  source_ref          TEXT NULL,
  created_by          UUID NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT aob_txn_dc_check CHECK (
    opening_txn_debit >= 0 AND opening_txn_credit >= 0
    AND NOT (opening_txn_debit > 0 AND opening_txn_credit > 0)
  ),
  CONSTRAINT aob_base_dc_check CHECK (
    opening_base_debit >= 0 AND opening_base_credit >= 0
    AND NOT (opening_base_debit > 0 AND opening_base_credit > 0)
  ),
  CONSTRAINT aob_source_fy_check CHECK (
    (source_type = 'FY_CARRY_FORWARD' AND source_fy_id IS NOT NULL AND source_fy_id <> fy_id)
    OR (source_type <> 'FY_CARRY_FORWARD' AND source_fy_id IS NULL)
  ),
  FOREIGN KEY (business_id, fy_id) REFERENCES public.financial_years(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, account_id) REFERENCES public.accounts(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, branch_id) REFERENCES public.branches(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, party_id) REFERENCES public.parties(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, source_fy_id) REFERENCES public.financial_years(business_id, id) ON DELETE RESTRICT
)
```
- **Uniqueness & Immutability**: Unique index on `(business_id, fy_id, account_id, COALESCE(branch_id, 0), COALESCE(party_id, 0), currency_code)`; locked against `UPDATE`/`DELETE` once `fy.is_locked = TRUE` or once vouchers are posted in `fy_id`.

#### Zero-Double-Counting Open-Bill Carry-Forward Identity
- **`account_opening_balances`** is the **sole GL opening position** for FY 2.
- **`party_subledger_bills`** records are **long-lived across financial years** (keeping their original `origin_fy_id` and `UNIQUE (business_id, voucher_entry_id)`—never duplicated as a second GL posting!).
- At FY close, an immutable snapshot table **`fy_open_bill_snapshots (business_id, fy_id, bill_id, account_id, party_id, carried_txn_amount, carried_base_amount)`** records the exact open-bill composition at FY 2 start without creating any new GL entry, and `close_financial_year_tx()` asserts:
  1. **Nominal accounts (`income`, `expense`)** close to `₹0.00` (net profit/loss transferred to `3100 Retained Earnings / Reserves`) and are **not** carried forward.
  2. **Permanent accounts (`asset`, `liability`, `equity` including `3100`)** carry forward exact signed closing balances into `account_opening_balances(fy_id = next_fy_id)`.
  3. `SUM(fy_open_bill_snapshots for FY 2, per control_account)` = `account_opening_balances(FY 2, control_account)` AND `SUM(next_fy opening_base_debit) = SUM(next_fy opening_base_credit)`.

---

## 4. Detailed Workflow Specifications (With Exact Surat Textile Accounting Entries)

### Workflow 4.1: Wholesale Credit Sale (Intra-State Gujarat — 5% GST + Freight + Perpetual COGS) + Separate Agent Brokerage Accrual
- **Status**: Core `post_voucher_tx` **IN PROGRESS** (`022`/`026`); unified `confirm_sales_invoice_tx` **DESIGNED** (Stage 4).
- **Preconditions**: Open FY, branch Gujarat (`24`), `Customer A` (Gujarat `24`), 10 sets in `SHOP` @ MWAC `₹800/set` (`₹8,000` COGS), rate `₹1,000/set` (`₹10,000`), Bardana/Freight `₹500` (composite supply taxed at principal rate when configured as taxable incidental charge), 5% GST (`₹262.50 CGST + ₹262.50 SGST`). Separate Agent `Agent R` earns `2%` brokerage (`₹200`) on net sales `₹10,000`.
- **Important Party Separation**: Because `Customer A` and `Agent R` are **different counterparties**, the Sales Invoice voucher (`₹19,025` total, `₹11,025` Customer A receivable) and the Agent Brokerage accrual (`₹200` Agent R payable) are posted as **two linked vouchers** inside the same atomic transaction!
- **Voucher 1 — Sales Invoice + Perpetual COGS (`INV-2026-001`, `party_id = Customer A`)**:

| Account | Party | Debit (₹) | Credit (₹) | Creates Open Bill? |
| :--- | :--- | ---: | ---: | :--- |
| `1100 Sundry Debtors` | Customer A | 11,025.00 | — | **Yes (`RECEIVABLE_BILL = ₹11,025.00`)** |
| `4000 Wholesale Sales` | — | — | 10,000.00 | No |
| `4410 Freight & Packing Recovery` | — | — | 500.00 | No |
| `2100 Output CGST (2.5%)` | — | — | 262.50 | No |
| `2110 Output SGST (2.5%)` | — | — | 262.50 | No |
| `5100 Cost of Goods Sold (COGS)` | — | 8,000.00 | — | No |
| `1220 Finished Goods Inventory` | — | — | 8,000.00 | No |
| **Voucher 1 Totals** | | **19,025.00** | **19,025.00** | **Allocatable Cap = `₹11,025.00`** |

- **Voucher 2 — Agent Brokerage & Statutory TDS Lifecycle (`Agent R`)**:
  1. **Accrual (`JRN-BRK-001`)**: `DR 5450 Agent Brokerage / Adat ₹200.00` / `CR 2020 Agent Brokerage Payable (Agent R) ₹200.00` (`PAYABLE_BILL = ₹200.00`).
  2. **Statutory TDS u/s 194H** *(when statutory threshold & payee conditions apply — determined by applicable Income Tax rules, PAN/206AA status, and credit-vs-payment timing)*: `DR 2020 Agent Brokerage Payable (Agent R) ₹10.00` / `CR 2200 TDS Payable — 194H ₹10.00` (reducing net agent payable to `₹190.00`).
  3. **Agent Payment**: `DR 2020 Agent Brokerage Payable (Agent R) ₹190.00` / `CR 1010 Bank Account ₹190.00`.
  4. **Government TDS Remittance**: `DR 2200 TDS Payable — 194H ₹10.00` / `CR 1010 Bank Account ₹10.00`.
  5. **Brokerage Reversal/Adjustment**: On sales return/credit note, post proportional `DR 2020 Agent Brokerage Payable / CR 5450 Agent Brokerage` adjustment.

- **Inventory Consequences**: `stock_ledger` appends `DISPATCH -10 SET @ ₹800` (`value_delta = -8000.00`).
- **GST Consequences**: Frozen in `invoice_tax_snapshots` for GSTR-1 Table 4A & GSTR-3B Table 3.1(a).
- **Outstanding-Balance Consequences**: `Customer A` receivable = `₹11,025.00` (strictly capped by `voucher_entry_id` on `1100`, NEVER `₹19,025.00`); `Agent R` payable = `₹200.00`.

---

### Workflow 4.2: Grey Fabric Purchase (Inter-State — 5% IGST + Serialized Takas)
- **Status**: `receive_taka_lot_tx` **IMPLEMENTED** (`017`/`019`); `confirm_purchase_bill_tx` **DESIGNED** (Stage 4).
- **Entries**: 100 m grey fabric (`48m`, `52m`) @ `₹80/m` (`₹8,000`) + Freight `₹400` capitalized into landed cost (`₹84/m`) + 5% IGST (`₹420`):
  - `DR 1200 Grey Fabric Inventory ₹8,400.00`, `DR 1320 Input IGST ₹420.00` / `CR 2000 Sundry Creditors (Bhiwandi Mills) ₹8,820.00` (`PAYABLE_BILL = ₹8,820.00`).

---

### Workflow 4.3: Surat Dyeing / Printing / Embroidery Job Work (Configurable Shrinkage & Statutory TDS)
- **Status**: **PLANNED** (Stage 5).
- **Configurable Compliance Rules (Never Hardcoded)**:
  - **Shrinkage / Wastage Tolerance**: Configurable per `(business_id, process_type, fabric_category)` (e.g. dyeing vs. printing vs. embroidery). Normal loss within configured tolerance is absorbed into finished lot landed cost; excess **abnormal shortage** is debited to `5250 Abnormal Mill Shortage` or recovered via Mill Debit Note.
  - **TDS u/s 194C**: Evaluated dynamically against configurable statutory rules—payee classification (Individual/HUF 1% vs. Company/Firm 2%), single-bill (`₹30,000`) / annual aggregate (`₹1,00,000`) thresholds, PAN availability (20% u/s 206AA if missing), and credit-vs-payment timing.
  - **Explicit Quantity & Valuation Reconciliation Rules**:
  - **Physical Quantity Reconciliation**: `Input Grey Qty = Finished Good Qty + Normal Process Loss + Abnormal Shortage + Recoverable Mill Shortage`.
  - **Financial Valuation Reconciliation**: `Input WIP Value + Capitalized Mill Processing Cost = Finished Lot Inventory Value (absorbs normal process loss) + Abnormal Wastage Expense (5250) + Recoverable Mill Claim (2010 Debit Note)` — ensuring both meters and rupees reconcile to `₹0.00`!
- **Illustrative Entries (100 m Grey `₹8,400` → 96 m Finished within configured policy; Mill Bill `₹2,000` + 5% GST `₹100`; assuming statutory 194C @ 2% = `₹40` applies)**:
  - **Issue (`JOB_OUT`)**: `DR 1210 WIP at Mills ₹8,400` / `CR 1200 Grey Fabric ₹8,400`.
  - **Receipt + Mill Bill (`JOB_IN`)**:

| Account | Party | Debit (₹) | Credit (₹) | Open Bill Impact |
| :--- | :--- | ---: | ---: | :--- |
| `1220 Finished Goods Inventory` (96 m @ `₹108.3333`) | — | 10,400.00 | — | No |
| `1300 Input CGST (2.5%)` | — | 50.00 | — | No |
| `1310 Input SGST (2.5%)` | — | 50.00 | — | No |
| `1210 Work-in-Progress (At Mills)` | — | — | 8,400.00 | No |
| `2010 Mill / Job-Worker Payables` | Shreeji Dyeing Mill | — | 2,060.00 | **`PAYABLE_BILL = ₹2,060.00`** (net of TDS!) |
| `2200 TDS Payable — 194C` | — | — | 40.00 | No |
| **Totals** | | **10,500.00** | **10,500.00** | **Allocatable Cap = `₹2,060.00`** |

---

### Workflow 4.4: Discounts, Returns, Claims & Conditional Indian GST Treatment
- **Status**: **DESIGNED** (Stage 4).
- **Mandatory Tax-Engine Distinctions (Never Hardcoded to One Rule)**:

| Scenario | GST Treatment (CGST Act Section 15) | Inventory Impact | Accounting Entry Pattern |
| :--- | :--- | :--- | :--- |
| **1. Discount before or at supply** | Deducted on invoice before GST (`Sec 15(3)(a)`) | None | Net taxable value booked directly on `SALES` invoice |
| **2. Qualifying post-supply discount** | Pre-agreed & buyer reverses ITC (`Sec 15(3)(b)`) → **GST Credit Note** (reduces Output GST) | None | `DR 5400 Discount Allowed`, `DR Output GST` / `CR 1100 Debtors (Party)` |
| **3. Commercial / financial discount** | Conditions of `Sec 15(3)(b)` NOT met → **Commercial Credit Note** (NO GST reversal) | None | `DR 5400 Discount Allowed` / `CR 1100 Debtors (Party)` |
| **4. Rate difference / price claim** | GST Credit/Debit Note adjusting taxable value + GST where statutory rules apply | None | `DR 4100 Sales Returns / Rate Diff`, `DR Output GST` / `CR 1100 Debtors (Party)` |
| **5. Physical goods return** | GST Credit Note (GSTR-1 Table 9B CDNR) | `RETURN_IN` at original frozen COGS | `DR 4100 Sales Returns`, `DR Output GST` / `CR 1100 Debtors` + `DR 1220 Inventory / CR 5100 COGS` |
| **6. Incidental charges (freight/packing)** | Configurable per business/contract (`Sec 15(2)(c)` composite supply vs. pure-agent reimbursement) | Capitalized on purchase if landed cost | Determined by `tax_categories` & invoice tax rules |

---

### Workflow 4.5: Cheque / PDC Lifecycle, Cheque Bounce & Bank Reconciliation (BRS)
- **Status**: **PLANNED** (Stage 4B / Stage 6).
- **Strict 4-State Lifecycle**: **`Received → Deposited → Cleared / Bounced`**
  - An uncleared cheque sits in `1020 Cheques in Hand` and is **never** treated as cleared bank money (`1010 Bank Account`).
  - **Invoice Settlement Rule**: Receiving a cheque creates a *provisional* allocation marked `instrument_status = 'pending'` (so the party isn't double-chased while clearing). On **Cleared**, settlement becomes final. On **Bounced**, the system executes an append-only **counter-allocation** that reopens the original invoice's `remaining_amount`!
- **Exact 3-Part Cheque Bounce Accounting (₹10,000 cheque bounced + ₹590 bank charge)**:
  1. **Reverse dishonoured cheque receipt** (reopens Customer A's invoice via counter-allocation):
     - `DR 1100 Sundry Debtors (Customer A) ₹10,000.00` / `CR 1020 Cheques in Hand ₹10,000.00`
  2. **Record bank's bounce charge expense**:
     - `DR 5600 Bank & Cheque Bounce Charges ₹590.00` / `CR 1010 Bank Account ₹590.00`
  3. **Recover bounce charge from customer (optional per business policy)**:
     - `DR 1100 Sundry Debtors (Customer A) ₹590.00` (`RECEIVABLE_BILL = ₹590.00`) / `CR 4400 Bank Charges Recovered ₹590.00`

---

### Workflow 4.6: Foreign Currency Model, Partial FX Settlements & Realised/Unrealised FX Gain/Loss
- **Status**: Multi-currency voucher posting **IN PROGRESS** (`022`/`025`); FX settlement & revaluation **DESIGNED** (Stage 4B).
- **How Settlement Works with Dual-Currency Voucher Constraints**:
  - **Export Invoice (`INV-EXP-001`)**: Posted in `USD` (`exchange_rate = 83.00`): `$1,000` (`₹83,000` carrying value). `party_subledger_bills` stores `currency_code = 'USD'`, `original_txn_amount = 1000.00`, `original_base_amount = 83000.00`.
  - **Receipt Voucher (`RCP-EXP-001`)**: Bank receives `₹84,500` in INR (`$1,000 @ ₹84.50`). Because the bank credits INR and FX Gain is an INR P&L account, the settlement voucher is posted in **base currency (`INR`, `exchange_rate = 1.0`)**:

| Account | Party | Debit (₹) | Credit (₹) |
| :--- | :--- | ---: | ---: |
| `1010 Bank Account` | — | 84,500.00 | — |
| `1100 Sundry Debtors` | Overseas Buyer | — | 83,000.00 |
| `4300 Realised Foreign Exchange Gain` | — | — | 1,500.00 |
| **Totals** | | **84,500.00** | **84,500.00** |

  - **Consistent Allocation Record (Invoice Currency vs. Settlement Currency)**: `bill_allocations` explicitly distinguishes all 7 currency/value fields:
    - `invoice_currency_code` (`USD`), `allocated_invoice_txn_amount` (`$1,000.00`), `invoice_carrying_base_amount` (`₹83,000.00`),
    - `settlement_currency_code` (`USD` if wire received in USD & converted by bank, OR `INR` if buyer remitted INR directly against USD invoice), `settlement_txn_amount` (`$1,000.00` or `₹84,500.00`), `settlement_exchange_rate` (`84.50` or `1.0`), `settled_base_amount` (`₹84,500.00`), and `realised_fx_diff` (`+₹1,500.00`).
    - Both paths (**USD received & converted to INR** and **INR received against a USD invoice**) preserve exact audit trails while updating `party_subledger_bills` so BOTH `remaining_txn_amount = $0.00` AND `remaining_base_amount = ₹0.00` stay 100% consistent!
- **Partial FX Settlements & Multiple Rates**: Settling `$400 @ ₹84.00` (`₹33,600` vs carrying `400 × 83 = ₹33,200` → `+₹400` FX gain) leaves `$600` (`₹49,800` carrying value) open; a second receipt of `$600 @ ₹82.00` (`₹49,200` vs carrying `₹49,800` → `-₹600` FX loss) closes the invoice cleanly to `$0.00` / `₹0.00`.
- **Foreign-Currency Advances**: Booked in `2030 Customer Advances` at receipt-date rate; adjusted against future invoice at advance's historical rate (no FX gain/loss on non-monetary advance under AS 11 / Ind AS 21!).
- **Year-End Revaluation (Unrealised FX)**: Open monetary foreign-currency receivables/payables at FY end are revalued at closing RBI/FEDAI rate into `4310 Unrealised FX Gain` / `5710 Unrealised FX Loss` (auto-reversed on Day 1 of next FY).

---

## 5. Multi-Company, Multi-Branch, Cost Centres & RELY Migration

- **Multi-Company & Multi-Branch**: Implemented in Stage 1 (`011`–`014`) with fail-closed `x-business-id` isolation and branch-scoped `document_counters`.
- **RELY Migration Cutover (`DESIGNED`)**:
  1. Import Masters (Parties with GSTIN/station/agent, Products/HSN/UOM, COA mapping).
  2. Import Opening Stock (SET MWAC + open TAKAs) → assert `verify_inventory_integrity()`.
  3. Import per-FY Opening Balances into `account_opening_balances(fy_id, source_type = 'RELY_MIGRATION')` → assert `SUM(DR) = SUM(CR)`.
  4. Import every open RELY invoice into `party_subledger_bills` (`source_type = 'RELY_MIGRATION'`) → assert `verify_subledger_control_tieout()` (`SUM(open bills per party) = party opening balance`).
  5. Run 7–14 day parallel reconciliation with zero variance before final cutover.
