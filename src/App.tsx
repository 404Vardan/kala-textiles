import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/auth/ProtectedRoute'

// Eager load landing page (first paint)
import LandingPage from './pages/LandingPage'

// Lazy load other pages
const AdminPage = lazy(() => import('./pages/AdminPage'))
const ProductPage = lazy(() => import('./pages/ProductPage'))
const InvoicePage = lazy(() => import('./pages/InvoicePage'))
const OrderPage = lazy(() => import('./pages/OrderPage'))
const StaffPage = lazy(() => import('./pages/StaffPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-orange-200 border-t-orange-600 rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />

            {/* Protected Business Operations */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute requiredRole="owner">
                  <AdminPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/staff"
              element={
                <ProtectedRoute requiredRole="staff">
                  <StaffPage />
                </ProtectedRoute>
              }
            />

            {/* Public Catalog & Inquiry Routes (both legacy and tenant-scoped) */}
            <Route path="/p/:designNo" element={<ProductPage />} />
            <Route path="/:slug/p/:designNo" element={<ProductPage />} />

            {/* Public Invoice Routes */}
            <Route path="/invoice/:invoiceNo" element={<InvoicePage />} />
            <Route path="/:slug/invoice/:invoiceNo" element={<InvoicePage />} />

            {/* Public Order Tracking Routes */}
            <Route path="/order/:orderNo" element={<OrderPage />} />
            <Route path="/:slug/order/:orderNo" element={<OrderPage />} />

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App

