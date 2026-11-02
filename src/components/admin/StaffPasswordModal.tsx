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
import supabase from '@/services/supabase'

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
      const { data: adminData, error: fetchError } = await supabase
        .from('admin_settings')
        .select('staff_password')
        .limit(1)
        .single()

      if (fetchError) {
        setError('Failed to verify staff credentials')
        return
      }

      const validPassword = adminData.staff_password || 'staff123'
      if (password === validPassword) {
        onSuccess()
        setPassword('')
      } else {
        setError('Incorrect password')
      }
    } catch (err) {
      setError('An error occurred. Please try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Staff Login</DialogTitle>
          <DialogDescription>
            Enter the staff password to create an order
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="staff-password">Password</Label>
            <Input
              id="staff-password"
              type="password"
              placeholder="Enter staff password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <Button
            type="submit"
            className="w-full bg-orange-600 hover:bg-orange-700"
            disabled={loading || !password.trim()}
          >
            {loading ? 'Verifying...' : 'Login'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
