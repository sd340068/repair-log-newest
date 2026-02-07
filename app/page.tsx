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
  const [editValues, setEditValues] = useState<Partial<Repair>>({})

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

  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error', visible: boolean }>({ message: '', type: 'success', visible: false })

  // --- Mount + Auth ---
  useEffect(() => setMounted(true), [])
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
  useEffect(() => { if(sessionChecked) fetchRepairs() }, [sessionChecked])

  const parseDateDMY = (str: string) => {
    if (!/\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) return null
    const [d, m, y] = str.split('/')
    const date = new Date(Date.UTC(+y, +m-1, +d))
    return isNaN(date.getTime()) ? null : date
  }

  // --- Filtered Repairs ---
  const filtered = repairs.filter(r => {
    if(!r.date_sold) return false
    const d = new Date(r.date_sold)
    const now = new Date()
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth()

    switch(filterPeriod){
      case 'thisMonth': return y===now.getUTCFullYear() && m===now.getUTCMonth()
      case 'lastMonth': {
        const lm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()-1))
        return y===lm.getUTCFullYear() && m===lm.getUTCMonth()
      }
      case 'thisYear': return y===now.getUTCFullYear()
      case 'lastYear': return y===now.getUTCFullYear()-1
      case 'custom':
        if(customStart && customEnd){
          const start = new Date(customStart)
          const end = new Date(customEnd)
          end.setHours(23,59,59,999)
          return d>=start && d<=end
        }
        return true
      default: return true
    }
  })

  const keyItems = ['Nintendo','Playstation','Xbox','iPad','Laptop']
  const totals = keyItems.map(item=>{
    const rows = filtered.filter(r=>r.item_name?.toLowerCase().includes(item.toLowerCase()))
    return {
      item,
      totalCount: rows.reduce((sum,r)=>sum + (r.quantity??0),0),
      totalAmount: rows.reduce((sum,r)=>sum + (r.price??0),0)
    }
  })
  const allTotalCount = filtered.reduce((sum,r)=>sum + (r.quantity??0),0)
  const allTotalAmount = filtered.reduce((sum,r)=>sum + (r.price??0),0)

  // --- Toast helper ---
  const showToast = (message:string, type:'success'|'error')=>{
    setToast({ message, type, visible:true })
    setTimeout(()=>setToast(prev=>({...prev, visible:false})), 4000)
  }

  // --- CSV Upload ---
  const handleCSV = async (e: React.ChangeEvent<HTMLInputElement>)=>{
    const file = e.target.files?.[0]
    if(!file) return
    setSelectedFile(file)
    setLoading(true)

    try {
      const buffer = await file.arrayBuffer()
      let text:string
      try { text = new TextDecoder('utf-16').decode(buffer); if(!text.includes('Order number')) throw new Error() } 
      catch { text = new TextDecoder('utf-8').decode(buffer) }

      const lines = text.split(/\r?\n/).filter(l=>l.trim())
      if(lines.length<2){ showToast('CSV too short','error'); setLoading(false); return }

      const delimiter = lines[0].includes('\t')?'\t':','
      const headers = lines[0].split(delimiter).map(h=>h.trim())
      const rows = lines.slice(1).map(line=>{
        const values = line.split(delimiter).map(v=>v.trim())
        const obj:any={}
        headers.forEach((h,i)=>obj[h]=values[i]||'')
        return obj
      })

      const mapped = rows.map(row=>{
        const name = row['Item title']?.trim()||''
        const date = parseDateDMY(row['Sale date']||'')
        if(!date) return null
        return {
          listing_id: row['Order number']?.trim()||'',
          item_name: name,
          quantity: Number(row['Quantity']||1),
          price: Number(String(row['Total price']||'0').replace(/[^0-9.-]+/g,'')),
          date_sold: date.toISOString(),
          source:'csv'
        }
      }).filter(r=>r && r.item_name && /repair|service/i.test(r.item_name)) as Repair[]

      const uniqueMap = new Map<string, Repair>()
      for(const r of mapped){
        if(r.listing_id) uniqueMap.set(r.listing_id,r)
      }
      const uniqueRows = Array.from(uniqueMap.values())
      if(uniqueRows.length===0){ showToast('No valid rows', 'error'); setLoading(false); return }

      const insertedCount = uniqueRows.length
      const duplicateCount = mapped.length - insertedCount

      const {error} = await supabase.from('repairs').upsert(uniqueRows,{
        onConflict:'listing_id',
        ignoreDuplicates:true
      })
      if(error) showToast('CSV insert failed: '+error.message, 'error')
      else {
        await fetchRepairs()
        showToast(`CSV imported: ${insertedCount} new, ${duplicateCount} duplicates skipped`, 'success')
      }

    } catch(err){ console.error(err); showToast('CSV failed', 'error') }
    finally{ setLoading(false) }
  }

  // --- Manual Entry ---
  const handleManualSubmit = async (e:React.FormEvent)=>{
    e.preventDefault()
    setLoading(true)
    try{
      const {error} = await supabase.from('repairs').upsert([{
        listing_id: manual.listing_id,
        item_name: manual.item_name,
        price:Number(manual.price),
        quantity:Number(manual.quantity),
        date_sold:new Date(manual.date_sold).toISOString(),
        source:'manual'
      }])
      if(error) showToast('Failed to add repair','error')
      else {
        setManual({ listing_id:'', item_name:'', price:'', quantity:'', date_sold:'' })
        await fetchRepairs()
        showToast('Manual repair added','success')
      }
    } finally{ setLoading(false) }
  }

  // --- Edit/Delete Handlers ---
  const handleEdit = (r:Repair)=>{
    setEditingId(r.id)
    setEditValues(r)
  }
  const handleEditSave = async ()=>{
    if(!editingId) return
    setLoading(true)
    await supabase.from('repairs').update(editValues).eq('id',editingId)
    setEditingId(null)
    setEditValues({})
    await fetchRepairs()
    setLoading(false)
    showToast('Repair updated','success')
  }
  const handleDelete = async (id:number)=>{
    if(!confirm('Delete this repair?')) return
    setLoading(true)
    await supabase.from('repairs').delete().eq('id',id)
    await fetchRepairs()
    setLoading(false)
    showToast('Repair deleted','success')
  }

  const handleLogout = async ()=>{
    await supabase.auth.signOut()
    router.push('/login')
  }

  if(!mounted || !sessionChecked) return null

  return (
    <main className="min-h-screen bg-gray-50 font-sans p-6 space-y-8">
      {/* Header */}
      <div className="flex justify-center items-center mb-6 relative">
        <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 text-center">
          <span className="text-blue-900">Repair</span> Log
        </h1>
        <button onClick={handleLogout} className="absolute right-0 px-4 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition">
          Logout
        </button>
      </div>

      {/* CSV Upload */}
      <div className="p-4 bg-white border border-gray-200 rounded-xl shadow hover:shadow-lg transition space-y-2 max-w-md mx-auto">
        <h2 className="text-lg font-semibold text-gray-900">Upload CSV</h2>
        <label className="inline-flex items-center gap-3 cursor-pointer">
          <input id="file-upload" type="file" accept=".csv" onChange={handleCSV} className="hidden" />
          <span className="border border-gray-300 bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded shadow-sm active:scale-95 transition">
            Choose file
          </span>
          {selectedFile && <span className="text-sm text-gray-600 truncate max-w-[200px]">{selectedFile.name}</span>}
        </label>
        {loading && <p className="mt-1 text-gray-500 italic text-sm">Processing…</p>}
      </div>

      {/* Manual Entry */}
      <form onSubmit={handleManualSubmit} className="p-4 bg-white border border-gray-200 rounded-xl shadow hover:shadow-lg transition max-w-3xl mx-auto flex flex-wrap gap-3">
        {['listing_id','item_name','price','quantity','date_sold'].map(f => (
          <input
            key={f}
            type={f==='price'||f==='quantity'?'number':f==='date_sold'?'date':'text'}
            placeholder={f==='listing_id'?'Order #':f.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}
            value={(manual as any)[f]}
            onChange={e=>setManual({...manual,[f]:e.target.value})}
            required
            className={`flex-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900 text-gray-900 placeholder-gray-400 ${
              f==='date_sold' ? 'min-w-[160px]' : 'min-w-[110px]'
            }`}
          />
        ))}
        <button type="submit" className="px-4 py-2 bg-blue-900 text-white font-semibold rounded-lg hover:bg-blue-800 transition">Add</button>
      </form>

      {/* Filters */}
      <div className="p-6 bg-white border border-gray-200 rounded-xl shadow flex flex-col items-center gap-6">
        <div className="flex flex-col md:flex-row items-center gap-2 w-full justify-center">
          <label className="font-bold text-xl text-gray-900">Filter:</label>
          <select
            value={filterPeriod}
            onChange={e=>setFilterPeriod(e.target.value as any)}
            className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900 text-gray-900"
          >
            <option value="thisMonth">This Month</option>
            <option value="lastMonth">Last Month</option>
            <option value="thisYear">This Year</option>
            <option value="lastYear">Last Year</option>
            <option value="custom">Custom Date</option>
          </select>
        </div>

        {filterPeriod==='custom' && (
          <div className="flex items-center gap-2 mt-2 md:mt-0">
            <input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)}
              className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900 text-gray-900"/>
            <span className="text-gray-700">to</span>
            <input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)}
              className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900 text-gray-900"/>
          </div>
        )}

        {/* All Items Total */}
        <div className="bg-blue-100 w-full md:w-96 p-6 rounded-lg shadow flex flex-col items-center justify-center mt-4">
          <span className="font-bold text-4xl text-blue-900">{allTotalCount}</span>
          <span className="font-semibold text-gray-700 text-xl mt-1">Total Repairs</span>
          <span className="text-gray-500 text-base mt-1">£{allTotalAmount.toFixed(2)}</span>
        </div>

        {/* Key Items Tiles with colored left accent */}
        <div className="flex flex-wrap gap-4 justify-center w-full">
          {totals.map(t=>{
            let borderColor = 'border-gray-300'
            switch(t.item.toLowerCase()){
              case 'playstation': borderColor='border-blue-500'; break
              case 'xbox': borderColor='border-green-500'; break
              case 'nintendo': borderColor='border-red-500'; break
              case 'ipad': borderColor='border-black'; break
              case 'laptop': borderColor='border-yellow-400'; break
              case 'phone': borderColor='border-pink-400'; break
            }

            return (
              <div key={t.item} className={`flex flex-col items-center justify-center min-w-[120px] bg-gray-50 p-4 rounded-lg shadow border-l-4 ${borderColor}`}>
                <span className="font-semibold text-blue-900 text-2xl">{t.totalCount}</span>
                <span className="font-medium text-gray-700 text-base mt-1">{t.item}</span>
                <span className="text-gray-500 text-sm mt-1">£{t.totalAmount.toFixed(2)}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Repairs Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 shadow">
        <table className="table-auto w-full border-collapse text-gray-900 min-w-[600px]">
          <thead className="bg-blue-900 text-white sticky top-0">
            <tr>{['Date Sold','Item','Order #','Qty','Price','Source','Actions'].map(h=><th key={h} className="px-4 py-2 border">{h}</th>)}</tr>
          </thead>
          <tbody>
            {repairs.map(r=>{
              const editing = editingId===r.id
              return(
                <tr key={r.id} className={`${r.source==='manual'?'bg-gray-50':'bg-white'} odd:bg-white even:bg-gray-50`}>
                  <td className="px-4 py-3 border">{editing?<input type="date" value={editValues.date_sold?.slice(0,10)||''} onChange={e=>setEditValues(v=>({...v,date_sold:e.target.value}))} className="border p-1 text-sm"/>:r.date_sold.slice(0,10)}</td>
                  <td className="px-4 py-3 border">{editing?<input value={editValues.item_name||''} onChange={e=>setEditValues(v=>({...v,item_name:e.target.value}))} className="border p-1 w-full text-sm"/>:r.item_name}</td>
                  <td className="px-4 py-3 border">{r.listing_id}</td>
                  <td className="px-4 py-3 border text-center">{editing?<input type="number" value={editValues.quantity||0} onChange={e=>setEditValues(v=>({...v,quantity:+e.target.value}))} className="border p-1 w-16 text-sm"/>:r.quantity}</td>
                  <td className="px-4 py-3 border">{editing?<input type="number" value={editValues.price||0} onChange={e=>setEditValues(v=>({...v,price:+e.target.value}))} className="border p-1 w-24 text-sm"/>:`£${r.price.toFixed(2)}`}</td>
                  <td className="px-4 py-3 border">{r.source}</td>
                  <td className="px-4 py-3 border flex gap-1 justify-center">
                    {editing?<>
                      <button onClick={handleEditSave} className="bg-green-500 hover:bg-green-600 text-white px-2 py-0.5 text-sm rounded">Save</button>
                      <button onClick={()=>setEditingId(null)} className="bg-gray-400 hover:bg-gray-500 text-white px-2 py-0.5 text-sm rounded">Cancel</button>
                    </>:<>
                      <button onClick={()=>handleEdit(r)} className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-0.5 text-sm rounded">Edit</button>
                      <button onClick={()=>handleDelete(r.id)} className="bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 text-sm rounded">Delete</button>
                    </>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Toast */}
      <div className={`fixed bottom-6 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded shadow text-white transition-all duration-500 
        ${toast.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}
        ${toast.type==='success'?'bg-green-500':'bg-red-500'}
      `}>
        {toast.message}
      </div>
    </main>
  )
}
