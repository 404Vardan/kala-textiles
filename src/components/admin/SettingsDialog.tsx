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

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [loading, setLoading] = useState(false)
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

    setLoading(true)

    try {
      await updateUserPassword(newPassword)
      setMessage('Account password updated successfully via Supabase Auth.')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setError(err?.message || 'Failed to update account password.')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateWhatsapp = async () => {
    setError('')
    setMessage('')
    setLoading(true)

    try {
      const saved = await updateBusinessWhatsappNumber(whatsapp)
      setWhatsapp(saved || '')
      setMessage('Business WhatsApp contact updated.')
    } catch (err: any) {
      setError(err?.message || 'Failed to update WhatsApp number')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Business & Account Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Change Auth Password */}
          <form onSubmit={handleChangePassword} className="space-y-3">
            <div>
              <h3 className="font-semibold text-sm text-gray-800">Update Account Password</h3>
              <p className="text-xs text-gray-500">Update your Supabase Auth session credentials.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pw">New Password</Label>
              <Input
                id="new-pw"
                type="password"
                placeholder="••••••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-pw">Confirm Password</Label>
              <Input
                id="confirm-pw"
                type="password"
                placeholder="••••••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button type="submit" size="sm" disabled={loading || !newPassword || !confirmPassword}>
              {loading ? 'Updating...' : 'Update Password'}
            </Button>
          </form>

          <hr />

          {/* WhatsApp Number */}
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold text-sm text-gray-800">Business WhatsApp Contact</h3>
              <p className="text-xs text-gray-500">
                Used on customer QR order review screens for direct WhatsApp order sharing.
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder={loadingSettings ? 'Loading...' : '+91 98765 43210'}
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                disabled={loading || loadingSettings}
              />
              <Button
                onClick={handleUpdateWhatsapp}
                size="sm"
                disabled={loading || loadingSettings || !whatsapp.trim()}
              >
                Save
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}
          {message && <p className="text-sm text-green-600 bg-green-50 p-2 rounded">{message}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
