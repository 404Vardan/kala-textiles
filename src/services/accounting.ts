import supabase from './supabase'
import type {
  Account,
  AccountGroup,
  BalanceType,
  CostCenter,
  Voucher,
  VoucherEntry,
  VoucherEntryInput,
  VoucherType,
  BillAllocation,
  PostVoucherResult,
  ReverseVoucherResult,
  AllocateBillPaymentResult,
  OpeningBalanceReport,
  TrialBalanceReport,
  CloseFinancialYearResult,
  PartySubledgerBill,
  AccountOpeningBalance,
  SubledgerControlTieoutReport,
} from '@/types'

// --------------------------------------------------------------------
// Chart of Accounts & Cost Centres
// --------------------------------------------------------------------

export async function fetchAccounts(filters?: {
  group?: AccountGroup
  activeOnly?: boolean
}): Promise<Account[]> {
  let query = supabase
    .from('accounts')
    .select('*')
    .order('code', { ascending: true })

  if (filters?.group) {
    query = query.eq('account_group', filters.group)
  }
  if (filters?.activeOnly !== false) {
    query = query.eq('is_active', true)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Account[]
}

export async function createAccount(input: {
  code: string
  name: string
  accountGroup: AccountGroup
  subGroup?: string | null
  partyId?: number | null
  openingBalance?: number
  openingBalanceType?: BalanceType
}): Promise<Account> {
  const { data, error } = await supabase
    .from('accounts')
    .insert({
      code: input.code.trim(),
      name: input.name.trim(),
      account_group: input.accountGroup,
      sub_group: input.subGroup?.trim() || null,
      party_id: input.partyId ?? null,
      opening_balance: input.openingBalance ?? 0,
      opening_balance_type: input.openingBalanceType ?? 'DR',
    })
    .select()
    .single()

  if (error) throw error
  return data as Account
}

export async function fetchCostCenters(activeOnly = true): Promise<CostCenter[]> {
  let query = supabase
    .from('cost_centers')
    .select('*')
    .order('code', { ascending: true })

  if (activeOnly) {
    query = query.eq('is_active', true)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as CostCenter[]
}

// --------------------------------------------------------------------
// Vouchers, Entries & Bill Allocations (Read-Only Queries)
// --------------------------------------------------------------------

export async function fetchVouchers(filters?: {
  fyId?: number
  voucherType?: VoucherType
  limit?: number
}): Promise<Voucher[]> {
  let query = supabase
    .from('vouchers')
    .select('*')
    .order('voucher_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(filters?.limit ?? 100)

  if (filters?.fyId !== undefined) {
    query = query.eq('fy_id', filters.fyId)
  }
  if (filters?.voucherType) {
    query = query.eq('voucher_type', filters.voucherType)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Voucher[]
}

export async function fetchVoucherEntries(voucherId: number): Promise<VoucherEntry[]> {
  const { data, error } = await supabase
    .from('voucher_entries')
    .select('*')
    .eq('voucher_id', voucherId)
    .order('id', { ascending: true })

  if (error) throw error
  return (data ?? []) as VoucherEntry[]
}

export async function fetchBillAllocations(voucherId: number): Promise<BillAllocation[]> {
  if (!Number.isInteger(voucherId) || voucherId <= 0) {
    throw new Error('Valid positive integer voucherId is required')
  }

  const { data, error } = await supabase
    .from('bill_allocations')
    .select('*')
    .or(`invoice_voucher_id.eq.${voucherId},settlement_voucher_id.eq.${voucherId}`)
    .order('allocation_date', { ascending: false })
    .order('id', { ascending: false })

  if (error) throw error
  return (data ?? []) as BillAllocation[]
}

// --------------------------------------------------------------------
// Stage 3 Transactional Accounting RPCs
// --------------------------------------------------------------------

export async function postVoucher(params: {
  businessId: number
  branchId: number
  voucherType: Exclude<VoucherType, 'REVERSAL'>
  voucherDate: string
  entries: VoucherEntryInput[]
  partyId?: number | null
  narration?: string | null
  refDocType?: string | null
  refDocId?: number | null
  currencyCode?: string
  exchangeRate?: number
  idempotencyKey?: string | null
}): Promise<PostVoucherResult> {
  if (params.entries.length < 2) {
    throw new Error('A voucher requires at least 2 balanced entries')
  }

  const { data, error } = await supabase.rpc('post_voucher_tx', {
    p_business_id: params.businessId,
    p_branch_id: params.branchId,
    p_voucher_type: params.voucherType,
    p_voucher_date: params.voucherDate,
    p_entries: params.entries,
    p_narration: params.narration ?? null,
    p_ref_doc_type: params.refDocType ?? null,
    p_ref_doc_id: params.refDocId ?? null,
    p_currency_code: params.currencyCode ?? 'INR',
    p_exchange_rate: params.exchangeRate ?? 1.0,
    p_idempotency_key: params.idempotencyKey ?? null,
    p_party_id: params.partyId ?? null,
  })

  if (error) throw new Error(error.message || 'Voucher posting RPC failed')
  if (!data) throw new Error('Voucher posting RPC returned no data')
  return data as PostVoucherResult
}

export async function reverseVoucher(params: {
  businessId: number
  voucherId: number
  reversalDate?: string
  reason: string
  idempotencyKey?: string | null
}): Promise<ReverseVoucherResult> {
  if (!params.reason.trim()) {
    throw new Error('A reversal reason is required')
  }

  const { data, error } = await supabase.rpc('reverse_voucher_tx', {
    p_business_id: params.businessId,
    p_voucher_id: params.voucherId,
    p_reversal_date: params.reversalDate ?? new Date().toISOString().slice(0, 10),
    p_reason: params.reason.trim(),
    p_idempotency_key: params.idempotencyKey ?? null,
  })

  if (error) throw new Error(error.message || 'Voucher reversal RPC failed')
  if (!data) throw new Error('Voucher reversal RPC returned no data')
  return data as ReverseVoucherResult
}

export async function allocateBillPayment(params: {
  businessId: number
  invoiceVoucherId: number
  settlementVoucherId: number
  allocatedAmount: number
  allocationDate?: string
  idempotencyKey?: string | null
}): Promise<AllocateBillPaymentResult> {
  if (params.allocatedAmount <= 0) {
    throw new Error('Allocated amount must be greater than zero')
  }

  const { data, error } = await supabase.rpc('allocate_bill_payment_tx', {
    p_business_id: params.businessId,
    p_invoice_voucher_id: params.invoiceVoucherId,
    p_settlement_voucher_id: params.settlementVoucherId,
    p_allocated_amount: params.allocatedAmount,
    p_allocation_date: params.allocationDate ?? new Date().toISOString().slice(0, 10),
    p_idempotency_key: params.idempotencyKey ?? null,
  })

  if (error) throw new Error(error.message || 'Bill allocation RPC failed')
  if (!data) throw new Error('Bill allocation RPC returned no data')
  return data as AllocateBillPaymentResult
}

export async function fetchPartySubledgerBills(filters?: {
  partyId?: number
  status?: PartySubledgerBill['status']
  limit?: number
}): Promise<PartySubledgerBill[]> {
  let query = supabase
    .from('party_subledger_bills')
    .select('*')
    .order('document_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(filters?.limit ?? 100)

  if (filters?.partyId !== undefined) {
    query = query.eq('party_id', filters.partyId)
  }
  if (filters?.status !== undefined) {
    query = query.eq('status', filters.status)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as PartySubledgerBill[]
}

export async function fetchAccountOpeningBalances(
  fyId: number
): Promise<AccountOpeningBalance[]> {
  const { data, error } = await supabase
    .from('account_opening_balances')
    .select('*')
    .eq('fy_id', fyId)
    .order('account_id', { ascending: true })

  if (error) throw error
  return (data ?? []) as AccountOpeningBalance[]
}

export async function setOpeningBalance(params: {
  businessId: number
  fyId: number
  accountId: number
  openingDebit?: number
  openingCredit?: number
  partyId?: number | null
  branchId?: number | null
  currencyCode?: string
  sourceType?: 'MANUAL' | 'RELY_MIGRATION'
  sourceRef?: string | null
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('set_opening_balance_tx', {
    p_business_id: params.businessId,
    p_fy_id: params.fyId,
    p_account_id: params.accountId,
    p_opening_debit: params.openingDebit ?? 0,
    p_opening_credit: params.openingCredit ?? 0,
    p_party_id: params.partyId ?? null,
    p_branch_id: params.branchId ?? null,
    p_currency_code: params.currencyCode ?? 'INR',
    p_source_type: params.sourceType ?? 'MANUAL',
    p_source_ref: params.sourceRef ?? null,
  })

  if (error) throw new Error(error.message || 'Set opening balance RPC failed')
  if (!data) throw new Error('Set opening balance RPC returned no data')
  return data as Record<string, unknown>
}

export async function verifySubledgerControlTieout(
  businessId: number,
  fyId: number
): Promise<SubledgerControlTieoutReport> {
  const { data, error } = await supabase.rpc('verify_subledger_control_tieout', {
    p_business_id: businessId,
    p_fy_id: fyId,
  })

  if (error) throw new Error(error.message || 'Subledger control tie-out RPC failed')
  if (!data) throw new Error('Subledger control tie-out RPC returned no data')
  return data as SubledgerControlTieoutReport
}

export async function verifyOpeningBalances(
  businessId: number,
  fyId?: number | null
): Promise<OpeningBalanceReport> {
  const { data, error } = await supabase.rpc('verify_opening_balances', {
    p_business_id: businessId,
    p_fy_id: fyId ?? null,
  })

  if (error) throw new Error(error.message || 'Opening balance verification failed')
  if (!data) throw new Error('Opening balance verification returned no data')
  return data as OpeningBalanceReport
}

export async function verifyTrialBalance(
  businessId: number,
  fyId: number
): Promise<TrialBalanceReport> {
  const { data, error } = await supabase.rpc('verify_trial_balance', {
    p_business_id: businessId,
    p_fy_id: fyId,
  })

  if (error) throw new Error(error.message || 'Trial balance verification failed')
  if (!data) throw new Error('Trial balance verification returned no data')
  return data as TrialBalanceReport
}

export async function closeFinancialYear(params: {
  businessId: number
  fyId: number
  idempotencyKey?: string | null
  nextFyId?: number | null
}): Promise<CloseFinancialYearResult> {
  const { data, error } = await supabase.rpc('close_financial_year_tx', {
    p_business_id: params.businessId,
    p_fy_id: params.fyId,
    p_idempotency_key: params.idempotencyKey ?? null,
    p_next_fy_id: params.nextFyId ?? null,
  })

  if (error) throw new Error(error.message || 'Financial year close RPC failed')
  if (!data) throw new Error('Financial year close RPC returned no data')
  return data as CloseFinancialYearResult
}

