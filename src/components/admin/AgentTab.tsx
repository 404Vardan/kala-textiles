import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { fetchAgents, createAgent, updateAgent, deleteAgent } from '@/services/agents'
import type { Agent } from '@/types'
import { Plus, Trash2, Edit2, Search, UserCheck, Phone, MapPin, CheckCircle2, XCircle } from 'lucide-react'

export default function AgentTab() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Form fields
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [station, setStation] = useState('')
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    loadAgents()
  }, [])

  const loadAgents = async () => {
    setLoading(true)
    try {
      const data = await fetchAgents()
      setAgents(data)
    } catch (err: any) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const openCreateModal = () => {
    setEditingAgent(null)
    setName('')
    setPhone('')
    setStation('')
    setIsActive(true)
    setError('')
    setShowModal(true)
  }

  const openEditModal = (agent: Agent) => {
    setEditingAgent(agent)
    setName(agent.name)
    setPhone(agent.phone || '')
    setStation(agent.station || '')
    setIsActive(agent.is_active ?? true)
    setError('')
    setShowModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')

    try {
      if (editingAgent) {
        const updated = await updateAgent(editingAgent.id, {
          name: name.trim(),
          phone: phone.trim() || null,
          station: station.trim() || null,
          is_active: isActive,
        })
        setAgents(agents.map(a => (a.id === updated.id ? updated : a)))
      } else {
        const created = await createAgent({
          name: name.trim(),
          phone: phone.trim() || null,
          station: station.trim() || null,
          is_active: isActive,
        })
        setAgents([created, ...agents])
      }
      setShowModal(false)
    } catch (err: any) {
      setError(err?.message || 'Failed to save agent')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteAgent(deleteId)
      setAgents(agents.filter(a => a.id !== deleteId))
      setDeleteId(null)
    } catch (err: any) {
      alert(`Error deleting agent: ${err?.message || 'Unknown error'}`)
    }
  }

  const filteredAgents = agents.filter(a => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      a.name.toLowerCase().includes(q) ||
      (a.station && a.station.toLowerCase().includes(q)) ||
      (a.phone && a.phone.includes(q))
    )
  })

  return (
    <div className="space-y-6">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search agent, station, phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-slate-50 border-slate-200"
          />
        </div>
        <Button onClick={openCreateModal} className="bg-slate-900 hover:bg-slate-800 text-white shrink-0">
          <Plus className="w-4 h-4 mr-1.5" /> Add Agent
        </Button>
      </div>

      {/* Directory Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 text-xs font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Agent Name</th>
                <th className="px-4 py-3 text-left">Station</th>
                <th className="px-4 py-3 text-left">Contact Number</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-400">Loading agent directory...</td>
                </tr>
              ) : filteredAgents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <UserCheck className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    No agents registered yet. Click "Add Agent" to register an agent.
                  </td>
                </tr>
              ) : (
                filteredAgents.map((agent) => (
                  <tr key={agent.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-900">{agent.name}</td>
                    <td className="px-4 py-3 text-slate-700 font-medium">
                      {agent.station ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" /> {agent.station}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                      {agent.phone ? (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="w-3 h-3 text-slate-400" /> {agent.phone}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {agent.is_active ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                          <XCircle className="w-3 h-3" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(agent)}
                          className="h-8 w-8 p-0 text-slate-600 hover:text-slate-900"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(agent.id)}
                          className="h-8 w-8 p-0 text-rose-500 hover:text-rose-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Form */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{editingAgent ? 'Edit Agent' : 'Add New Agent'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-2">
            {error && (
              <p className="text-xs font-semibold text-rose-600 bg-rose-50 p-2.5 rounded border border-rose-200">{error}</p>
            )}
            <div className="space-y-1.5">
              <Label>Agent Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ramesh Bhai"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Station / Base</Label>
                <Input
                  value={station}
                  onChange={(e) => setStation(e.target.value)}
                  placeholder="e.g. Mumbai, Surat"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone Number</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 9825000000"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="is-active-check"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 text-orange-600 rounded border-slate-300"
              />
              <Label htmlFor="is-active-check" className="cursor-pointer text-sm font-medium text-slate-700">
                Agent is currently active
              </Label>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()} className="bg-slate-900 hover:bg-slate-800 text-white">
                {saving ? 'Saving...' : editingAgent ? 'Update Agent' : 'Register Agent'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Agent</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this agent from the directory? Existing order records mentioning this agent name will not be altered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700">
              Delete
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
