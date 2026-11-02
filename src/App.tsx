import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { lazy, Suspense } from 'react'

// Eager load landing page (first paint)
import LandingPage from './pages/LandingPage'

// Lazy load other pages
const AdminPage = lazy(() => import('./pages/AdminPage'))
const ProductPage = lazy(() => import('./pages/ProductPage'))
const InvoicePage = lazy(() => import('./pages/InvoicePage'))
const OrderPage = lazy(() => import('./pages/OrderPage'))
const StaffPage = lazy(() => import('./pages/StaffPage'))
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
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/p/:designNo" element={<ProductPage />} />
          <Route path="/invoice/:invoiceNo" element={<InvoicePage />} />
          <Route path="/order/:orderNo" element={<OrderPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
