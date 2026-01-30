'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRouter } from 'next/navigation'

type Repair = {
  id: number
  listing_id: string
  item_name: string
  price: number
  quantity: number
  date_sold: string
  source: string
}

export default function Home() {
  const router = useRouter()

  const [mounted, setMounted] = useState(false)
  const [sessionChecked, setSessionChecked] = useState(false)

  const [repairs, setRepairs] = useState<Repair[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Partial<Repair>>({})

  const [filterPeriod, setFilterPeriod] =
    useState<'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear' | 'custom'>('thisMonth')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const [manual, setManual] = useState({
    listing_id: '',
    item_name: '',
    price: '',
    quantity: '',
    date_sold: '',
  })

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.push('/login')
      else setSessionChecked(true)
    })
  }, [router])

  const fetchRepairs = async () => {
    const { data } = await supabase
      .from('repairs')
      .select('*')
      .order('date_sold', { ascending: false })
    setRepairs(data || [])
  }

  useEffect(() => {
    if (sessionChecked) fetchRepairs()
  }, [sessionChecked])

  const parseDateDMY = (str: string) => {
    if (!/\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) return null
    const [d, m, y] = str.split('/')
    const date = new Date(Date.UTC(+y, +m - 1, +d))
    return isNaN(date.getTime()) ? null : date
  }

  const filtered = repairs.filter(r => {
    const d = new Date(r.date_sold)
    const now = new Date()
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth()

    if (filterPeriod === 'thisMonth')
      return y === now.getUTCFullYear() && m === now.getUTCMonth()

    if (filterPeriod === 'lastMonth') {
      const lm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1))
      return y === lm.getUTCFullYear() && m === lm.getUTCMonth()
    }

    if (filterPeriod === 'thisYear') return y === now.getUTCFullYear()
    if (filterPeriod === 'lastYear') return y === now.getUTCFullYear() - 1

    if (filterPeriod === 'custom' && customStart && customEnd) {
      const s = new Date(customStart)
      const e = new Date(customEnd)
      e.setHours(23, 59, 59, 999)
      return d >= s && d <= e
    }

    return true
  })

  const keyItems = ['Nintendo', 'Playstation', 'Xbox', 'iPad', 'Laptop']

  const totals = keyItems.map(item => {
    const rows = filtered.filter(r =>
      r.item_name.toLowerCase().includes(item.toLowerCase())
    )
    return {
      item,
      totalCount: rows.reduce((s, r) => s + r.quantity, 0),
      totalAmount: rows.reduce((s, r) => s + r.price, 0),
    }
  })

  const allTotalCount = filtered.reduce((s, r) => s + r.quantity, 0)
  const allTotalAmount = filtered.reduce((s, r) => s + r.price, 0)

  const handleCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setSelectedFile(file)
    setLoading(true)

    try {
      const buffer = await file.arrayBuffer()
      let text = new TextDecoder('utf-8').decode(buffer)

      const lines = text.split(/\r?\n/).filter(Boolean)
      const headers = lines[0].split(',')
      const rows = lines.slice(1).map(l => {
        const v = l.split(',')
        const o: any = {}
        headers.forEach((h, i) => (o[h.trim()] = v[i]?.trim()))
        return o
      })

      const mapped = rows
        .map(r => {
          const date = parseDateDMY(r['Sale date'])
          if (!date) return null
          return {
            listing_id: r['Order number'],
            item_name: r['Item title'],
            quantity: Number(r['Quantity'] || 1),
            price: Number(String(r['Total price']).replace(/[^\d.-]/g, '')),
            date_sold: date.toISOString(),
            source: 'csv',
          }
        })
        .filter(Boolean) as Repair[]

      const unique = Array.from(
        new Map(mapped.map(r => [r.listing_id, r])).values()
      )

      await supabase.from('repairs').upsert(unique, {
        onConflict: 'listing_id',
        ignoreDuplicates: true,
      })

      await fetchRepairs()
    } finally {
      setLoading(false)
    }
  }

  const saveEdit = async (id: number) => {
    await supabase.from('repairs').update(editForm).eq('id', id)
    setEditingId(null)
    fetchRepairs()
  }

  const deleteRepair = async (id: number) => {
    if (!confirm('Delete this repair?')) return
    await supabase.from('repairs').delete().eq('id', id)
    fetchRepairs()
  }

  if (!mounted || !sessionChecked) return null

  return (
    <main className="p-6 space-y-8 bg-gray-50">

      {/* CSV Upload */}
      <div className="bg-white p-4 rounded shadow max-w-md mx-auto">
        <label className="inline-flex items-center gap-3 cursor-pointer">
          <input type="file" accept=".csv" onChange={handleCSV} className="hidden" />
          <span className="border bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded shadow-sm active:scale-95 transition">
            Choose file
          </span>
          {selectedFile && (
            <span className="text-sm text-gray-600 truncate max-w-[200px]">
              {selectedFile.name}
            </span>
          )}
        </label>
        {loading && <p className="text-sm text-gray-500 mt-2">Processing…</p>}
      </div>

      {/* Totals */}
      <div className="bg-white p-6 rounded shadow space-y-4">
        <div className="bg-blue-100 p-6 rounded text-center">
          <div className="text-4xl font-bold text-blue-900">{allTotalCount}</div>
          <div className="text-xl font-semibold">All Items</div>
          <div className="text-base text-gray-600">£{allTotalAmount.toFixed(2)}</div>
        </div>

        <div className="flex flex-wrap gap-4 justify-center">
          {totals.map(t => (
            <div key={t.item} className="bg-gray-50 p-4 rounded shadow text-center">
              <div className="text-2xl font-semibold text-blue-900">{t.totalCount}</div>
              <div className="text-base font-medium">{t.item}</div>
              <div className="text-sm text-gray-600">£{t.totalAmount.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto bg-white rounded shadow">
        <table className="w-full border-collapse">
          <thead className="bg-blue-900 text-white">
            <tr>
              {['Date', 'Item', 'Order', 'Qty', 'Price', 'Actions'].map(h => (
                <th key={h} className="px-3 py-2 border">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {repairs.map(r => (
              <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                <td className="border px-3 py-3">{r.date_sold.slice(0, 10)}</td>
                <td className="border px-3 py-3">{r.item_name}</td>
                <td className="border px-3 py-3">{r.listing_id}</td>
                <td className="border px-3 py-3 text-center">{r.quantity}</td>
                <td className="border px-3 py-3">£{r.price.toFixed(2)}</td>
                <td className="border px-3 py-3">
                  <div className="flex gap-1">
                    <button
                      onClick={() => deleteRepair(r.id)}
                      className="bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 text-sm rounded"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </main>
  )
}
