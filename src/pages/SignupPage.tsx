import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KalaLogo } from '@/components/common/KalaLogo'
import {
  checkSlugAvailable,
  createBusiness,
  slugifyBusinessName,
  type SlugAvailabilityResult,
} from '@/services/onboarding'
import {
  ArrowLeft,
  Lock,
  Mail,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Store,
  Link2,
  FileText,
  MapPin,
} from 'lucide-react'

export default function SignupPage() {
  const { user, membership, isOwner, isStaff, hasMultipleMemberships, loading: authLoading, signUp, refreshMembership } = useAuth()
  const navigate = useNavigate()

  // Step 1: Account creation
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [emailConfirmationSent, setEmailConfirmationSent] = useState(false)

  // Step 2: Create your shop
  const [shopName, setShopName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const [gstin, setGstin] = useState('')
  const [address, setAddress] = useState('')

  const [slugStatus, setSlugStatus] = useState<SlugAvailabilityResult | null>(null)
  const [checkingSlug, setCheckingSlug] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Redirect users who already have a business membership
  useEffect(() => {
    if (authLoading) return
    if (user && membership) {
      if (isOwner) {
        navigate('/admin', { replace: true })
      } else if (isStaff) {
        navigate('/staff', { replace: true })
      }
    }
  }, [authLoading, user, membership, isOwner, isStaff, navigate])

  // Auto-generate slug from shop name until user manually edits slug
  useEffect(() => {
    if (!slugManuallyEdited) {
      setSlug(slugifyBusinessName(shopName))
    }
  }, [shopName, slugManuallyEdited])

  // Debounced slug availability check
  useEffect(() => {
    const clean = slug.trim().toLowerCase()
    if (!clean) {
      setSlugStatus(null)
      setCheckingSlug(false)
      return
    }

    let cancelled = false
    setCheckingSlug(true)
    const timer = setTimeout(async () => {
      try {
        const res = await checkSlugAvailable(clean)
        if (!cancelled) {
          setSlugStatus(res)
        }
      } catch (err: any) {
        if (!cancelled) {
          setSlugStatus({
            available: false,
            slug: clean,
            reason: err?.message || 'Unable to verify slug.',
          })
        }
      } finally {
        if (!cancelled) {
          setCheckingSlug(false)
        }
      }
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [slug])

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email.trim() || !password) {
      setError('Please enter your email and password.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const { error: signUpError, needsEmailConfirmation } = await signUp(email, password)
      if (signUpError) {
        setError(signUpError.message || 'Unable to create account.')
        return
      }
      if (needsEmailConfirmation) {
        setEmailConfirmationSent(true)
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to create account. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateShopSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!shopName.trim() || shopName.trim().length < 2) {
      setError('Please enter your shop name (at least 2 characters).')
      return
    }

    if (!slug.trim()) {
      setError('Please enter a shop URL slug.')
      return
    }

    if (slugStatus && !slugStatus.available) {
      setError(slugStatus.reason || 'Please choose an available URL slug.')
      return
    }

    setSubmitting(true)
    try {
      await createBusiness({
        name: shopName,
        slug,
        gstin,
        address,
      })
      await refreshMembership()
      navigate('/admin', { replace: true })
    } catch (err: any) {
      setError(err?.message || 'Unable to create your shop. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const isStep2 = Boolean(user && !membership && !hasMultipleMemberships)

  return (
    <div className="min-h-screen bg-[#f8f7f4] flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-stone-900">
      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-900 mb-6 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Kala Home
        </Link>

        <KalaLogo
          size="lg"
          subtitle="Wholesale Operations Portal"
        />
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-white py-8 px-6 shadow-2xs border border-stone-200/80 rounded-xl sm:px-10">
          {emailConfirmationSent && !user ? (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-start gap-2.5 text-emerald-800 text-xs font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
                <div>
                  <p className="font-bold text-sm text-emerald-900">Confirm your email</p>
                  <p className="mt-1 leading-relaxed">
                    We sent a confirmation link to <strong>{email}</strong>. Open the link in your inbox, then sign in to finish creating your shop.
                  </p>
                </div>
              </div>
              <Link to="/login" className="block">
                <Button className="w-full bg-orange-700 hover:bg-orange-800 text-white font-semibold h-11 text-sm">
                  Go to Sign In
                </Button>
              </Link>
            </div>
          ) : isStep2 ? (
            <>
              <div className="mb-6">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-orange-700">Step 2 of 2</p>
                <h2 className="text-lg font-bold text-stone-900 mt-0.5">Create Your Shop</h2>
                <p className="text-xs text-stone-500 mt-1">
                  Set up your wholesale business profile, permanent QR catalog URL, and default Godown &amp; Shop Floor inventory locations.
                </p>
              </div>

              {error && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3.5 flex items-start gap-2.5 text-red-700 text-xs font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>{error}</div>
                </div>
              )}

              <form onSubmit={handleCreateShopSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="shop-name">Shop / Business Name *</Label>
                  <div className="relative">
                    <Store className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      id="shop-name"
                      type="text"
                      required
                      placeholder="e.g. Shree Laxmi Textiles"
                      value={shopName}
                      onChange={(e) => setShopName(e.target.value)}
                      disabled={submitting}
                      className="pl-9 bg-stone-50/70"
                      maxLength={120}
                      autoFocus
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="shop-slug">Shop URL Slug *</Label>
                  <div className="relative">
                    <Link2 className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      id="shop-slug"
                      type="text"
                      required
                      placeholder="e.g. shree-laxmi"
                      value={slug}
                      onChange={(e) => {
                        setSlugManuallyEdited(true)
                        setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                      }}
                      disabled={submitting}
                      className="pl-9 bg-stone-50/70 font-mono text-xs"
                      maxLength={48}
                    />
                  </div>
                  <div className="text-[11px] flex items-center justify-between">
                    <span className="text-stone-500 font-mono truncate">
                      /{slug || 'your-shop'}/p/DESIGN
                    </span>
                    {checkingSlug ? (
                      <span className="text-stone-400">Checking...</span>
                    ) : slugStatus ? (
                      slugStatus.available ? (
                        <span className="text-emerald-700 font-semibold">Available</span>
                      ) : (
                        <span className="text-red-600 font-semibold">{slugStatus.reason || 'Unavailable'}</span>
                      )
                    ) : null}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="shop-gstin">GSTIN (Optional)</Label>
                  <div className="relative">
                    <FileText className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      id="shop-gstin"
                      type="text"
                      placeholder="e.g. 24ABCDE1234F1Z5"
                      value={gstin}
                      onChange={(e) => setGstin(e.target.value.toUpperCase())}
                      disabled={submitting}
                      className="pl-9 bg-stone-50/70 font-mono text-xs"
                      maxLength={20}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="shop-address">Business Address (Optional)</Label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-stone-400 absolute left-3 top-3" />
                    <textarea
                      id="shop-address"
                      rows={2}
                      placeholder="Ring Road Textile Market, Surat"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      disabled={submitting}
                      maxLength={500}
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-stone-300 bg-stone-50/70 focus:outline-none focus:ring-2 focus:ring-orange-600/20 focus:border-orange-700"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={submitting || checkingSlug || (slugStatus !== null && !slugStatus.available)}
                  className="w-full bg-orange-700 hover:bg-orange-800 text-white font-semibold h-11 text-sm mt-2"
                >
                  {submitting ? 'Creating Shop...' : 'Create Your Shop'}
                </Button>
              </form>
            </>
          ) : (
            <>
              <div className="mb-6">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-orange-700">Step 1 of 2</p>
                <h2 className="text-lg font-bold text-stone-900 mt-0.5">Create Your Account</h2>
                <p className="text-xs text-stone-500 mt-1">
                  Sign up with your email and password, then configure your wholesale shop.
                </p>
              </div>

              {error && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3.5 flex items-start gap-2.5 text-red-700 text-xs font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>{error}</div>
                </div>
              )}

              <form onSubmit={handleAccountSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="signup-email">Email Address</Label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      id="signup-email"
                      type="email"
                      required
                      placeholder="owner@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={submitting}
                      className="pl-9 bg-stone-50/70"
                      autoComplete="email"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="signup-password">Password</Label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      id="signup-password"
                      type="password"
                      required
                      placeholder="Minimum 6 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={submitting}
                      className="pl-9 bg-stone-50/70"
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="signup-confirm-password">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      id="signup-confirm-password"
                      type="password"
                      required
                      placeholder="Re-enter password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={submitting}
                      className="pl-9 bg-stone-50/70"
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-orange-700 hover:bg-orange-800 text-white font-semibold h-11 text-sm mt-2"
                >
                  {submitting ? 'Creating Account...' : 'Continue to Shop Setup'}
                </Button>
              </form>
            </>
          )}

          <div className="mt-6 pt-4 border-t border-stone-100 space-y-3 text-xs text-stone-500">
            <div className="text-center">
              Already have an account?{' '}
              <Link to="/login" className="font-semibold text-orange-700 hover:text-orange-800 hover:underline">
                Sign in
              </Link>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                Protected by Supabase Auth &amp; Tenant RLS
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
