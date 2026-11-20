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
  logoUrl?: string | null
  iconOnly?: boolean
  className?: string
}

/**
 * Reusable KALA brand mark and wordmark component.
 * Uses the central `/branding/kala-icon.svg` vector asset (or optional tenant logoUrl)
 * paired with semantic typography.
 */
export function KalaLogo({
  variant = 'dark',
  size = 'md',
  showSubtitle = false,
  subtitle = 'Textile Wholesale System',
  titleOverride,
  logoUrl,
  iconOnly = false,
  className,
}: KalaLogoProps) {
  const iconSizeClasses =
    size === 'sm' ? 'w-7 h-7 rounded-[6px]' : size === 'lg' ? 'w-9 h-9 rounded-[6px]' : 'w-8 h-8 rounded-[6px]'

  const titleClasses =
    size === 'sm'
      ? 'text-sm'
      : size === 'lg'
        ? 'text-lg'
        : 'text-base'

  const textColor = variant === 'light' ? 'text-white' : 'text-[#1A1D24]'
  const subColor = variant === 'light' ? 'text-[#E3E5EA]' : 'text-[#667085]'

  return (
    <div className={cn('inline-flex items-center gap-2.5 select-none', className)}>
      <img
        src={logoUrl || '/branding/kala-icon.svg'}
        alt={titleOverride || 'Kala'}
        className={cn('shrink-0 object-contain', iconSizeClasses)}
      />
      {!iconOnly && (
        <div className="min-w-0 leading-tight">
          <span
            className={cn(
              'block font-semibold tracking-tight truncate',
              titleClasses,
              textColor
            )}
          >
            {titleOverride || 'Kala'}
          </span>
          {showSubtitle && (
            <span className={cn('block text-xs truncate', subColor)}>
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default KalaLogo
