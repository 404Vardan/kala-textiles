const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export function formatCurrency(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0
  const hasFraction = Math.abs(value % 1) > 0.001
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(value)
}

export function formatDate(dateString: string): string {
  if (!dateString) return '—'
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return dateString
  const dd = String(date.getDate()).padStart(2, '0')
  const mmm = SHORT_MONTHS[date.getMonth()]
  const yyyy = date.getFullYear()
  return `${dd} ${mmm} ${yyyy}`
}

export function formatDateTime(dateString: string): string {
  if (!dateString) return '—'
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return dateString
  const base = formatDate(dateString)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${base}, ${hh}:${mm}`
}

export function truncateText(text: string, length: number): string {
  return text.length > length ? text.substring(0, length) + '...' : text
}
