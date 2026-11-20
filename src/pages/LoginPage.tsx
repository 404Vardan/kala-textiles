import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import supabase from '@/services/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KalaLogo } from '@/components/common/KalaLogo'
import { ArrowLeft, Lock, Mail, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react'

export default function LoginPage() {
  const { signIn, isOwner } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Forgot password state
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

      // Successful login -> Redirect to returnUrl or appropriate dashboard
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
          {forgotMode ? (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-bold text-stone-900">Forgot Password</h2>
                <p className="text-xs text-stone-500 mt-1">
                  Enter your account email and we will send you a link to reset your password.
                </p>
              </div>

              {error && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3.5 flex items-start gap-2.5 text-red-700 text-xs font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>{error}</div>
                </div>
              )}

              {resetSent && (
                <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-lg p-3.5 flex items-start gap-2.5 text-emerald-800 text-xs font-medium">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
                  <div>
                    If an account exists for <strong>{email.trim()}</strong>, a password reset link has been sent to your inbox.
                  </div>
                </div>
              )}

              <form onSubmit={handleResetRequest} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="reset-email">Email Address</Label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      id="reset-email"
                      type="email"
                      required
                      placeholder="owner@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      className="pl-9 bg-stone-50/70"
                      autoComplete="email"
                      autoFocus
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-orange-700 hover:bg-orange-800 text-white font-semibold h-11 text-sm mt-2"
                >
                  {loading ? 'Sending Reset Link...' : 'Send Reset Link'}
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setForgotMode(false)
                    setError('')
                    setResetSent(false)
                  }}
                  className="w-full text-center text-xs font-semibold text-stone-600 hover:text-stone-900 pt-1"
                >
                  Back to Sign In
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-bold text-stone-900">Sign In to Your Account</h2>
                <p className="text-xs text-stone-500 mt-1">
                  Enter your credentials to access owner administration or shop floor terminals.
                </p>
              </div>

              {error && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3.5 flex items-start gap-2.5 text-red-700 text-xs font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>{error}</div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email Address</Label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      id="email"
                      type="email"
                      required
                      placeholder="owner@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      className="pl-9 bg-stone-50/70"
                      autoComplete="email"
                      autoFocus
                    />
                  </div>
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
                      className="text-xs font-semibold text-orange-700 hover:text-orange-800 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      id="password"
                      type="password"
                      required
                      placeholder="••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      className="pl-9 bg-stone-50/70"
                      autoComplete="current-password"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-orange-700 hover:bg-orange-800 text-white font-semibold h-11 text-sm mt-2"
                >
                  {loading ? 'Signing In...' : 'Sign In'}
                </Button>
              </form>
            </>
          )}

          <div className="mt-6 pt-4 border-t border-stone-100 space-y-3 text-xs text-stone-500">
            <div className="text-center">
              New to Kala?{' '}
              <Link to="/signup" className="font-semibold text-orange-700 hover:text-orange-800 hover:underline">
                Create your shop
              </Link>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                Protected by Supabase Auth & Tenant RLS
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
