import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import supabase from '@/services/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KalaLogo } from '@/components/common/KalaLogo'
import { AlertCircle, CheckCircle2 } from 'lucide-react'

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
    <div className="min-h-screen bg-[#F4F5F7] text-[#1A1D24] flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px] space-y-6">
        <div className="flex justify-center">
          <Link to="/" aria-label="Kala Home">
            <KalaLogo size="lg" />
          </Link>
        </div>

        <div className="bg-white border border-[#E3E5EA] rounded-[6px] p-6 sm:p-8">
          <div className="mb-5">
            <h1 className="text-lg font-semibold text-[#1A1D24]">Set a new password</h1>
            <p className="text-xs text-[#667085] mt-1">
              Choose a new password for your Kala account.
            </p>
          </div>

          {error && (
            <div className="mb-4 border border-[#B42318] rounded-[6px] p-3 flex items-start gap-2 text-[#B42318] text-xs font-medium">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success ? (
            <div className="space-y-4">
              <div className="border border-[#1F7A4D] rounded-[6px] p-3 flex items-start gap-2 text-[#1F7A4D] text-xs font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Your password has been updated.</span>
              </div>
              <Button
                type="button"
                onClick={() => navigate('/login', { replace: true })}
                className="w-full h-10"
              >
                Continue to sign in
              </Button>
            </div>
          ) : hasRecoverySession === null ? (
            <p className="py-4 text-center text-xs text-[#667085]">Verifying reset link...</p>
          ) : !hasRecoverySession ? (
            <div className="space-y-4">
              <div className="border border-[#B7791F] rounded-[6px] p-3 text-[#8A580F] text-xs font-medium">
                This password reset link is invalid or expired. Request a new link from the sign in page.
              </div>
              <Link to="/login" className="block">
                <Button variant="outline" className="w-full h-10">
                  Return to sign in
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-new-password">New password</Label>
                <Input
                  id="reset-new-password"
                  type="password"
                  required
                  placeholder="Minimum 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reset-confirm-password">Confirm new password</Label>
                <Input
                  id="reset-confirm-password"
                  type="password"
                  required
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                />
              </div>

              <Button type="submit" disabled={loading} className="w-full h-10">
                {loading ? 'Updating...' : 'Update password'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
