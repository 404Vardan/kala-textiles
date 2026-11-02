import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { verifyStaffPassword } from '@/hooks/useStaffAuth'

interface StaffPasswordModalProps {
  isOpen: boolean
  onSuccess: () => void
  onClose: () => void
}

export function StaffPasswordModal({ isOpen, onSuccess, onClose }: StaffPasswordModalProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const isValid = await verifyStaffPassword(password.trim())
      if (isValid) {
        onSuccess()
        setPassword('')
      } else {
        setError('Incorrect staff access code')
      }
    } catch (err: any) {
      setError(err?.message || 'Verification failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Staff Access</DialogTitle>
          <DialogDescription>
            Enter staff passcode to access order entry & barcode scanning
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-3">
          <div className="space-y-2">
            <Label htmlFor="staff-password">Passcode</Label>
            <Input
              id="staff-password"
              type="password"
              placeholder="Enter staff passcode"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm font-medium text-red-600 bg-red-50 p-2 rounded border border-red-200">{error}</p>
          )}

          <Button
            type="submit"
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium"
            disabled={loading || !password.trim()}
          >
            {loading ? 'Verifying...' : 'Continue to Staff Terminal'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
