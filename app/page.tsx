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

  // --- Edit/Delete state ---
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValues, setEditValues] = useState<Partial<Repair>>({})

  // --- Ensure client-only render ---
  useEffect(() => {
    setMounted(true)
  }, [])

  // --- Auth check ---
  useEffect(() => {
    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data?.session) router.push('/login')
      else setSessionChecked(true)
    }
    checkAuth()
  }, [router])

  // --- Fetch Repairs ---
  const fetchRepairs = async () => {
    const { data, error } = await supabase
      .from('repairs')
      .select('*')
      .order('date_sold', { ascending: false })
    if (!error) setRepairs(data || [])
  }

  useEffect(() => {
    if (sessionChecked) fetchRepairs()
  }, [sessionChecked])

  // --- Helpers ---
  const parseDateDMY = (str: string) => {
    if (!str || !/\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) return null
    const [day, month, year] = str.split('/')
    const d = new Date(Date.UTC(Number(year), Number(month)-1, Number(day)))
    return isNaN(d.getTime()) ? null : d
  }

  // --- Filtering ---
  const filterRepairs = repairs.filter((r) => {
    if (!r.date_sold) return false
    const d = new Date(r.date_sold)
    const now = new Date()
    const month = d.getUTCMonth()
    const year = d.getUTCFullYear()

    switch(filterPeriod) {
      case 'thisMonth':
        return month===now.getUTCMonth() && year===now.getUTCFullYear()
      case 'lastMonth':
        const lm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()-1))
        return month===lm.getUTCMonth() && year===lm.getUTCFullYear()
      case 'thisYear':
        return year===now.getUTCFullYear()
      case 'lastYear':
        return year===now.getUTCFullYear()-1
      case 'custom':
        if(customStart && customEnd){
          const start = new Date(customStart)
          const end = new Date(customEnd)
          end.setHours(23,59,59,999)
          return d>=start && d<=end
        }
        return true
      default:
        return true
    }
  })

  // --- Key items ---
  const keyItems = ['Nintendo','Playstation','Xbox','iPad','Laptop']

  const totals = keyItems.map(item=>{
    const filtered = filterRepairs.filter(r =>
      r.item_name?.toLowerCase().includes(item.toLowerCase())
    )
    return {
      item,
      totalCount: filtered.reduce((s,r)=>s+(r.quantity??0),0),
      totalAmount: filtered.reduce((s,r)=>s+(r.price??0),0),
    }
  })

  const allTotalCount = filterRepairs.reduce((s,r)=>s+(r.quantity??0),0)
  const allTotalAmount = filterRepairs.reduce((s,r)=>s+(r.price??0),0)

  // --- CSV Upload ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>)=>{
    const file = e.target.files?.[0]
    if(!file) return
    setSelectedFile(file)
    setLoading(true)

    try {
      const buffer = await file.arrayBuffer()
      let text:string
      try {
        text = new TextDecoder('utf-16').decode(buffer)
        if(!text.includes('Order number')) throw new Error()
      } catch {
        text = new TextDecoder('utf-8').decode(buffer)
      }

      const lines = text.split(/\r?\n/).filter(l=>l.trim())
      if(lines.length < 2) return

      const delimiter = lines[0].includes('\t') ? '\t' : ','
      const headers = lines[0].split(delimiter).map(h=>h.trim())

      const rows = lines.slice(1).map(line=>{
        const values = line.split(delimiter).map(v=>v.trim())
        const obj:any = {}
        headers.forEach((h,i)=>obj[h]=values[i]||'')
        return obj
      })

      const mapped = rows.map(row=>{
        const date = parseDateDMY(row['Sale date'])
        if(!date) return null
        return {
          listing_id: row['Order number'],
          item_name: row['Item title'],
          quantity: Number(row['Quantity']||1),
          price: Number(String(row['Total price']||'0').replace(/[^0-9.-]/g,'')),
          date_sold: date.toISOString(),
          source: 'csv'
        }
      }).filter(r=>r && /repair|service/i.test(r.item_name)) as Repair[]

      const unique = new Map<string, Repair>()
      mapped.forEach(r=>unique.set(r.listing_id,r))

      await supabase
        .from('repairs')
        .upsert(Array.from(unique.values()), { onConflict:'listing_id' })

      await fetchRepairs()
    } finally {
      setLoading(false)
    }
  }

  // --- Manual Entry ---
  const handleManualSubmit = async (e: React.FormEvent)=>{
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

  // --- Edit/Delete ---
  const handleEdit = (r: Repair) => {
    setEditingId(r.id)
    setEditValues({ ...r })
  }

  const handleEditSave = async () => {
    if (!editingId) return
    setLoading(true)

    await supabase
      .from('repairs')
      .update({
        item_name: editValues.item_name,
        price: editValues.price,
        quantity: editValues.quantity,
        date_sold: editValues.date_sold,
      })
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

  const handleLogout = async ()=>{
    await supabase.auth.signOut()
    router.push('/login')
  }

  if(!mounted || !sessionChecked) return null

  return (
    <main className="min-h-screen bg-gray-50 p-6 space-y-8">

      {/* Header */}
      <div className="flex justify-center items-center relative">
        <h1 className="text-4xl font-extrabold">
          <span className="text-blue-900">Repair</span> Log
        </h1>
        <button onClick={handleLogout}
          className="absolute right-0 px-4 py-2 bg-red-600 text-white rounded">
          Logout
        </button>
      </div>

      {/* CSV Upload */}
      <div className="bg-white p-4 rounded shadow max-w-md mx-auto">
        <h2 className="font-semibold mb-2">Upload CSV</h2>
        <input type="file" accept=".csv" onChange={handleFileUpload} />
      </div>

      {/* Manual Entry */}
      <form onSubmit={handleManualSubmit}
        className="bg-white p-4 rounded shadow max-w-3xl mx-auto flex flex-wrap gap-2">
        {['listing_id','item_name','price','quantity','date_sold'].map(f=>(
          <input key={f}
            type={f==='date_sold'?'date':f==='price'||f==='quantity'?'number':'text'}
            placeholder={f}
            value={(manual as any)[f]}
            onChange={e=>setManual({...manual,[f]:e.target.value})}
            required
            className="border p-2 rounded flex-1 min-w-[120px]"
          />
        ))}
        <button className="bg-blue-900 text-white px-4 py-2 rounded">
          Add
        </button>
      </form>

      {/* Totals */}
      <div className="bg-white p-6 rounded shadow space-y-4">
        <div className="text-center">
          <div className="text-4xl font-bold">{allTotalCount}</div>
          <div className="text-gray-500">All Items (£{allTotalAmount.toFixed(2)})</div>
        </div>

        <div className="flex gap-4 justify-center flex-wrap">
          {totals.map(t=>(
            <div key={t.item} className="bg-gray-100 p-4 rounded text-center min-w-[120px]">
              <div className="font-bold">{t.totalCount}</div>
              <div>{t.item}</div>
              <div className="text-sm text-gray-500">£{t.totalAmount.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Repairs Table */}
      <div className="overflow-x-auto bg-white rounded shadow">
        <table className="w-full min-w-[900px]">
          <thead className="bg-blue-900 text-white">
            <tr>
              {['Date','Item','Order #','Qty','Price','Source','Actions'].map(h=>(
                <th key={h} className="px-3 py-2 border">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {repairs.map(r=>{
              const editing = editingId === r.id
              return (
                <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                  <td className="border px-2 py-3">
                    {editing
                      ? <input type="date"
                          value={String(editValues.date_sold).slice(0,10)}
                          onChange={e=>setEditValues(v=>({...v,date_sold:e.target.value}))}
                          className="border p-1"/>
                      : r.date_sold.slice(0,10)}
                  </td>
                  <td className="border px-2">
                    {editing
                      ? <input value={editValues.item_name||''}
                          onChange={e=>setEditValues(v=>({...v,item_name:e.target.value}))}
                          className="border p-1 w-full"/>
                      : r.item_name}
                  </td>
                  <td className="border px-2">{r.listing_id}</td>
                  <td className="border px-2 text-center">
                    {editing
                      ? <input type="number" value={editValues.quantity||0}
                          onChange={e=>setEditValues(v=>({...v,quantity:+e.target.value}))}
                          className="border p-1 w-16"/>
                      : r.quantity}
                  </td>
                  <td className="border px-2">
                    {editing
                      ? <input type="number" value={editValues.price||0}
                          onChange={e=>setEditValues(v=>({...v,price:+e.target.value}))}
                          className="border p-1 w-24"/>
                      : `£${r.price.toFixed(2)}`}
                  </td>
                  <td className="border px-2">{r.source}</td>
                  <td className="border px-2 text-center space-x-1">
                    {editing ? (
                      <>
<button
  onClick={handleEditSave}
  className="bg-green-500 text-white px-2 py-0.5 text-sm rounded"
>
  Save
</button>

<button
  onClick={() => setEditingId(null)}
  className="bg-gray-400 text-white px-2 py-0.5 text-sm rounded"
>
  Cancel
</button>
                      </>
                    ) : (
                      <>
<button
  onClick={() => handleEdit(r)}
  className="bg-blue-500 text-white px-2 py-0.5 text-sm rounded"
>
  Edit
</button>

<button
  onClick={() => handleDelete(r.id)}
  className="bg-red-500 text-white px-2 py-0.5 text-sm rounded"
>
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
