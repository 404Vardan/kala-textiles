import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/AuthContext'
import { fetchAdminSettings, updateBusinessWhatsappNumber, updateUserPassword } from '@/services/adminSettings'
import {
  listBusinessMembers,
  inviteTeamMember,
  updateMemberRole,
  removeBusinessMember,
  type TeamMember,
} from '@/services/team'
import type { UserRole } from '@/types'
import { CheckCircle2, AlertCircle, UserPlus, Trash2 } from 'lucide-react'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { user, isOwner } = useAuth()

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [whatsapp, setWhatsapp] = useState('')

  const [passwordLoading, setPasswordLoading] = useState(false)
  const [whatsappLoading, setWhatsappLoading] = useState(false)
  const [loadingSettings, setLoadingSettings] = useState(false)

  const [members, setMembers] = useState<TeamMember[]>([])
  const [loadingTeam, setLoadingTeam] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('staff')
  const [inviting, setInviting] = useState(false)
  const [memberActionId, setMemberActionId] = useState<string | null>(null)

  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadTeam = useCallback(async () => {
    if (!isOwner) return
    setLoadingTeam(true)
    try {
      const list = await listBusinessMembers()
      setMembers(list)
    } catch (err: any) {
      setError(err?.message || 'Unable to load team members.')
    } finally {
      setLoadingTeam(false)
    }
  }, [isOwner])

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
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingSettings(false)
      })

    if (isOwner) {
      void loadTeam()
    }

    return () => {
      active = false
    }
  }, [open, isOwner, loadTeam])

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

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')

    const cleanEmail = inviteEmail.trim().toLowerCase()
    if (!cleanEmail) {
      setError('Please enter an email address to invite.')
      return
    }

    setInviting(true)
    try {
      const res = await inviteTeamMember(cleanEmail, inviteRole)
      setInviteEmail('')
      setInviteRole('staff')
      setMessage(
        res.invited
          ? `Invitation email sent to ${res.email} (${res.role}).`
          : `${res.email} has been added to your team (${res.role}).`
      )
      await loadTeam()
    } catch (err: any) {
      setError(err?.message || 'Failed to invite team member.')
    } finally {
      setInviting(false)
    }
  }

  const handleRoleChange = async (member: TeamMember, nextRole: UserRole) => {
    if (member.role === nextRole) return
    setError('')
    setMessage('')
    setMemberActionId(member.user_id)
    try {
      await updateMemberRole(member.user_id, nextRole)
      setMessage(`Updated ${member.email || 'member'} to ${nextRole}.`)
      await loadTeam()
    } catch (err: any) {
      setError(err?.message || 'Failed to update member role.')
    } finally {
      setMemberActionId(null)
    }
  }

  const handleRemoveMember = async (member: TeamMember) => {
    setError('')
    setMessage('')
    setMemberActionId(member.user_id)
    try {
      await removeBusinessMember(member.user_id)
      setMessage(`Removed ${member.email || 'member'} from your team.`)
      await loadTeam()
    } catch (err: any) {
      setError(err?.message || 'Failed to remove team member.')
    } finally {
      setMemberActionId(null)
    }
  }

  const ownerCount = members.filter((m) => m.role === 'owner').length
  const isBusy = passwordLoading || whatsappLoading || inviting || memberActionId !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Business &amp; Account Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {error && (
            <div className="flex items-center gap-2 text-xs font-medium text-[#B42318] bg-white border border-[#B42318] px-3 py-2.5 rounded-[6px]">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {message && (
            <div className="flex items-center gap-2 text-xs font-medium text-[#1F7A4D] bg-white border border-[#1F7A4D] px-3 py-2.5 rounded-[6px]">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{message}</span>
            </div>
          )}

          {/* Business WhatsApp Contact */}
          <form
            onSubmit={handleUpdateWhatsapp}
            className="p-4 rounded-[6px] border border-[#E3E5EA] bg-white space-y-3"
          >
            <div>
              <h3 className="font-semibold text-sm text-[#1A1D24]">Business WhatsApp Contact</h3>
              <p className="text-xs text-[#667085] mt-0.5">
                Used on buyer QR order review screens for direct WhatsApp sharing.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-whatsapp">WhatsApp Number (with country code)</Label>
              <div className="flex gap-2">
                <Input
                  id="settings-whatsapp"
                  placeholder={loadingSettings ? 'Loading...' : '+91 98765 43210'}
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  disabled={isBusy || loadingSettings}
                />
                <Button
                  type="submit"
                  disabled={isBusy || loadingSettings || !whatsapp.trim()}
                  className="shrink-0"
                >
                  {whatsappLoading ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          </form>

          {/* Team Management (Owner Only) */}
          {isOwner && (
            <div className="p-4 rounded-[6px] border border-[#E3E5EA] bg-white space-y-4">
              <div>
                <h3 className="font-semibold text-sm text-[#1A1D24]">Team Members</h3>
                <p className="text-xs text-[#667085] mt-0.5">
                  Invite staff or co-owners by email and manage business roles.
                </p>
              </div>

              <form onSubmit={handleInviteMember} className="space-y-1.5">
                <Label htmlFor="invite-email">Invite Team Member</Label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="staff@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    disabled={isBusy}
                    className="flex-1"
                  />
                  <select
                    aria-label="Invite role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as UserRole)}
                    disabled={isBusy}
                    className="h-9 bg-white border border-[#E3E5EA] rounded-[6px] px-2.5 text-xs font-medium text-[#1A1D24]"
                  >
                    <option value="staff">Staff</option>
                    <option value="owner">Owner</option>
                  </select>
                  <Button
                    type="submit"
                    disabled={isBusy || !inviteEmail.trim()}
                    className="shrink-0"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>{inviting ? 'Inviting...' : 'Invite'}</span>
                  </Button>
                </div>
              </form>

              <div className="pt-1">
                {loadingTeam ? (
                  <p className="text-xs text-[#667085]">Loading team members...</p>
                ) : members.length === 0 ? (
                  <p className="text-xs text-[#667085]">No team members found.</p>
                ) : (
                  <div className="divide-y divide-[#E3E5EA] rounded-[6px] border border-[#E3E5EA] overflow-hidden">
                    {members.map((m) => {
                      const isLastOwner = m.role === 'owner' && ownerCount <= 1
                      const isSelf = m.user_id === user?.id
                      const rowBusy = memberActionId === m.user_id

                      return (
                        <div
                          key={m.user_id}
                          className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs bg-white"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-[#1A1D24] truncate">
                              {m.email || m.user_id}
                              {isSelf && (
                                <span className="ml-1.5 text-[11px] text-[#667085]">(You)</span>
                              )}
                            </p>
                            {!m.email_confirmed_at && (
                              <p className="text-[11px] text-[#8A580F]">Invite pending</p>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <select
                              aria-label={`Role for ${m.email}`}
                              value={m.role}
                              onChange={(e) => handleRoleChange(m, e.target.value as UserRole)}
                              disabled={isBusy || rowBusy || isLastOwner}
                              title={isLastOwner ? 'Cannot demote the last owner' : 'Change role'}
                              className="h-8 bg-white border border-[#E3E5EA] rounded-[6px] px-2 text-xs font-medium text-[#1A1D24] disabled:opacity-50"
                            >
                              <option value="owner">Owner</option>
                              <option value="staff">Staff</option>
                            </select>

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={isBusy || rowBusy || isLastOwner}
                              title={isLastOwner ? 'Cannot remove the last owner' : 'Remove member'}
                              onClick={() => handleRemoveMember(m)}
                              className="h-8 w-8 p-0 text-[#B42318] disabled:opacity-40"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Change Auth Password */}
          <form
            onSubmit={handleChangePassword}
            className="p-4 rounded-[6px] border border-[#E3E5EA] bg-white space-y-3"
          >
            <div>
              <h3 className="font-semibold text-sm text-[#1A1D24]">Update Account Password</h3>
              <p className="text-xs text-[#667085] mt-0.5">
                Change the password for your signed-in account.
              </p>
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
              />
            </div>

            <div className="flex justify-end pt-1">
              <Button
                type="submit"
                disabled={isBusy || !newPassword || !confirmPassword}
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
