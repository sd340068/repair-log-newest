'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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
  const [repairs, setRepairs] = useState<Repair[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [filterPeriod, setFilterPeriod] = useState<'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear' | 'custom'>('thisMonth')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const [manual, setManual] = useState({
    listing_id: '',
    item_name: '',
    price: '',
    quantity: '',
    date_sold: '',
  })

  const fetchRepairs = async () => {
    const { data, error } = await supabase
      .from('repairs')
      .select('*')
      .order('date_sold', { ascending: false })
    if (error) console.error('Supabase fetch error:', error)
    else setRepairs(data || [])
  }

  useEffect(() => {
    fetchRepairs()
  }, [])

  const parseDateDMY = (str: string) => {
    if (!str || !/\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) return null
    const [day, month, year] = str.split('/')
    const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    return isNaN(d.getTime()) ? null : d
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setLoading(true)

    try {
      const Papa = (await import('papaparse')).default
      const arrayBuffer = await file.arrayBuffer()
      let text: string
      try {
        text = new TextDecoder('utf-16').decode(arrayBuffer)
        if (!text.includes('Order number')) throw new Error('UTF-16 parse failed')
      } catch {
        text = new TextDecoder('utf-8').decode(arrayBuffer)
      }

      const lines = text.split(/\r?\n/).filter(l => l.trim())
      if (lines.length < 2) {
        alert('CSV too short')
        setLoading(false)
        return
      }

      const delimiter = lines[0].includes('\t') ? '\t' : ','
      const headers = lines[0].split(delimiter).map(h => h.trim())
      const rows = lines.slice(1).map(line => {
        const values = line.split(delimiter).map(v => v.trim())
        const obj: any = {}
        headers.forEach((h, i) => {
          obj[h] = values[i] || ''
        })
        return obj
      })

      const mappedRows = rows
        .map(row => {
          const itemName = row['Item title']?.trim() || ''
          const date = parseDateDMY(row['Sale date'] || '')
          if (!date) return null
          return {
            listing_id: row['Order number']?.trim() || '',
            item_name: itemName,
            quantity: Number(row['Quantity'] || 1),
            price: Number(String(row['Total price'] || '0').replace(/[^0-9.-]+/g, '')),
            date_sold: date.toISOString(),
            source: 'csv',
          }
        })
        .filter(r => r)
        .filter(r => r!.item_name)
        .filter(r => /repair|service/i.test(r!.item_name)) as any[]

      const uniqueRowsMap = new Map<string, any>()
      for (const row of mappedRows) {
        if (row.listing_id && !uniqueRowsMap.has(row.listing_id)) {
          uniqueRowsMap.set(row.listing_id, row)
        }
      }
      const uniqueRows = Array.from(uniqueRowsMap.values())

      if (uniqueRows.length === 0) {
        alert('No valid rows found in CSV')
        setLoading(false)
        return
      }

      const { error } = await supabase
        .from('repairs')
        .upsert(uniqueRows, { onConflict: 'listing_id' })

      if (error) {
        console.error('Supabase upsert error:', error)
        alert('Supabase insert failed: ' + error.message)
      } else {
        await fetchRepairs()
        alert(`Imported ${uniqueRows.length} rows successfully`)
      }
    } catch (err) {
      console.error('CSV parse/upload error:', err)
      alert('CSV import failed. Check console for details.')
    } finally {
      setLoading(false)
    }
  }

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { error } = await supabase.from('repairs').upsert([
        {
          listing_id: manual.listing_id,
          item_name: manual.item_name,
          price: Number(manual.price),
          quantity: Number(manual.quantity),
          date_sold: new Date(manual.date_sold).toISOString(),
          source: 'manual',
        },
      ])
      if (error) {
        console.error('Manual insert error:', error)
        alert('Failed to add repair')
      } else {
        setManual({ listing_id: '', item_name: '', price: '', quantity: '', date_sold: '' })
        await fetchRepairs()
      }
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('Logout error:', error.message)
      alert('Failed to logout')
    } else {
      window.location.href = '/login'
    }
  }

  const filterRepairsByPeriod = (repairs: Repair[]) => {
    const now = new Date()
    return repairs.filter((r) => {
      const sold = new Date(r.date_sold)
      const soldYear = sold.getUTCFullYear()
      const soldMonth = sold.getUTCMonth()

      if (filterPeriod === 'thisMonth') return soldYear === now.getUTCFullYear() && soldMonth === now.getUTCMonth()
      if (filterPeriod === 'lastMonth') {
        const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1))
        return soldYear === lastMonth.getUTCFullYear() && soldMonth === lastMonth.getUTCMonth()
      }
      if (filterPeriod === 'thisYear') return soldYear === now.getUTCFullYear()
      if (filterPeriod === 'lastYear') return soldYear === now.getUTCFullYear() - 1
      if (filterPeriod === 'custom' && customStart && customEnd) {
        const start = new Date(customStart)
        const end = new Date(customEnd)
        end.setHours(23, 59, 59, 999)
        return sold >= start && sold <= end
      }
      return true
    })
  }

  const getUniqueRepairs = (repairs: Repair[]) => {
    const map = new Map<string, Repair>()
    for (const r of repairs) {
      const key = r.listing_id || crypto.randomUUID()
      if (!map.has(key)) map.set(key, r)
    }
    return Array.from(map.values())
  }

  const filteredRepairs = getUniqueRepairs(filterRepairsByPeriod(repairs))
  const keyItems = ['Nintendo', 'Playstation', 'Xbox', 'iPad']

  const totals = keyItems.map((item) => {
    const filtered = filteredRepairs.filter(r => r.item_name.toLowerCase().includes(item.toLowerCase()))
    const totalAmount = filtered.reduce((sum, r) => sum + r.price, 0) // price only
    const totalCount = filtered.reduce((sum, r) => sum + r.quantity, 0)
    return { item, totalAmount, totalCount }
  })

  const allItemsTotalCount = filteredRepairs.reduce((sum, r) => sum + r.quantity, 0)
  const allItemsTotalPrice = filteredRepairs.reduce((sum, r) => sum + r.price, 0)

  return (
    <main className="min-h-screen bg-gray-50 font-sans p-6 space-y-8">
      {/* Header */}
      <div className="flex justify-center items-center mb-6 relative">
        <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 text-center">
          <span className="text-blue-900">Repair</span> Log
        </h1>
        <button
          onClick={handleLogout}
          className="absolute right-0 px-4 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition"
        >
          Logout
        </button>
      </div>

      {/* CSV Upload */}
      <div className="p-4 bg-white border border-gray-200 rounded-xl shadow hover:shadow-lg transition space-y-2 max-w-md mx-auto">
        <h2 className="text-lg font-semibold text-gray-900">Upload CSV</h2>
        <div className="flex items-center gap-3">
          <input id="file-upload" type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
          <label
            htmlFor="file-upload"
            className="px-4 py-2 bg-blue-900 text-white font-semibold rounded-lg cursor-pointer hover:bg-blue-800 transition"
          >
            Choose File
          </label>
          {selectedFile && <span className="text-gray-700 font-medium truncate max-w-xs">{selectedFile.name}</span>}
        </div>
        {loading && <p className="mt-1 text-gray-500 italic text-sm">Processing…</p>}
      </div>

      {/* Manual Entry */}
      <form
        onSubmit={handleManualSubmit}
        className="p-4 bg-white border border-gray-200 rounded-xl shadow hover:shadow-lg transition max-w-3xl mx-auto"
      >
        <h2 className="text-lg font-semibold mb-3 text-gray-900">Manual Entry</h2>
        <div className="flex flex-wrap gap-3">
          {['listing_id', 'item_name', 'price', 'quantity', 'date_sold'].map((field) => (
            <input
              key={field}
              type={field === 'price' || field === 'quantity' ? 'number' : field === 'date_sold' ? 'date' : 'text'}
              placeholder={field === 'listing_id' ? 'Order #' : field.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              value={(manual as any)[field]}
              onChange={(e) => setManual({ ...manual, [field]: e.target.value })}
              required
              className="flex-1 min-w-[110px] p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900 text-gray-900 placeholder-gray-400"
            />
          ))}
          <button type="submit" className="px-4 py-2 bg-blue-900 text-white font-semibold rounded-lg hover:bg-blue-800 transition">
            Add
          </button>
        </div>
      </form>

      {/* Filter & Totals */}
      <div className="p-6 bg-white border border-gray-200 rounded-xl shadow flex flex-col items-center gap-6">
        <div className="flex flex-col md:flex-row items-center gap-2 w-full justify-center">
          <label className="font-bold text-xl text-gray-900">Filter:</label>
          <select
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value as any)}
            className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900 text-gray-900"
          >
            <option value="thisMonth">This Month</option>
            <option value="lastMonth">Last Month</option>
            <option value="thisYear">This Year</option>
            <option value="lastYear">Last Year</option>
            <option value="custom">Custom Date</option>
          </select>
        </div>

        {filterPeriod === 'custom' && (
          <div className="flex items-center gap-2 mt-2 md:mt-0">
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
              className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900 text-gray-900"
            />
            <span className="text-gray-700">to</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
              className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900 text-gray-900"
            />
          </div>
        )}

        {/* All Items Total Tile */}
        <div className="bg-blue-100 w-full md:w-96 p-6 rounded-lg shadow flex flex-col items-center justify-center mt-4">
          <span className="font-bold text-3xl text-blue-900">{allItemsTotalCount}</span>
          <span className="font-semibold text-gray-700 text-lg mt-1">All Items</span>
          <span className="text-gray-500 text-sm mt-1">£{allItemsTotalPrice.toFixed(2)}</span>
        </div>

        {/* Key Items Tiles */}
        <div className="flex flex-wrap gap-4 justify-center w-full">
          {totals.map((t) => (
            <div key={t.item} className="bg-gray-50 p-4 rounded-lg shadow flex flex-col items-center justify-center min-w-[120px]">
              <span className="font-semibold text-blue-900 text-xl">{t.totalCount}</span>
              <span className="font-medium text-gray-700 mt-1">{t.item}</span>
              <span className="text-gray-500 text-sm mt-1">£{t.totalAmount.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Repairs Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 shadow">
        <table className="table-auto w-full border-collapse text-gray-900 min-w-[600px]">
          <thead className="bg-blue-900 text-white sticky top-0">
            <tr>
              {['Date Sold', 'Item', 'Order #', 'Qty', 'Price', 'Source'].map((header) => (
                <th key={header} className="px-4 py-2 border">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {repairs.map((r) => (
              <tr key={r.id} className={`${r.source === 'manual' ? 'bg-gray-50' : 'bg-white'} odd:bg-white even:bg-gray-50`}>
                <td className="px-4 py-2 border">{r.date_sold.slice(0, 10)}</td>
                <td className="px-4 py-2 border">{r.item_name}</td>
                <td className="px-4 py-2 border">{r.listing_id}</td>
                <td className="px-4 py-2 border text-center">{r.quantity}</td>
                <td className="px-4 py-2 border">£{r.price.toFixed(2)}</td>
                <td className="px-4 py-2 border">{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
