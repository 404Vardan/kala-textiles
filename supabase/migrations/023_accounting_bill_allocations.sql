-- ====================================================================
-- Migration 023: Stage 3 Kala Finance — Dual-Locked Bill Allocations
-- Prerequisite:  022_accounting_voucher_rpcs.sql
-- ====================================================================

BEGIN;

-- --------------------------------------------------------------------
-- SECTION 1: Append-Only bill_allocations Table
-- Direct client writes revoked; mutated strictly via allocate_bill_payment_tx().
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.bill_allocations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  invoice_voucher_id BIGINT NOT NULL,
  settlement_voucher_id BIGINT NOT NULL,
  allocated_amount NUMERIC(14, 2) NOT NULL CHECK (allocated_amount > 0),
  allocation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  idempotency_key UUID,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bill_allocations_distinct_check CHECK (invoice_voucher_id <> settlement_voucher_id),
  CONSTRAINT bill_allocations_business_invoice_fkey FOREIGN KEY (business_id, invoice_voucher_id)
    REFERENCES public.vouchers (business_id, id) ON DELETE RESTRICT,
  CONSTRAINT bill_allocations_business_settlement_fkey FOREIGN KEY (business_id, settlement_voucher_id)
    REFERENCES public.vouchers (business_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_bill_allocations_invoice
  ON public.bill_allocations (business_id, invoice_voucher_id);

CREATE INDEX IF NOT EXISTS idx_bill_allocations_settlement
  ON public.bill_allocations (business_id, settlement_voucher_id);

CREATE OR REPLACE FUNCTION public.guard_bill_allocations_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'bill_allocations is strictly append-only; allocations cannot be updated or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_bill_allocations_immutable ON public.bill_allocations;
CREATE TRIGGER trg_guard_bill_allocations_immutable
  BEFORE UPDATE OR DELETE ON public.bill_allocations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_bill_allocations_immutable();

ALTER TABLE public.bill_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bill_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.bill_allocations TO authenticated;

DROP POLICY IF EXISTS "members_select_bill_allocations" ON public.bill_allocations;
CREATE POLICY "members_select_bill_allocations" ON public.bill_allocations
  FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

-- --------------------------------------------------------------------
-- SECTION 2: allocate_bill_payment_tx()
-- Locks BOTH invoice_voucher_id and settlement_voucher_id in deterministic
-- ORDER BY id ASC FOR UPDATE to prevent concurrent over-settlement or
-- double-spending of receipts/payments.
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.allocate_bill_payment_tx(
  p_business_id BIGINT,
  p_invoice_voucher_id BIGINT,
  p_settlement_voucher_id BIGINT,
  p_allocated_amount NUMERIC,
  p_allocation_date DATE DEFAULT CURRENT_DATE,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_active_biz BIGINT;
  v_req_hash TEXT;
  v_claim JSONB;
  v_fy_id BIGINT;
  v_inv public.vouchers%ROWTYPE;
  v_set public.vouchers%ROWTYPE;
  v_inv_allocated NUMERIC(14, 2);
  v_set_allocated NUMERIC(14, 2);
  v_alloc_id BIGINT;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_active_biz := public.current_business_id();
  IF p_business_id IS NULL OR v_active_biz IS NULL OR p_business_id <> v_active_biz THEN
    RAISE EXCEPTION 'Unauthorized: active business context does not match requested business %', p_business_id;
  END IF;

  IF NOT public.has_permission(p_business_id, 'vouchers.post') THEN
    RAISE EXCEPTION 'Unauthorized: missing vouchers.post permission for business %', p_business_id;
  END IF;

  IF p_invoice_voucher_id IS NULL OR p_settlement_voucher_id IS NULL OR p_invoice_voucher_id = p_settlement_voucher_id THEN
    RAISE EXCEPTION 'Distinct invoice_voucher_id and settlement_voucher_id are required';
  END IF;

  IF p_allocated_amount IS NULL OR p_allocated_amount <= 0 THEN
    RAISE EXCEPTION 'allocated_amount must be greater than zero';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    v_req_hash := md5(
      p_invoice_voucher_id::TEXT || ':' || p_settlement_voucher_id::TEXT || ':' ||
      p_allocated_amount::TEXT || ':' || p_allocation_date::TEXT
    );
    v_claim := public.claim_idempotency_key(p_business_id, p_idempotency_key, 'ALLOCATE_BILL', v_req_hash);
    IF (v_claim->>'is_replay')::BOOLEAN IS TRUE THEN
      RETURN v_claim->'response';
    END IF;
  END IF;

  v_fy_id := public.assert_financial_year_open(p_business_id, p_allocation_date);

  -- Dual-side deterministic row lock (deadlock-free)
  PERFORM 1
  FROM public.vouchers v
  WHERE v.business_id = p_business_id
    AND v.id IN (p_invoice_voucher_id, p_settlement_voucher_id)
  ORDER BY v.id ASC
  FOR UPDATE;

  SELECT * INTO v_inv
  FROM public.vouchers
  WHERE id = p_invoice_voucher_id AND business_id = p_business_id;

  SELECT * INTO v_set
  FROM public.vouchers
  WHERE id = p_settlement_voucher_id AND business_id = p_business_id;

  IF v_inv.id IS NULL OR v_set.id IS NULL THEN
    RAISE EXCEPTION 'Invoice or settlement voucher not found in business %', p_business_id;
  END IF;

  IF v_inv.status <> 'posted' OR v_set.status <> 'posted' THEN
    RAISE EXCEPTION 'Both invoice and settlement vouchers must be posted before allocation';
  END IF;

  IF v_inv.voucher_type NOT IN ('SALES', 'PURCHASE') THEN
    RAISE EXCEPTION 'invoice_voucher_id must reference a SALES or PURCHASE voucher (got %)', v_inv.voucher_type;
  END IF;

  IF v_set.voucher_type NOT IN ('RECEIPT', 'PAYMENT', 'SALES_RETURN', 'PURCHASE_RETURN', 'JOURNAL') THEN
    RAISE EXCEPTION 'settlement_voucher_id must reference a RECEIPT, PAYMENT, RETURN, or JOURNAL voucher (got %)', v_set.voucher_type;
  END IF;

  -- Reject allocation against reversed vouchers
  IF EXISTS (
    SELECT 1 FROM public.vouchers rv
    WHERE rv.business_id = p_business_id
      AND rv.reversed_voucher_id IN (v_inv.id, v_set.id)
      AND rv.status = 'posted'
  ) THEN
    RAISE EXCEPTION 'Cannot allocate against a reversed voucher';
  END IF;

  -- Dual-side remaining capacity checks
  SELECT COALESCE(SUM(allocated_amount), 0)
  INTO v_inv_allocated
  FROM public.bill_allocations
  WHERE business_id = p_business_id
    AND invoice_voucher_id = v_inv.id;

  IF v_inv_allocated + p_allocated_amount > v_inv.base_total_amount THEN
    RAISE EXCEPTION 'Over-settlement rejected: invoice % remaining balance is %, requested %',
      v_inv.voucher_no, (v_inv.base_total_amount - v_inv_allocated), p_allocated_amount;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0)
  INTO v_set_allocated
  FROM public.bill_allocations
  WHERE business_id = p_business_id
    AND settlement_voucher_id = v_set.id;

  IF v_set_allocated + p_allocated_amount > v_set.base_total_amount THEN
    RAISE EXCEPTION 'Settlement double-spend rejected: settlement % unallocated balance is %, requested %',
      v_set.voucher_no, (v_set.base_total_amount - v_set_allocated), p_allocated_amount;
  END IF;

  INSERT INTO public.bill_allocations (
    business_id, invoice_voucher_id, settlement_voucher_id,
    allocated_amount, allocation_date, idempotency_key, created_by
  ) VALUES (
    p_business_id, v_inv.id, v_set.id,
    p_allocated_amount, p_allocation_date, p_idempotency_key, v_uid
  )
  RETURNING id INTO v_alloc_id;

  PERFORM public.record_audit_event(
    p_business_id, 'bill_allocation', v_alloc_id::TEXT, 'CREATE',
    NULL, jsonb_build_object(
      'invoice_voucher_id', v_inv.id,
      'settlement_voucher_id', v_set.id,
      'allocated_amount', p_allocated_amount
    )
  );

  v_result := jsonb_build_object(
    'success', true,
    'allocation_id', v_alloc_id,
    'invoice_voucher_id', v_inv.id,
    'settlement_voucher_id', v_set.id,
    'allocated_amount', p_allocated_amount,
    'invoice_remaining', v_inv.base_total_amount - (v_inv_allocated + p_allocated_amount),
    'settlement_remaining', v_set.base_total_amount - (v_set_allocated + p_allocated_amount)
  );

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.complete_idempotency_key(p_business_id, p_idempotency_key, v_result);
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_bill_payment_tx(BIGINT, BIGINT, BIGINT, NUMERIC, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_bill_payment_tx(BIGINT, BIGINT, BIGINT, NUMERIC, DATE, UUID) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

