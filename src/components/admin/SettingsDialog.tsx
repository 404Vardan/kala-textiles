import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchAdminSettings, updateBusinessWhatsappNumber, updateUserPassword } from '@/services/adminSettings'
import { CheckCircle2, AlertCircle, Phone, Lock } from 'lucide-react'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [whatsapp, setWhatsapp] = useState('')

  const [passwordLoading, setPasswordLoading] = useState(false)
  const [whatsappLoading, setWhatsappLoading] = useState(false)
  const [loadingSettings, setLoadingSettings] = useState(false)

  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let active = true
    setError('')
    setMessage('')
    setLoadingSettings(true)

    fetchAdminSettings()
      .then((settings) => {
        if (!active) return
        setWhatsapp(settings.whatsapp_number || '')
      })
      .catch(() => {
        // Non-blocking if settings haven't been initialized yet
      })
      .finally(() => {
        if (active) setLoadingSettings(false)
      })

    return () => {
      active = false
    }
  }, [open])

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }

    setPasswordLoading(true)

    try {
      await updateUserPassword(newPassword)
      setMessage('Account password updated successfully.')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setError(err?.message || 'Failed to update account password.')
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleUpdateWhatsapp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setWhatsappLoading(true)

    try {
      const saved = await updateBusinessWhatsappNumber(whatsapp)
      setWhatsapp(saved || '')
      setMessage('Business WhatsApp contact number saved.')
    } catch (err: any) {
      setError(err?.message || 'Failed to update WhatsApp number')
    } finally {
      setWhatsappLoading(false)
    }
  }

  const isBusy = passwordLoading || whatsappLoading

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-stone-900">
            Business & Account Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {error && (
            <div className="flex items-center gap-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-3.5 py-2.5 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {message && (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>{message}</span>
            </div>
          )}

          {/* Business WhatsApp Contact */}
          <form
            onSubmit={handleUpdateWhatsapp}
            className="p-4 rounded-xl border border-stone-200/80 bg-stone-50/60 space-y-3"
          >
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                <Phone className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-stone-900">Business WhatsApp Contact</h3>
                <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
                  Used on buyer QR order review screens so customers can share their order request directly with your shop on WhatsApp.
                </p>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <Label htmlFor="settings-whatsapp">WhatsApp Number (with country code)</Label>
              <div className="flex gap-2">
                <Input
                  id="settings-whatsapp"
                  placeholder={loadingSettings ? 'Loading...' : '+91 98765 43210'}
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  disabled={isBusy || loadingSettings}
                  className="bg-white"
                />
                <Button
                  type="submit"
                  disabled={isBusy || loadingSettings || !whatsapp.trim()}
                  className="bg-stone-900 hover:bg-stone-800 text-white shrink-0"
                >
                  {whatsappLoading ? 'Saving...' : 'Save Number'}
                </Button>
              </div>
            </div>
          </form>

          {/* Change Auth Password */}
          <form
            onSubmit={handleChangePassword}
            className="p-4 rounded-xl border border-stone-200/80 bg-stone-50/60 space-y-3.5"
          >
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 flex items-center justify-center shrink-0 mt-0.5">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-stone-900">Update Account Password</h3>
                <p className="text-xs text-stone-500 mt-0.5">
                  Change the password for your currently signed-in account.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-pw">New Password</Label>
              <Input
                id="new-pw"
                type="password"
                placeholder="Minimum 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={isBusy}
                className="bg-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-pw">Confirm New Password</Label>
              <Input
                id="confirm-pw"
                type="password"
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isBusy}
                className="bg-white"
              />
            </div>

            <div className="flex justify-end pt-1">
              <Button
                type="submit"
                disabled={isBusy || !newPassword || !confirmPassword}
                className="bg-orange-700 hover:bg-orange-800 text-white"
              >
                {passwordLoading ? 'Updating...' : 'Update Password'}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
