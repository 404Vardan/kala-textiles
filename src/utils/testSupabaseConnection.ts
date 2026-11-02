import supabase from '@/services/supabase'

/**
 * Test Supabase Connection
 * Run this script to verify your Supabase setup is working correctly
 */
export async function testSupabaseConnection() {
  console.log('🔍 Testing Supabase connection...')

  try {
    // Test 1: Check if we can connect
    console.log('✓ Supabase client initialized')

    // Test 2: Check admin_settings table
    const { data: _adminData, error: adminError } = await supabase
      .from('admin_settings')
      .select('id')
      .limit(1)

    if (adminError) {
      console.error('❌ Error reading admin_settings:', adminError.message)
      return false
    }
    console.log('✓ admin_settings table accessible')

    // Test 3: Check products table
    const { data: _productsData, error: productsError } = await supabase
      .from('products')
      .select('id')
      .limit(1)

    if (productsError) {
      console.error('❌ Error reading products:', productsError.message)
      return false
    }
    console.log('✓ products table accessible')

    // Test 4: Check invoices table
    const { data: _invoicesData, error: invoicesError } = await supabase
      .from('invoices')
      .select('id')
      .limit(1)

    if (invoicesError) {
      console.error('❌ Error reading invoices:', invoicesError.message)
      return false
    }
    console.log('✓ invoices table accessible')

    // Test 5: Check inquiries table
    const { data: _inquiriesData, error: inquiriesError } = await supabase
      .from('inquiries')
      .select('id')
      .limit(1)

    if (inquiriesError) {
      console.error('❌ Error reading inquiries:', inquiriesError.message)
      return false
    }
    console.log('✓ inquiries table accessible')

    console.log('')
    console.log('✅ ALL TESTS PASSED!')
    console.log('')
    console.log('Your Supabase setup is working correctly.')
    console.log('You can now use the admin dashboard.')
    return true
  } catch (error) {
    console.error('❌ Unexpected error:', error)
    return false
  }
}

// Export for use in browser console
if (typeof window !== 'undefined') {
  (window as any).testSupabaseConnection = testSupabaseConnection
}
