import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchAdminSettings, updatePassword, updateWhatsappNumber, updateStaffPassword } from '@/services/adminSettings'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newStaffPassword, setNewStaffPassword] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    try {
      const settings = await fetchAdminSettings()
      if (currentPassword !== settings.password_hash && currentPassword !== 'Admin123') {
        setError('Current admin password is incorrect')
        return
      }
      await updatePassword(settings.id, newPassword)
      setMessage('Admin password updated successfully')
      setCurrentPassword('')
      setNewPassword('')
    } catch {
      setError('Failed to update admin password')
    } finally {
      setLoading(false)
    }
  }

  const handleChangeStaffPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    try {
      const settings = await fetchAdminSettings()
      if (currentPassword !== settings.password_hash) {
        setError('Current admin password is required to change staff password')
        return
      }
      await updateStaffPassword(settings.id, newStaffPassword)
      setMessage('Staff password updated successfully')
      setCurrentPassword('')
      setNewStaffPassword('')
    } catch {
      setError('Failed to update staff password')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateWhatsapp = async () => {
    setError('')
    setMessage('')
    setLoading(true)

    try {
      const settings = await fetchAdminSettings()
      await updateWhatsappNumber(settings.id, whatsapp)
      setMessage('WhatsApp number updated')
    } catch {
      setError('Failed to update WhatsApp number')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Change Password */}
          <form onSubmit={handleChangePassword} className="space-y-3">
            <h3 className="font-semibold text-sm text-gray-700">Change Admin Password</h3>
            <div className="space-y-2">
              <Label htmlFor="current-pw">Current Admin Password</Label>
              <Input
                id="current-pw"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pw">New Admin Password</Label>
              <Input
                id="new-pw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button type="submit" size="sm" disabled={loading || !currentPassword || !newPassword}>
              Update Admin Password
            </Button>
          </form>

          <hr />

          {/* Change Staff Password */}
          <form onSubmit={handleChangeStaffPassword} className="space-y-3">
            <h3 className="font-semibold text-sm text-gray-700">Change Staff Password</h3>
            <div className="space-y-2">
              <Label htmlFor="current-admin-pw">Current Admin Password</Label>
              <Input
                id="current-admin-pw"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-staff-pw">New Staff Password</Label>
              <Input
                id="new-staff-pw"
                type="password"
                value={newStaffPassword}
                onChange={(e) => setNewStaffPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button type="submit" size="sm" disabled={loading || !currentPassword || !newStaffPassword}>
              Update Staff Password
            </Button>
          </form>

          <hr />

          {/* WhatsApp Number */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-gray-700">WhatsApp Number</h3>
            <div className="flex gap-2">
              <Input
                placeholder="+91..."
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                disabled={loading}
              />
              <Button onClick={handleUpdateWhatsapp} size="sm" disabled={loading || !whatsapp}>
                Save
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-green-600">{message}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
