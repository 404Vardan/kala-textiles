import React from 'react'
import { cn } from '@/lib/utils'
import { Minus, Plus } from 'lucide-react'

/* ============================================================================
   1. StatusBadge — Flat, high-contrast status indicator (1px border, no tints)
   ============================================================================ */

export type BadgeVariant =
  | 'draft'
  | 'confirmed'
  | 'cancelled'
  | 'requested'
  | 'converted'
  | 'rejected'
  | 'active'
  | 'archived'
  | 'inactive'
  | 'INTAKE'
  | 'TRANSFER'
  | 'DISPATCH'
  | 'ADJUSTMENT'
  | 'pending'
  | 'quoted'
  | 'completed'

interface StatusBadgeProps {
  status: BadgeVariant | string
  label?: string
  className?: string
  size?: 'sm' | 'md'
}

export function StatusBadge({ status, label, className, size = 'sm' }: StatusBadgeProps) {
  const norm = (status || '').trim()

  const config: Record<string, { text: string; dotClass: string; textClass: string }> = {
    draft: {
      text: 'Draft',
      dotClass: 'bg-[#B7791F]',
      textClass: 'text-[#8A580F]',
    },
    confirmed: {
      text: 'Confirmed',
      dotClass: 'bg-[#1F7A4D]',
      textClass: 'text-[#1F7A4D]',
    },
    cancelled: {
      text: 'Cancelled',
      dotClass: 'bg-[#B42318]',
      textClass: 'text-[#B42318]',
    },
    requested: {
      text: 'Requested',
      dotClass: 'bg-[#1E2A4A]',
      textClass: 'text-[#1E2A4A]',
    },
    converted: {
      text: 'Converted',
      dotClass: 'bg-[#1F7A4D]',
      textClass: 'text-[#1F7A4D]',
    },
    rejected: {
      text: 'Rejected',
      dotClass: 'bg-[#B42318]',
      textClass: 'text-[#B42318]',
    },
    active: {
      text: 'Active',
      dotClass: 'bg-[#1F7A4D]',
      textClass: 'text-[#1F7A4D]',
    },
    archived: {
      text: 'Archived',
      dotClass: 'bg-[#667085]',
      textClass: 'text-[#667085]',
    },
    inactive: {
      text: 'Inactive',
      dotClass: 'bg-[#667085]',
      textClass: 'text-[#667085]',
    },
    INTAKE: {
      text: 'Intake',
      dotClass: 'bg-[#1F7A4D]',
      textClass: 'text-[#1F7A4D]',
    },
    TRANSFER: {
      text: 'Transfer',
      dotClass: 'bg-[#1E2A4A]',
      textClass: 'text-[#1E2A4A]',
    },
    DISPATCH: {
      text: 'Dispatch',
      dotClass: 'bg-[#B7791F]',
      textClass: 'text-[#8A580F]',
    },
    ADJUSTMENT: {
      text: 'Adjustment',
      dotClass: 'bg-[#667085]',
      textClass: 'text-[#667085]',
    },
    pending: {
      text: 'Pending',
      dotClass: 'bg-[#B7791F]',
      textClass: 'text-[#8A580F]',
    },
    quoted: {
      text: 'Quoted',
      dotClass: 'bg-[#1E2A4A]',
      textClass: 'text-[#1E2A4A]',
    },
    completed: {
      text: 'Completed',
      dotClass: 'bg-[#1F7A4D]',
      textClass: 'text-[#1F7A4D]',
    },
  }

  const matched = config[norm] || {
    text: label || norm || 'Unknown',
    dotClass: 'bg-[#667085]',
    textClass: 'text-[#667085]',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium rounded-[6px] border border-[#E3E5EA] bg-white whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        matched.textClass,
        className
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', matched.dotClass)} aria-hidden="true" />
      <span>{label || matched.text}</span>
    </span>
  )
}

/* ============================================================================
   2. QuantityStepper — Touch-safe 1..500 set quantity selector (44px in lg)
   ============================================================================ */

interface QuantityStepperProps {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
  variant?: 'light' | 'dark'
  ariaLabel?: string
  className?: string
}

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 500,
  disabled = false,
  size = 'md',
  ariaLabel = 'Quantity in sets',
  className,
}: QuantityStepperProps) {
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.floor(Number.isFinite(n) ? n : min)))

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '')
    if (!raw) {
      onChange(min)
      return
    }
    const parsed = parseInt(raw, 10)
    if (!Number.isNaN(parsed)) {
      onChange(clamp(parsed))
    }
  }

  const btnDimensions =
    size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-11 h-11 min-w-[44px] min-h-[44px]' : 'w-9 h-9'
  const inputDimensions =
    size === 'sm' ? 'w-11 text-sm' : size === 'lg' ? 'w-14 h-11 text-base' : 'w-12 text-sm'

  return (
    <div
      className={cn(
        'inline-flex items-center justify-between border border-[#E3E5EA] bg-white text-[#1A1D24] rounded-[6px] select-none',
        className
      )}
    >
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || value <= min}
        aria-label="Decrease set quantity"
        className={cn(
          'rounded-l-[6px] flex items-center justify-center text-[#1A1D24] hover:bg-[#F4F5F7] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E2A4A] disabled:opacity-40 disabled:pointer-events-none cursor-pointer border-r border-[#E3E5EA]',
          btnDimensions
        )}
      >
        <Minus className="w-4 h-4" />
      </button>

      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={ariaLabel}
        value={value}
        onChange={handleInputChange}
        disabled={disabled}
        className={cn(
          'text-center font-semibold bg-transparent focus:outline-none tabular-nums text-[#1A1D24]',
          inputDimensions
        )}
      />

      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || value >= max}
        aria-label="Increase set quantity"
        className={cn(
          'rounded-r-[6px] flex items-center justify-center text-[#1A1D24] hover:bg-[#F4F5F7] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E2A4A] disabled:opacity-40 disabled:pointer-events-none cursor-pointer border-l border-[#E3E5EA]',
          btnDimensions
        )}
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  )
}

/* ============================================================================
   3. SummaryCard — Compact stat block (white surface, 1px border, no shadows)
   ============================================================================ */

interface SummaryCardProps {
  label: string
  value: React.ReactNode
  unit?: string
  subtitle?: React.ReactNode
  subtext?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }> | React.ReactNode
  iconClassName?: string
  accent?: 'stone' | 'orange' | 'emerald' | 'amber'
  className?: string
}

export function SummaryCard({
  label,
  value,
  unit,
  subtitle,
  subtext,
  className,
}: SummaryCardProps) {
  const resolvedSubtitle = subtitle ?? subtext

  return (
    <div
      className={cn(
        'bg-white border border-[#E3E5EA] rounded-[6px] p-4 flex flex-col justify-between gap-1.5',
        className
      )}
    >
      <span className="text-xs font-medium text-[#667085]">{label}</span>

      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tracking-tight text-[#1A1D24] tabular-nums">
          {value}
        </span>
        {unit && <span className="text-xs font-medium text-[#667085]">{unit}</span>}
      </div>

      {resolvedSubtitle && (
        <div className="text-xs text-[#667085] tabular-nums">{resolvedSubtitle}</div>
      )}
    </div>
  )
}

/* ============================================================================
   4. SectionHeader — Workspace section header
   ============================================================================ */

interface SectionHeaderProps {
  title: string
  subtitle?: string
  badge?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

export function SectionHeader({
  title,
  subtitle,
  badge,
  actions,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row sm:items-center justify-between gap-3',
        className
      )}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base sm:text-lg font-semibold text-[#1A1D24] tracking-tight">{title}</h2>
          {badge}
        </div>
        {subtitle && <p className="text-xs text-[#667085] mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

/* ============================================================================
   5. EmptyState & LoadingState — One line of text + one primary action, no illustrations
   ============================================================================ */

interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }> | React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  title,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'py-8 px-4 flex flex-col sm:flex-row items-center justify-between gap-3',
        className
      )}
    >
      <p className="text-sm text-[#667085]">{title}</p>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

interface LoadingStateProps {
  message?: string
  className?: string
}

export function LoadingState({ message = 'Loading...', className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'py-8 px-4 flex items-center justify-center gap-2.5 text-sm text-[#667085]',
        className
      )}
    >
      <span
        className="w-4 h-4 border-2 border-[#E3E5EA] border-t-[#1E2A4A] rounded-full animate-spin shrink-0"
        aria-hidden="true"
      />
      <span>{message}</span>
    </div>
  )
}
