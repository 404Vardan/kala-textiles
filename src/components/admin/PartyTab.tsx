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
import { fetchParties, createParty, updateParty, deleteParty } from '@/services/parties'
import type { Party } from '@/types'
import { Plus, Trash2, Edit2, Search, Users, Phone, MapPin } from 'lucide-react'

export default function PartyTab() {
  const [parties, setParties] = useState<Party[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingParty, setEditingParty] = useState<Party | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Form fields
  const [name, setName] = useState('')
  const [station, setStation] = useState('')
  const [gstNumber, setGstNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')

  useEffect(() => {
    loadParties()
  }, [])

  const loadParties = async () => {
    setLoading(true)
    try {
      const data = await fetchParties()
      setParties(data)
    } catch (err: any) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const openCreateModal = () => {
    setEditingParty(null)
    setName('')
    setStation('')
    setGstNumber('')
    setPhone('')
    setAddress('')
    setError('')
    setShowModal(true)
  }

  const openEditModal = (party: Party) => {
    setEditingParty(party)
    setName(party.name)
    setStation(party.station || '')
    setGstNumber(party.gst_number || '')
    setPhone(party.phone || '')
    setAddress(party.address || '')
    setError('')
    setShowModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')

    try {
      if (editingParty) {
        const updated = await updateParty(editingParty.id, {
          name: name.trim(),
          station: station.trim() || null,
          gst_number: gstNumber.trim() || null,
          phone: phone.trim() || null,
          address: address.trim() || null,
        })
        setParties(parties.map(p => (p.id === updated.id ? updated : p)))
      } else {
        const created = await createParty({
          name: name.trim(),
          station: station.trim() || null,
          gst_number: gstNumber.trim() || null,
          phone: phone.trim() || null,
          address: address.trim() || null,
        })
        setParties([created, ...parties])
      }
      setShowModal(false)
    } catch (err: any) {
      setError(err?.message || 'Failed to save party record')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteParty(deleteId)
      setParties(parties.filter(p => p.id !== deleteId))
      setDeleteId(null)
    } catch (err: any) {
      alert(`Error deleting party: ${err?.message || 'Unknown error'}`)
    }
  }

  const filteredParties = parties.filter(p => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      (p.station && p.station.toLowerCase().includes(q)) ||
      (p.gst_number && p.gst_number.toLowerCase().includes(q)) ||
      (p.phone && p.phone.includes(q))
    )
  })

  return (
    <div className="space-y-6">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search party, station, GST..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-slate-50 border-slate-200"
          />
        </div>
        <Button onClick={openCreateModal} className="bg-slate-900 hover:bg-slate-800 text-white shrink-0">
          <Plus className="w-4 h-4 mr-1.5" /> Add Party
        </Button>
      </div>

      {/* Directory Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 text-xs font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Party Name</th>
                <th className="px-4 py-3 text-left">Station</th>
                <th className="px-4 py-3 text-left">GST Number</th>
                <th className="px-4 py-3 text-left">Phone</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-400">Loading party directory...</td>
                </tr>
              ) : filteredParties.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    No parties found. Click "Add Party" to register one.
                  </td>
                </tr>
              ) : (
                filteredParties.map((party) => (
                  <tr key={party.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-900">{party.name}</p>
                      {party.address && <p className="text-xs text-slate-500 truncate max-w-xs">{party.address}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-medium">
                      {party.station ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" /> {party.station}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{party.gst_number || '-'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {party.phone ? (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="w-3 h-3 text-slate-400" /> {party.phone}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(party)}
                          className="h-8 w-8 p-0 text-slate-600 hover:text-slate-900"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(party.id)}
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
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editingParty ? 'Edit Party' : 'Add New Party'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-2">
            {error && (
              <p className="text-xs font-semibold text-rose-600 bg-rose-50 p-2.5 rounded border border-rose-200">{error}</p>
            )}
            <div className="space-y-1.5">
              <Label>Party Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Radhika Sarees"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Station / City</Label>
                <Input
                  value={station}
                  onChange={(e) => setStation(e.target.value)}
                  placeholder="e.g. Surat, Ahmedabad"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone Number</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>GST Number</Label>
              <Input
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
                placeholder="24AAAAA0000A1Z5"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Shop number, market, road..."
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()} className="bg-slate-900 hover:bg-slate-800 text-white">
                {saving ? 'Saving...' : editingParty ? 'Update Party' : 'Register Party'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Party</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this party from the directory? Past orders associated with this party name will remain preserved.
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
