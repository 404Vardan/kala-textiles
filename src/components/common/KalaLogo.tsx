import { cn } from '@/lib/utils'

/**
 * Normalizes a tenant or business display name so empty values or legacy seed values
 * ("Rangoli Textiles" / "Rangoli") render as the rebranded product name "Kala",
 * while custom tenant names remain intact.
 */
export function resolveBrandName(rawName?: string | null): string {
  const trimmed = (rawName || '').trim()
  if (!trimmed || /^rangoli(\s+textiles)?$/i.test(trimmed)) {
    return 'Kala'
  }
  return trimmed
}

interface KalaLogoProps {
  variant?: 'dark' | 'light'
  size?: 'sm' | 'md' | 'lg'
  showSubtitle?: boolean
  subtitle?: string
  titleOverride?: string
  iconOnly?: boolean
  className?: string
}

/**
 * Reusable KALA brand mark and wordmark component.
 * Uses the central `/branding/kala-icon.svg` vector asset paired with semantic typography
 * so it can render either the platform brand ("KALA") or a tenant business name with the Kala icon.
 */
export function KalaLogo({
  variant = 'dark',
  size = 'md',
  showSubtitle = true,
  subtitle = 'Textile Wholesale System',
  titleOverride,
  iconOnly = false,
  className,
}: KalaLogoProps) {
  const iconSizeClasses =
    size === 'sm' ? 'w-8 h-8 rounded-lg' : size === 'lg' ? 'w-11 h-11 rounded-xl' : 'w-9 h-9 rounded-lg'

  const titleClasses =
    size === 'sm'
      ? 'text-sm sm:text-base'
      : size === 'lg'
        ? 'text-xl sm:text-2xl'
        : 'text-base sm:text-lg'

  const textColor = variant === 'light' ? 'text-stone-100' : 'text-stone-900'
  const subColor = variant === 'light' ? 'text-stone-400' : 'text-stone-500'

  return (
    <div className={cn('inline-flex items-center gap-2.5 select-none', className)}>
      <img
        src="/branding/kala-icon.svg"
        alt="Kala"
        className={cn('shrink-0 shadow-2xs object-contain', iconSizeClasses)}
      />
      {!iconOnly && (
        <div className="min-w-0 leading-tight">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'font-extrabold tracking-tight truncate',
                titleClasses,
                textColor
              )}
            >
              {titleOverride || 'KALA'}
            </span>
            {!titleOverride && (
              <span className="w-1.5 h-1.5 rounded-xs bg-orange-700 shrink-0" />
            )}
          </div>
          {showSubtitle && (
            <span className={cn('block text-[11px] font-medium truncate', subColor)}>
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default KalaLogo
