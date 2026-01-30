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

  const [filterPeriod, setFilterPeriod] =
    useState<'thisMonth'|'lastMonth'|'thisYear'|'lastYear'|'custom'>('thisMonth')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const [manual, setManual] = useState({
    listing_id: '',
    item_name: '',
    price: '',
    quantity: '',
    date_sold: '',
  })

  // Edit / Delete state
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValues, setEditValues] = useState<Partial<Repair>>({})

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data?.session) router.push('/login')
      else setSessionChecked(true)
    }
    checkAuth()
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
    if (!str || !/\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) return null
    const [day, month, year] = str.split('/')
    return new Date(Date.UTC(+year, +month - 1, +day))
  }

  const filterRepairs = repairs.filter(r => {
    if (!r.date_sold) return false
    const d = new Date(r.date_sold)
    const now = new Date()

    switch (filterPeriod) {
      case 'thisMonth':
        return d.getUTCMonth() === now.getUTCMonth() &&
               d.getUTCFullYear() === now.getUTCFullYear()
      case 'lastMonth': {
        const lm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1))
        return d.getUTCMonth() === lm.getUTCMonth() &&
               d.getUTCFullYear() === lm.getUTCFullYear()
      }
      case 'thisYear':
        return d.getUTCFullYear() === now.getUTCFullYear()
      case 'lastYear':
        return d.getUTCFullYear() === now.getUTCFullYear() - 1
      case 'custom':
        if (!customStart || !customEnd) return true
        const start = new Date(customStart)
        const end = new Date(customEnd)
        end.setHours(23, 59, 59, 999)
        return d >= start && d <= end
      default:
        return true
    }
  })

  const keyItems = ['Nintendo','Playstation','Xbox','iPad','Laptop']

  const totals = keyItems.map(item => {
    const rows = filterRepairs.filter(r =>
      r.item_name?.toLowerCase().includes(item.toLowerCase())
    )
    return {
      item,
      totalCount: rows.reduce((s,r)=>s+(r.quantity??0),0),
      totalAmount: rows.reduce((s,r)=>s+(r.price??0),0),
    }
  })

  const allTotalCount = filterRepairs.reduce((s,r)=>s+(r.quantity??0),0)
  const allTotalAmount = filterRepairs.reduce((s,r)=>s+(r.price??0),0)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setLoading(true)

    try {
      const buffer = await file.arrayBuffer()
      let text: string
      try {
        text = new TextDecoder('utf-16').decode(buffer)
        if (!text.includes('Order number')) throw new Error()
      } catch {
        text = new TextDecoder('utf-8').decode(buffer)
      }

      const lines = text.split(/\r?\n/).filter(Boolean)
      const delimiter = lines[0].includes('\t') ? '\t' : ','
      const headers = lines[0].split(delimiter)

      const rows = lines.slice(1).map(line => {
        const values = line.split(delimiter)
        const obj: any = {}
        headers.forEach((h,i)=>obj[h.trim()] = values[i]?.trim())
        return obj
      })

      const mapped = rows.map(row => {
        const date = parseDateDMY(row['Sale date'])
        if (!date) return null
        return {
          listing_id: row['Order number'],
          item_name: row['Item title'],
          quantity: Number(row['Quantity'] || 1),
          price: Number(String(row['Total price']).replace(/[^0-9.-]/g,'')),
          date_sold: date.toISOString(),
          source: 'csv'
        }
      }).filter(r => r && /repair|service/i.test(r.item_name)) as Repair[]

      const unique = new Map<string, Repair>()
      mapped.forEach(r => unique.set(r.listing_id, r))

      await supabase.from('repairs')
        .upsert([...unique.values()], { onConflict: 'listing_id' })

      await fetchRepairs()
    } finally {
      setLoading(false)
    }
  }

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    await supabase.from('repairs').upsert([{
      listing_id: manual.listing_id,
      item_name: manual.item_name,
      price: Number(manual.price),
      quantity: Number(manual.quantity),
      date_sold: new Date(manual.date_sold).toISOString(),
      source: 'manual'
    }])

    setManual({ listing_id:'', item_name:'', price:'', quantity:'', date_sold:'' })
    await fetchRepairs()
    setLoading(false)
  }

  const handleEdit = (r: Repair) => {
    setEditingId(r.id)
    setEditValues(r)
  }

  const handleEditSave = async () => {
    if (!editingId) return
    setLoading(true)

    await supabase.from('repairs')
      .update(editValues)
      .eq('id', editingId)

    setEditingId(null)
    setEditValues({})
    await fetchRepairs()
    setLoading(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this repair?')) return
    setLoading(true)
    await supabase.from('repairs').delete().eq('id', id)
    await fetchRepairs()
    setLoading(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (!mounted || !sessionChecked) return null

  return (
    <main className="min-h-screen bg-gray-50 p-6 space-y-8">

      {/* Header */}
      <div className="relative flex justify-center">
        <h1 className="text-4xl font-extrabold">
          <span className="text-blue-900">Repair</span> Log
        </h1>
        <button onClick={handleLogout}
          className="absolute right-0 bg-red-600 text-white px-4 py-2 rounded">
          Logout
        </button>
      </div>

      {/* CSV Upload */}
      <div className="bg-white p-4 rounded shadow max-w-md mx-auto">
        <h2 className="font-semibold mb-2">Upload CSV</h2>
       <label className="inline-flex items-center gap-3 cursor-pointer">
  <input
    type="file"
    accept=".csv"
    onChange={handleFileUpload}
    className="hidden"
  />

  <span
    className="
      border border-gray-300
      bg-gray-100
      hover:bg-gray-200
      text-gray-800
      px-4 py-2
      rounded
      shadow-sm
      transition
      active:scale-95
      select-none
    "
  >
    Choose file
  </span>

  {selectedFile && (
    <span className="text-sm text-gray-600 truncate max-w-[200px]">
      {selectedFile.name}
    </span>
  )}
</label>

        {selectedFile && <p className="text-sm mt-1">{selectedFile.name}</p>}
      </div>

      {/* Manual Entry */}
      <form onSubmit={handleManualSubmit}
        className="bg-white p-4 rounded shadow max-w-3xl mx-auto flex flex-wrap gap-2">
        {['listing_id','item_name','price','quantity','date_sold'].map(f=>(
          <input key={f}
            type={f==='date_sold'?'date':f==='price'||f==='quantity'?'number':'text'}
            value={(manual as any)[f]}
            onChange={e=>setManual({...manual,[f]:e.target.value})}
            placeholder={f.replace('_',' ')}
            required
            className="border p-2 rounded flex-1 min-w-[120px]"
          />
        ))}
        <button className="bg-blue-900 text-white px-4 py-2 rounded">Add</button>
      </form>

      {/* Totals */}
      <div className="bg-white p-6 rounded shadow space-y-4">
        <div className="bg-blue-100 p-6 rounded text-center">
          <div className="text-4xl font-bold text-blue-900">{allTotalCount}</div>
          <div className="text-xl font-semibold text-gray-700">All Items</div>
          <div className="text-base text-gray-500">£{allTotalAmount.toFixed(2)}</div>
        </div>

        <div className="flex flex-wrap justify-center gap-4">
          {totals.map(t=>(
            <div key={t.item} className="bg-gray-50 p-4 rounded shadow text-center min-w-[120px]">
              <div className="text-2xl font-semibold text-blue-900">{t.totalCount}</div>
              <div className="text-base text-gray-800">{t.item}</div>
              <div className="text-sm text-gray-500">£{t.totalAmount.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto bg-white rounded shadow">
        <table className="w-full min-w-[900px] border-collapse">
          <thead className="bg-blue-900 text-white">
            <tr>
              {['Date','Item','Order #','Qty','Price','Source','Actions'].map(h=>(
                <th key={h} className="border px-3 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {repairs.map(r=>{
              const editing = editingId === r.id
              return (
                <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                  <td className="border px-2 py-3">
                    {editing ? (
                      <input type="date"
                        value={String(editValues.date_sold).slice(0,10)}
                        onChange={e=>setEditValues(v=>({...v,date_sold:e.target.value}))}
                        className="border p-1 text-sm"/>
                    ) : r.date_sold.slice(0,10)}
                  </td>

                  <td className="border px-2 py-3">
                    {editing ? (
                      <input
                        value={editValues.item_name||''}
                        onChange={e=>setEditValues(v=>({...v,item_name:e.target.value}))}
                        className="border p-1 w-full text-sm"/>
                    ) : r.item_name}
                  </td>

                  <td className="border px-2 py-3">{r.listing_id}</td>

                  <td className="border px-2 py-3 text-center">
                    {editing ? (
                      <input type="number"
                        value={editValues.quantity||0}
                        onChange={e=>setEditValues(v=>({...v,quantity:+e.target.value}))}
                        className="border p-1 w-16 text-sm"/>
                    ) : r.quantity}
                  </td>

                  <td className="border px-2 py-3">
                    {editing ? (
                      <input type="number"
                        value={editValues.price||0}
                        onChange={e=>setEditValues(v=>({...v,price:+e.target.value}))}
                        className="border p-1 w-24 text-sm"/>
                    ) : `£${r.price.toFixed(2)}`}
                  </td>

                  <td className="border px-2 py-3">{r.source}</td>

                  <td className="border px-2 py-3 text-center space-x-1">
                    {editing ? (
                      <>
                        <button onClick={handleEditSave}
                          className="bg-green-500 hover:bg-green-600 text-white px-2 py-0.5 text-sm rounded">
                          Save
                        </button>
                        <button onClick={()=>setEditingId(null)}
                          className="bg-gray-400 hover:bg-gray-500 text-white px-2 py-0.5 text-sm rounded">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={()=>handleEdit(r)}
                          className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-0.5 text-sm rounded">
                          Edit
                        </button>
                        <button onClick={()=>handleDelete(r.id)}
                          className="bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 text-sm rounded">
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {loading && <p className="text-center italic">Processing…</p>}
    </main>
  )
}
