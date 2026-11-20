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
import { AlertCircle, CheckCircle2 } from 'lucide-react'

export default function SignupPage() {
  const { user, membership, isOwner, isStaff, hasMultipleMemberships, loading: authLoading, signUp, refreshMembership } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [emailConfirmationSent, setEmailConfirmationSent] = useState(false)

  const [shopName, setShopName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const [gstin, setGstin] = useState('')
  const [address, setAddress] = useState('')

  const [slugStatus, setSlugStatus] = useState<SlugAvailabilityResult | null>(null)
  const [checkingSlug, setCheckingSlug] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

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

  useEffect(() => {
    if (!slugManuallyEdited) {
      setSlug(slugifyBusinessName(shopName))
    }
  }, [shopName, slugManuallyEdited])

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
    <div className="min-h-screen bg-[#F4F5F7] text-[#1A1D24] flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px] space-y-6">
        <div className="flex justify-center">
          <Link to="/" aria-label="Kala Home">
            <KalaLogo size="lg" />
          </Link>
        </div>

        <div className="bg-white border border-[#E3E5EA] rounded-[6px] p-6 sm:p-8">
          {emailConfirmationSent && !user ? (
            <div className="space-y-4">
              <div className="border border-[#1F7A4D] rounded-[6px] p-3.5 flex items-start gap-2.5 text-[#1F7A4D] text-xs font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">Confirm your email</p>
                  <p className="mt-1">
                    We sent a confirmation link to <strong>{email}</strong>. Open the link, then sign in to finish setting up your shop.
                  </p>
                </div>
              </div>
              <Link to="/login" className="block">
                <Button className="w-full h-10">Go to sign in</Button>
              </Link>
            </div>
          ) : isStep2 ? (
            <>
              <div className="mb-5">
                <p className="text-xs font-medium text-[#667085]">Step 2 of 2</p>
                <h1 className="text-lg font-semibold text-[#1A1D24] mt-0.5">Create your shop</h1>
                <p className="text-xs text-[#667085] mt-1">
                  Configure your business name, URL slug, GSTIN, and address.
                </p>
              </div>

              {error && (
                <div className="mb-4 border border-[#B42318] rounded-[6px] p-3 flex items-start gap-2 text-[#B42318] text-xs font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleCreateShopSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="shop-name">Shop name *</Label>
                  <Input
                    id="shop-name"
                    type="text"
                    required
                    placeholder="e.g. Shree Laxmi Textiles"
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    disabled={submitting}
                    maxLength={120}
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="shop-slug">Shop URL slug *</Label>
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
                    className="font-mono text-xs"
                    maxLength={48}
                  />
                  <div className="text-xs flex items-center justify-between gap-2">
                    <span className="text-[#667085] font-mono truncate">
                      /{slug || 'your-shop'}/p/DESIGN
                    </span>
                    {checkingSlug ? (
                      <span className="text-[#667085] shrink-0">Checking...</span>
                    ) : slugStatus ? (
                      slugStatus.available ? (
                        <span className="text-[#1F7A4D] font-medium shrink-0">Available</span>
                      ) : (
                        <span className="text-[#B42318] font-medium shrink-0">
                          {slugStatus.reason || 'Unavailable'}
                        </span>
                      )
                    ) : null}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="shop-gstin">GSTIN (Optional)</Label>
                  <Input
                    id="shop-gstin"
                    type="text"
                    placeholder="e.g. 24ABCDE1234F1Z5"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    disabled={submitting}
                    className="font-mono text-xs"
                    maxLength={20}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="shop-address">Address (Optional)</Label>
                  <textarea
                    id="shop-address"
                    rows={2}
                    placeholder="Ring Road Textile Market, Surat"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    disabled={submitting}
                    maxLength={500}
                    className="w-full px-3 py-2 text-sm rounded-[6px] border border-[#E3E5EA] bg-white text-[#1A1D24] placeholder:text-[#667085]"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={submitting || checkingSlug || (slugStatus !== null && !slugStatus.available)}
                  className="w-full h-10"
                >
                  {submitting ? 'Creating shop...' : 'Create your shop'}
                </Button>
              </form>
            </>
          ) : (
            <>
              <div className="mb-5">
                <p className="text-xs font-medium text-[#667085]">Step 1 of 2</p>
                <h1 className="text-lg font-semibold text-[#1A1D24] mt-0.5">Create your account</h1>
                <p className="text-xs text-[#667085] mt-1">
                  Register with your email and password, then set up your shop.
                </p>
              </div>

              {error && (
                <div className="mb-4 border border-[#B42318] rounded-[6px] p-3 flex items-start gap-2 text-[#B42318] text-xs font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleAccountSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    required
                    placeholder="owner@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    autoComplete="email"
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    required
                    placeholder="Minimum 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    autoComplete="new-password"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="signup-confirm-password">Confirm password</Label>
                  <Input
                    id="signup-confirm-password"
                    type="password"
                    required
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={submitting}
                    autoComplete="new-password"
                  />
                </div>

                <Button type="submit" disabled={submitting} className="w-full h-10">
                  {submitting ? 'Creating account...' : 'Continue'}
                </Button>
              </form>
            </>
          )}

          <div className="mt-6 pt-4 border-t border-[#E3E5EA] text-center text-xs text-[#667085]">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-[#1E2A4A] hover:underline">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
