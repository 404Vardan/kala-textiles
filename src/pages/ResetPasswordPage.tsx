import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import supabase from '@/services/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KalaLogo } from '@/components/common/KalaLogo'
import { ArrowLeft, Lock, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react'

export default function ResetPasswordPage() {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [hasRecoverySession, setHasRecoverySession] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (active) {
        setHasRecoverySession(Boolean(session))
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setHasRecoverySession(Boolean(session))
      } else if (event === 'SIGNED_OUT') {
        setHasRecoverySession(false)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const { error: updateErr } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (updateErr) {
        setError(updateErr.message || 'Unable to reset password.')
        return
      }

      setSuccess(true)
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setError(err?.message || 'Unable to reset password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f7f4] flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-stone-900">
      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-900 mb-6 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
        </Link>

        <KalaLogo
          size="lg"
          subtitle="Wholesale Operations Portal"
        />
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-white py-8 px-6 shadow-2xs border border-stone-200/80 rounded-xl sm:px-10">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-stone-900">Reset Your Password</h2>
            <p className="text-xs text-stone-500 mt-1">
              Choose a new password for your Kala account.
            </p>
          </div>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3.5 flex items-start gap-2.5 text-red-700 text-xs font-medium">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          {success ? (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3.5 flex items-start gap-2.5 text-emerald-800 text-xs font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
                <div>Your password has been updated. You can now sign in with your new password.</div>
              </div>
              <Button
                type="button"
                onClick={() => navigate('/login', { replace: true })}
                className="w-full bg-orange-700 hover:bg-orange-800 text-white font-semibold h-11 text-sm"
              >
                Continue to Sign In
              </Button>
            </div>
          ) : hasRecoverySession === null ? (
            <div className="py-6 text-center text-xs text-stone-500">
              Verifying reset link...
            </div>
          ) : !hasRecoverySession ? (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 flex items-start gap-2.5 text-amber-800 text-xs font-medium">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  This password reset link is invalid or has expired. Please request a new reset link from the Sign In page.
                </div>
              </div>
              <Link to="/login" className="block">
                <Button variant="outline" className="w-full h-11 text-sm font-semibold">
                  Return to Sign In
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-new-password">New Password</Label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    id="reset-new-password"
                    type="password"
                    required
                    placeholder="Minimum 6 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={loading}
                    className="pl-9 bg-stone-50/70"
                    autoComplete="new-password"
                    autoFocus
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reset-confirm-password">Confirm New Password</Label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    id="reset-confirm-password"
                    type="password"
                    required
                    placeholder="Re-enter new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                    className="pl-9 bg-stone-50/70"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-orange-700 hover:bg-orange-800 text-white font-semibold h-11 text-sm mt-2"
              >
                {loading ? 'Updating Password...' : 'Update Password'}
              </Button>
            </form>
          )}

          <div className="mt-6 pt-4 border-t border-stone-100 flex items-center justify-between text-[11px] text-stone-500">
            <span className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
              Protected by Supabase Auth &amp; Tenant RLS
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
