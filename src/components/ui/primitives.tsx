import React from 'react'
import { cn } from '@/lib/utils'
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  Inbox,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Minus,
  Plus,
} from 'lucide-react'

/* ============================================================================
   1. StatusBadge — Accessible status indicator (icon + text + distinct border)
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

  const config: Record<
    string,
    { text: string; classes: string; icon: React.ComponentType<{ className?: string }> }
  > = {
    draft: {
      text: 'Draft',
      classes: 'bg-amber-50 text-amber-800 border-amber-300/80',
      icon: Clock,
    },
    confirmed: {
      text: 'Confirmed',
      classes: 'bg-emerald-50 text-emerald-800 border-emerald-300/80',
      icon: CheckCircle2,
    },
    cancelled: {
      text: 'Cancelled',
      classes: 'bg-red-50 text-red-800 border-red-200',
      icon: XCircle,
    },
    requested: {
      text: 'Requested',
      classes: 'bg-orange-50 text-orange-800 border-orange-300/80',
      icon: Inbox,
    },
    converted: {
      text: 'Converted',
      classes: 'bg-emerald-50 text-emerald-800 border-emerald-300/80',
      icon: CheckCircle2,
    },
    rejected: {
      text: 'Rejected',
      classes: 'bg-red-50 text-red-800 border-red-200',
      icon: XCircle,
    },
    active: {
      text: 'Active',
      classes: 'bg-emerald-50 text-emerald-800 border-emerald-300/80',
      icon: CheckCircle2,
    },
    archived: {
      text: 'Archived',
      classes: 'bg-stone-100 text-stone-600 border-stone-300',
      icon: XCircle,
    },
    inactive: {
      text: 'Inactive',
      classes: 'bg-stone-100 text-stone-600 border-stone-300',
      icon: XCircle,
    },
    INTAKE: {
      text: 'Inward Intake',
      classes: 'bg-emerald-50 text-emerald-800 border-emerald-300/80',
      icon: ArrowDownLeft,
    },
    TRANSFER: {
      text: 'Location Transfer',
      classes: 'bg-sky-50 text-sky-800 border-sky-300/80',
      icon: ArrowRightLeft,
    },
    DISPATCH: {
      text: 'Order Dispatch',
      classes: 'bg-orange-50 text-orange-800 border-orange-300/80',
      icon: ArrowUpRight,
    },
    ADJUSTMENT: {
      text: 'Adjustment',
      classes: 'bg-stone-100 text-stone-700 border-stone-300',
      icon: AlertCircle,
    },
    pending: {
      text: 'Pending',
      classes: 'bg-amber-50 text-amber-800 border-amber-300/80',
      icon: Clock,
    },
    quoted: {
      text: 'Quoted',
      classes: 'bg-sky-50 text-sky-800 border-sky-300/80',
      icon: CheckCircle2,
    },
    completed: {
      text: 'Completed',
      classes: 'bg-emerald-50 text-emerald-800 border-emerald-300/80',
      icon: CheckCircle2,
    },
  }

  const matched = config[norm] || {
    text: label || norm || 'Unknown',
    classes: 'bg-stone-100 text-stone-700 border-stone-300',
    icon: Clock,
  }

  const Icon = matched.icon

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-semibold rounded-md border whitespace-nowrap',
        size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-xs sm:text-sm',
        matched.classes,
        className
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{label || matched.text}</span>
    </span>
  )
}

/* ============================================================================
   2. QuantityStepper — Touch-safe 1..500 set quantity selector
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
  variant = 'light',
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
    size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-11 h-11' : 'w-9 h-9'
  const inputDimensions =
    size === 'sm' ? 'w-11 text-sm' : size === 'lg' ? 'w-16 text-base' : 'w-13 text-sm'

  const containerClasses =
    variant === 'dark'
      ? 'border-stone-700 bg-stone-800 text-white'
      : 'border-stone-300 bg-stone-50 text-stone-900'

  const buttonClasses =
    variant === 'dark'
      ? 'text-stone-200 hover:bg-stone-700 hover:text-white focus-visible:ring-orange-500'
      : 'text-stone-700 hover:bg-white hover:text-stone-950 hover:shadow-2xs focus-visible:ring-orange-700'

  return (
    <div
      className={cn(
        'inline-flex items-center justify-between border rounded-lg p-1 select-none',
        containerClasses,
        className
      )}
    >
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || value <= min}
        aria-label="Decrease set quantity"
        className={cn(
          'rounded-md flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:opacity-40 disabled:pointer-events-none cursor-pointer',
          btnDimensions,
          buttonClasses
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
          'text-center font-bold bg-transparent focus:outline-none tabular-nums',
          inputDimensions
        )}
      />

      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || value >= max}
        aria-label="Increase set quantity"
        className={cn(
          'rounded-md flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:opacity-40 disabled:pointer-events-none cursor-pointer',
          btnDimensions,
          buttonClasses
        )}
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  )
}

/* ============================================================================
   3. SummaryCard — Operational metric card
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
  icon: Icon,
  iconClassName,
  accent = 'stone',
  className,
}: SummaryCardProps) {
  const defaultIconClasses: Record<string, string> = {
    stone: 'bg-stone-100 text-stone-700',
    orange: 'bg-orange-50 text-orange-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
  }

  const resolvedIconClasses = iconClassName || defaultIconClasses[accent] || defaultIconClasses.stone
  const resolvedSubtitle = subtitle ?? subtext

  const renderIcon = () => {
    if (!Icon) return null
    if (React.isValidElement(Icon)) return Icon
    if (typeof Icon === 'function' || (typeof Icon === 'object' && Icon !== null)) {
      const IconComp = Icon as React.ComponentType<{ className?: string }>
      return <IconComp className="w-4 h-4" />
    }
    return null
  }

  return (
    <div
      className={cn(
        'bg-white border border-stone-200/90 rounded-xl p-4 sm:p-5 shadow-2xs flex flex-col justify-between gap-2',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">
          {label}
        </span>
        {Icon && (
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', resolvedIconClasses)}>
            {renderIcon()}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl sm:text-3xl font-bold tracking-tight text-stone-900 tabular-nums">
            {value}
          </span>
          {unit && <span className="text-xs sm:text-sm font-medium text-stone-500">{unit}</span>}
        </div>
        {resolvedSubtitle && <div className="text-xs text-stone-600 mt-1 font-medium">{resolvedSubtitle}</div>}
      </div>
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
          <h2 className="text-lg sm:text-xl font-bold text-stone-900 tracking-tight">{title}</h2>
          {badge}
        </div>
        {subtitle && <p className="text-xs sm:text-sm text-stone-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

/* ============================================================================
   5. EmptyState & LoadingState
   ============================================================================ */

interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }> | React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const renderIcon = () => {
    if (!Icon) return null
    if (React.isValidElement(Icon)) return Icon
    if (typeof Icon === 'function' || (typeof Icon === 'object' && Icon !== null)) {
      const IconComp = Icon as React.ComponentType<{ className?: string }>
      return <IconComp className="w-6 h-6" />
    }
    return null
  }

  return (
    <div
      className={cn(
        'py-12 px-4 text-center flex flex-col items-center justify-center gap-2',
        className
      )}
    >
      {Icon && (
        <div className="w-12 h-12 rounded-xl bg-stone-100 text-stone-400 flex items-center justify-center mb-1">
          {renderIcon()}
        </div>
      )}
      <h3 className="text-base font-bold text-stone-800">{title}</h3>
      {description && <p className="text-xs sm:text-sm text-stone-500 max-w-sm">{description}</p>}
      {action && <div className="pt-2">{action}</div>}
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
      className={cn(
        'py-12 px-4 flex flex-col items-center justify-center gap-3 text-stone-500',
        className
      )}
    >
      <div className="w-7 h-7 border-3 border-stone-200 border-t-orange-700 rounded-full animate-spin" />
      <p className="text-xs sm:text-sm font-medium">{message}</p>
    </div>
  )
}
