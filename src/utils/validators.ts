export function validateDesignNo(designNo: string): boolean {
  return designNo.trim().length > 0
}

export function validatePhone(phone: string): boolean {
  // Basic phone validation - adjust regex based on requirements
  const phoneRegex = /^[\d+\-\s()]+$/
  return phone.trim().length >= 10 && phoneRegex.test(phone)
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export function validateInvoiceNo(invoiceNo: string): boolean {
  return invoiceNo.trim().length > 0
}

export function validateProductRate(rate: number): boolean {
  return rate >= 0
}

export function validateQuantity(quantity: number): boolean {
  return quantity > 0 && Number.isInteger(quantity)
}
