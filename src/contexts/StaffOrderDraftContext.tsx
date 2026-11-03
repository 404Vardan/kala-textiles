import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'
import type { Product, StaffOrderDraft, StaffOrderHeaderDraft, StaffOrderItemDraft } from '@/types'

const STAFF_DRAFT_PREFIX = 'kala:staff-order-draft:'
const LEGACY_STAFF_DRAFT_PREFIX = 'rangoli:staff-order-draft:'

function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10)
}

function createEmptyDraft(): StaffOrderDraft {
  return {
    partyName: '',
    station: '',
    agent: '',
    gstNumber: '',
    orderDate: getTodayDateString(),
    exportDate: '',
    brand: '',
    productName: '',
    notes: '',
    items: [],
    updatedAt: new Date().toISOString(),
  }
}

interface StaffOrderDraftContextType {
  draft: StaffOrderDraft
  hasDraftContent: boolean
  totalDesigns: number
  totalSets: number
  totalPcs: number
  totalAmount: number
  updateHeader: (patch: Partial<StaffOrderHeaderDraft>) => void
  setItems: (items: StaffOrderItemDraft[]) => void
  addProductToDraft: (product: Product, setsToAdd?: number) => StaffOrderItemDraft
  updateDraftItem: (index: number, field: keyof StaffOrderItemDraft, value: string | number) => void
  removeDraftItem: (index: number) => void
  clearDraft: () => void
}

const StaffOrderDraftContext = createContext<StaffOrderDraftContextType | undefined>(undefined)

export function StaffOrderDraftProvider({ children }: { children: React.ReactNode }) {
  const { user, business } = useAuth()

  const storageKey = useMemo(() => {
    if (!user?.id || !business?.id) return null
    return `${STAFF_DRAFT_PREFIX}${user.id}:${business.id}`
  }, [user?.id, business?.id])

  const legacyStorageKey = useMemo(() => {
    if (!user?.id || !business?.id) return null
    return `${LEGACY_STAFF_DRAFT_PREFIX}${user.id}:${business.id}`
  }, [user?.id, business?.id])

  const [draft, setDraft] = useState<StaffOrderDraft>(() => createEmptyDraft())

  // Load draft whenever user or business changes (with automatic migration from legacy key)
  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') {
      setDraft(createEmptyDraft())
      return
    }

    try {
      let raw = window.localStorage.getItem(storageKey)
      if (!raw && legacyStorageKey) {
        const legacyRaw = window.localStorage.getItem(legacyStorageKey)
        if (legacyRaw) {
          raw = legacyRaw
          try {
            window.localStorage.setItem(storageKey, legacyRaw)
            window.localStorage.removeItem(legacyStorageKey)
          } catch {
            // Ignore migration write errors
          }
        }
      }

      if (!raw) {
        setDraft(createEmptyDraft())
        return
      }
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') {
        setDraft(createEmptyDraft())
        return
      }

      const items: StaffOrderItemDraft[] = Array.isArray(parsed.items)
        ? parsed.items
            .filter((i: any) => i && typeof i === 'object' && Number(i.product_id) > 0)
            .map((i: any) => {
              const sets = Math.max(1, Math.min(500, Math.floor(Number(i.sets) || 1)))
              const pcsPerSet = Math.max(1, Math.floor(Number(i.pcs_per_set) || 1))
              const rate = Math.max(0, Number(i.rate) || 0)
              const totalPcs = sets * pcsPerSet
              const lineTotal = Number((totalPcs * rate).toFixed(2))
              return {
                product_id: Number(i.product_id),
                design_no: String(i.design_no || '').trim(),
                rate,
                sets,
                pcs_per_set: pcsPerSet,
                total_pcs: totalPcs,
                line_total: lineTotal,
                brand: i.brand ? String(i.brand) : undefined,
              }
            })
        : []

      setDraft({
        partyName: String(parsed.partyName || ''),
        station: String(parsed.station || ''),
        agent: String(parsed.agent || ''),
        gstNumber: String(parsed.gstNumber || ''),
        orderDate: String(parsed.orderDate || getTodayDateString()),
        exportDate: String(parsed.exportDate || ''),
        brand: String(parsed.brand || ''),
        productName: String(parsed.productName || ''),
        notes: String(parsed.notes || ''),
        items,
        updatedAt: String(parsed.updatedAt || new Date().toISOString()),
      })
    } catch {
      setDraft(createEmptyDraft())
    }
  }, [storageKey, legacyStorageKey])

  const persistDraft = useCallback(
    (updater: (prev: StaffOrderDraft) => StaffOrderDraft) => {
      setDraft((prev) => {
        const next = {
          ...updater(prev),
          updatedAt: new Date().toISOString(),
        }

        if (storageKey && typeof window !== 'undefined') {
          try {
            if (legacyStorageKey) {
              window.localStorage.removeItem(legacyStorageKey)
            }

            const isEmpty =
              next.items.length === 0 &&
              !next.partyName.trim() &&
              !next.station.trim() &&
              !next.agent.trim() &&
              !next.gstNumber.trim() &&
              !next.brand.trim() &&
              !next.productName.trim() &&
              !next.notes.trim()

            if (isEmpty) {
              window.localStorage.removeItem(storageKey)
            } else {
              window.localStorage.setItem(storageKey, JSON.stringify(next))
            }
          } catch {
            // Ignore localStorage quota or private mode failures
          }
        }

        return next
      })
    },
    [storageKey, legacyStorageKey]
  )

  const updateHeader = useCallback(
    (patch: Partial<StaffOrderHeaderDraft>) => {
      persistDraft((prev) => ({
        ...prev,
        ...patch,
      }))
    },
    [persistDraft]
  )

  const setItems = useCallback(
    (items: StaffOrderItemDraft[]) => {
      persistDraft((prev) => ({
        ...prev,
        items,
      }))
    },
    [persistDraft]
  )

  const addProductToDraft = useCallback(
    (product: Product, setsToAdd: number = 1): StaffOrderItemDraft => {
      const clampedSetsToAdd = Math.max(1, Math.min(500, Math.floor(Number(setsToAdd) || 1)))
      const pcsPerSet = Math.max(1, Math.floor(Number(product.pcs_per_set) || 1))
      const rate = Math.max(0, Number(product.rate) || 0)

      let updatedItem: StaffOrderItemDraft = {
        product_id: product.id,
        design_no: product.design_no,
        rate,
        sets: clampedSetsToAdd,
        pcs_per_set: pcsPerSet,
        total_pcs: clampedSetsToAdd * pcsPerSet,
        line_total: Number((clampedSetsToAdd * pcsPerSet * rate).toFixed(2)),
        brand: product.brand,
      }

      persistDraft((prev) => {
        const existingIndex = prev.items.findIndex(
          (item) =>
            item.product_id === product.id ||
            item.design_no.trim().toUpperCase() === product.design_no.trim().toUpperCase()
        )

        let nextItems: StaffOrderItemDraft[]
        if (existingIndex >= 0) {
          const existing = prev.items[existingIndex]
          const newSets = Math.max(1, Math.min(500, existing.sets + clampedSetsToAdd))
          const newTotalPcs = newSets * existing.pcs_per_set
          const newLineTotal = Number((newTotalPcs * existing.rate).toFixed(2))
          updatedItem = {
            ...existing,
            sets: newSets,
            total_pcs: newTotalPcs,
            line_total: newLineTotal,
          }
          nextItems = prev.items.map((item, idx) => (idx === existingIndex ? updatedItem : item))
        } else {
          nextItems = [...prev.items, updatedItem]
        }

        return {
          ...prev,
          brand: prev.brand || product.brand || '',
          items: nextItems,
        }
      })

      return updatedItem
    },
    [persistDraft]
  )

  const updateDraftItem = useCallback(
    (index: number, field: keyof StaffOrderItemDraft, value: string | number) => {
      persistDraft((prev) => {
        const nextItems = prev.items.map((item, idx) => {
          if (idx !== index) return item
          const updated: StaffOrderItemDraft = { ...item, [field]: value }
          if (field === 'sets') {
            updated.sets = Math.max(1, Math.min(500, Math.floor(Number(value) || 1)))
          } else if (field === 'pcs_per_set') {
            updated.pcs_per_set = Math.max(1, Math.floor(Number(value) || 1))
          } else if (field === 'rate') {
            updated.rate = Math.max(0, Number(value) || 0)
          }
          updated.total_pcs = updated.sets * updated.pcs_per_set
          updated.line_total = Number((updated.total_pcs * updated.rate).toFixed(2))
          return updated
        })

        return {
          ...prev,
          items: nextItems,
        }
      })
    },
    [persistDraft]
  )

  const removeDraftItem = useCallback(
    (index: number) => {
      persistDraft((prev) => ({
        ...prev,
        items: prev.items.filter((_, idx) => idx !== index),
      }))
    },
    [persistDraft]
  )

  const clearDraft = useCallback(() => {
    const empty = createEmptyDraft()
    setDraft(empty)
    if (typeof window !== 'undefined') {
      try {
        if (storageKey) window.localStorage.removeItem(storageKey)
        if (legacyStorageKey) window.localStorage.removeItem(legacyStorageKey)
      } catch {
        // Ignore storage errors
      }
    }
  }, [storageKey, legacyStorageKey])

  const totalDesigns = draft.items.length
  const totalSets = useMemo(
    () => draft.items.reduce((sum, item) => sum + (Number(item.sets) || 0), 0),
    [draft.items]
  )
  const totalPcs = useMemo(
    () => draft.items.reduce((sum, item) => sum + (Number(item.total_pcs) || 0), 0),
    [draft.items]
  )
  const totalAmount = useMemo(
    () => Number(draft.items.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0).toFixed(2)),
    [draft.items]
  )

  const hasDraftContent =
    draft.items.length > 0 ||
    Boolean(draft.partyName.trim()) ||
    Boolean(draft.notes.trim())

  const value: StaffOrderDraftContextType = {
    draft,
    hasDraftContent,
    totalDesigns,
    totalSets,
    totalPcs,
    totalAmount,
    updateHeader,
    setItems,
    addProductToDraft,
    updateDraftItem,
    removeDraftItem,
    clearDraft,
  }

  return (
    <StaffOrderDraftContext.Provider value={value}>
      {children}
    </StaffOrderDraftContext.Provider>
  )
}

export function useStaffOrderDraft() {
  const ctx = useContext(StaffOrderDraftContext)
  if (!ctx) {
    throw new Error('useStaffOrderDraft must be used within a StaffOrderDraftProvider')
  }
  return ctx
}
