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
import { verifyAdminPassword } from '@/hooks/useAdminAuth'

interface PasswordModalProps {
  isOpen: boolean
  onSuccess: () => void
  onClose?: () => void
}

export function PasswordModal({ isOpen, onSuccess, onClose }: PasswordModalProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const isValid = await verifyAdminPassword(password.trim())
      if (isValid) {
        onSuccess()
        setPassword('')
      } else {
        setError('Incorrect administrator password')
      }
    } catch (err: any) {
      setError(err?.message || 'Verification failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && onClose) onClose() }}>
      <DialogContent className="sm:max-w-[400px]" onInteractOutside={(e) => { if (!onClose) e.preventDefault() }}>
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Admin Portal</DialogTitle>
          <DialogDescription>
            Enter administrative credentials to access management tools
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-3">
          <div className="space-y-2">
            <Label htmlFor="admin-password">Password</Label>
            <Input
              id="admin-password"
              type="password"
              placeholder="Enter admin password"
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
            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium"
            disabled={loading || !password.trim()}
          >
            {loading ? 'Verifying...' : 'Unlock Dashboard'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
