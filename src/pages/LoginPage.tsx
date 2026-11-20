import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import supabase from '@/services/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KalaLogo } from '@/components/common/KalaLogo'
import { AlertCircle, CheckCircle2 } from 'lucide-react'

export default function LoginPage() {
  const { signIn, isOwner } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [forgotMode, setForgotMode] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnUrl = searchParams.get('returnUrl')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password.')
      return
    }

    setLoading(true)

    try {
      const { error: authError, role: resolvedRole } = await signIn(email, password)

      if (authError) {
        setError(authError.message || 'Invalid email or password.')
        setLoading(false)
        return
      }

      if (returnUrl) {
        navigate(returnUrl)
      } else if (resolvedRole === 'owner' || isOwner) {
        navigate('/admin')
      } else if (resolvedRole === 'staff') {
        navigate('/staff')
      } else {
        navigate('/signup')
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setResetSent(false)

    const cleanEmail = email.trim()
    if (!cleanEmail) {
      setError('Please enter your email address.')
      return
    }

    setLoading(true)
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (resetErr) {
        setError(resetErr.message || 'Unable to send password reset email.')
        return
      }

      setResetSent(true)
    } catch (err: any) {
      setError(err?.message || 'Unable to send password reset email. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7] text-[#1A1D24] flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px] space-y-6">
        <div className="flex justify-center">
          <Link to="/" aria-label="Kala Home">
            <KalaLogo size="lg" />
          </Link>
        </div>

        <div className="bg-white border border-[#E3E5EA] rounded-[6px] p-6 sm:p-8">
          {forgotMode ? (
            <>
              <div className="mb-5">
                <h1 className="text-lg font-semibold text-[#1A1D24]">Reset password</h1>
                <p className="text-xs text-[#667085] mt-1">
                  Enter your email address to receive a password reset link.
                </p>
              </div>

              {error && (
                <div className="mb-4 border border-[#B42318] rounded-[6px] p-3 flex items-start gap-2 text-[#B42318] text-xs font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {resetSent && (
                <div className="mb-4 border border-[#1F7A4D] rounded-[6px] p-3 flex items-start gap-2 text-[#1F7A4D] text-xs font-medium">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    If an account exists for <strong>{email.trim()}</strong>, a reset link has been sent.
                  </span>
                </div>
              )}

              <form onSubmit={handleResetRequest} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    required
                    placeholder="owner@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    autoComplete="email"
                    autoFocus
                  />
                </div>

                <Button type="submit" disabled={loading} className="w-full h-10">
                  {loading ? 'Sending...' : 'Send reset link'}
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setForgotMode(false)
                    setError('')
                    setResetSent(false)
                  }}
                  className="w-full text-center text-xs font-medium text-[#1E2A4A] hover:underline pt-1 cursor-pointer"
                >
                  Back to sign in
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="mb-5">
                <h1 className="text-lg font-semibold text-[#1A1D24]">Sign in to Kala</h1>
                <p className="text-xs text-[#667085] mt-1">
                  Enter your account email and password.
                </p>
              </div>

              {error && (
                <div className="mb-4 border border-[#B42318] rounded-[6px] p-3 flex items-start gap-2 text-[#B42318] text-xs font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    placeholder="owner@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    autoComplete="email"
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <button
                      type="button"
                      onClick={() => {
                        setForgotMode(true)
                        setError('')
                        setResetSent(false)
                      }}
                      className="text-xs font-medium text-[#1E2A4A] hover:underline cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    required
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    autoComplete="current-password"
                  />
                </div>

                <Button type="submit" disabled={loading} className="w-full h-10">
                  {loading ? 'Signing in...' : 'Sign in'}
                </Button>
              </form>
            </>
          )}

          <div className="mt-6 pt-4 border-t border-[#E3E5EA] text-center text-xs text-[#667085]">
            New to Kala?{' '}
            <Link to="/signup" className="font-semibold text-[#1E2A4A] hover:underline">
              Create your shop
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
