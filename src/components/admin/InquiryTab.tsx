import { useEffect, useState } from 'react'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fetchInquiries, fetchInquiriesByStatus, updateInquiry } from '@/services/inquiries'
import type { Inquiry } from '@/types'
import { formatDate, formatCurrency, truncateText } from '@/utils/formatters'
import { MessageSquare } from 'lucide-react'

export default function InquiryTab() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [respondInquiry, setRespondInquiry] = useState<Inquiry | null>(null)

  // Respond form
  const [responseText, setResponseText] = useState('')
  const [quotedPrice, setQuotedPrice] = useState('')
  const [responding, setResponding] = useState(false)

  useEffect(() => {
    loadInquiries()
  }, [statusFilter])

  const loadInquiries = async () => {
    try {
      setLoading(true)
      if (statusFilter === 'all') {
        const data = await fetchInquiries()
        setInquiries(data)
      } else {
        const data = await fetchInquiriesByStatus(statusFilter)
        setInquiries(data)
      }
    } catch (error) {
      console.error('Error loading inquiries:', error)
    } finally {
      setLoading(false)
    }
  }

  const openRespond = (inquiry: Inquiry) => {
    setRespondInquiry(inquiry)
    setResponseText(inquiry.admin_response || '')
    setQuotedPrice(inquiry.quoted_price ? String(inquiry.quoted_price) : '')
  }

  const handleRespond = async () => {
    if (!respondInquiry) return
    setResponding(true)

    try {
      await updateInquiry(respondInquiry.id, {
        admin_response: responseText,
        quoted_price: quotedPrice ? parseFloat(quotedPrice) : undefined,
        status: 'quoted',
      })
      setRespondInquiry(null)
      await loadInquiries()
    } catch (error) {
      console.error('Error responding to inquiry:', error)
    } finally {
      setResponding(false)
    }
  }

  const handleMarkComplete = async (inquiry: Inquiry) => {
    try {
      await updateInquiry(inquiry.id, { status: 'completed' })
      await loadInquiries()
    } catch (error) {
      console.error('Error updating inquiry:', error)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-10">Loading inquiries...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="quoted">Quoted</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg overflow-x-auto bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Phone</th>
              <th className="px-4 py-3 text-left font-medium">Design No</th>
              <th className="px-4 py-3 text-left font-medium">Message</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Price</th>
              <th className="px-4 py-3 text-left font-medium">Date</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {inquiries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  No inquiries found
                </td>
              </tr>
            ) : (
              inquiries.map((inquiry) => (
                <tr key={inquiry.id} className="hover:bg-orange-50/50">
                  <td className="px-4 py-3 font-medium">{inquiry.customer_name}</td>
                  <td className="px-4 py-3">{inquiry.phone}</td>
                  <td className="px-4 py-3">{inquiry.design_no || '-'}</td>
                  <td className="px-4 py-3 max-w-[200px]">{truncateText(inquiry.message || '', 30)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium
                      ${inquiry.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : ''}
                      ${inquiry.status === 'quoted' ? 'bg-blue-100 text-blue-800' : ''}
                      ${inquiry.status === 'completed' ? 'bg-green-100 text-green-800' : ''}
                    `}>
                      {inquiry.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{inquiry.quoted_price ? formatCurrency(inquiry.quoted_price) : '-'}</td>
                  <td className="px-4 py-3 text-xs">{formatDate(inquiry.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openRespond(inquiry)}>
                        <MessageSquare className="w-4 h-4" />
                      </Button>
                      {inquiry.status === 'quoted' && (
                        <Button variant="ghost" size="sm" onClick={() => handleMarkComplete(inquiry)} className="text-green-600 text-xs">
                          ✓ Done
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Respond Dialog */}
      <Dialog open={respondInquiry !== null} onOpenChange={() => setRespondInquiry(null)}>
        <DialogContent className="sm:max-w-md">
          {respondInquiry && (
            <>
              <DialogHeader>
                <DialogTitle>Respond to Inquiry</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                  <p><span className="font-medium">From:</span> {respondInquiry.customer_name}</p>
                  <p><span className="font-medium">Phone:</span> {respondInquiry.phone}</p>
                  {respondInquiry.design_no && <p><span className="font-medium">Design:</span> {respondInquiry.design_no}</p>}
                  {respondInquiry.message && <p><span className="font-medium">Message:</span> {respondInquiry.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label>Quoted Price</Label>
                  <Input
                    type="number"
                    value={quotedPrice}
                    onChange={(e) => setQuotedPrice(e.target.value)}
                    placeholder="₹ Price per piece"
                    min="0"
                    step="0.01"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Response Message</Label>
                  <Input
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    placeholder="Your response..."
                  />
                </div>

                <Button
                  onClick={handleRespond}
                  className="w-full bg-orange-600 hover:bg-orange-700"
                  disabled={responding}
                >
                  {responding ? 'Sending...' : 'Send Response'}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
