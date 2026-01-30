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

  const [manual, setManual] = useState({
    listing_id: '',
    item_name: '',
    price: '',
    quantity: '',
    date_sold: '',
  })

  // Fetch repairs from Supabase
  const fetchRepairs = async () => {
    const { data, error } = await supabase
      .from('repairs')
      .select('*')
      .order('date_sold', { ascending: false })
    if (error) console.error(error)
    else setRepairs(data || [])
  }

  useEffect(() => {
    fetchRepairs()
  }, [])

  // CSV Upload handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)

    try {
      const Papa = (await import('papaparse')).default

      const parseCSV = (file: File) =>
        new Promise<any[]>((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            worker: true,
            beforeFirstChunk: (chunk) => {
              // Remove first row (row 1) if it contains titles or blank
              const lines = chunk.split(/\r?\n/)
              lines.shift()
              return lines.join('\n')
            },
            complete: (results) => resolve(results.data),
            error: (err) => reject(err),
          })
        })

      const data = await parseCSV(file)
      console.log('Parsed CSV data:', data)

      const rows = data.map((row: any) => ({
        listing_id:
          row['Order number'] || row['Order #'] || row['order number'] || '',
        item_name:
          row['Item title'] || row['Item Name'] || row['item title'] || '',
        price: Number(
          String(row['Total price'] || row['Price'] || '0').replace(/[^0-9.-]+/g, '')
        ),
        quantity: Number(row['Quantity'] || row['Qty'] || 1),
        date_sold:
          new Date(row['Sale date'] || row['Date Sold'] || Date.now()).toISOString(),
        source: 'csv',
      }))

      const validRows = rows.filter((r) => r.listing_id)

      if (validRows.length === 0) {
        alert('No valid rows found in CSV')
        setLoading(false)
        return
      }

      const { error } = await supabase
        .from('repairs')
        .upsert(validRows, { onConflict: 'listing_id' })

      if (error) {
        console.error(error)
        alert('Import failed: ' + error.message)
      } else {
        await fetchRepairs()
        alert(`Imported ${validRows.length} rows successfully`)
      }
    } catch (err: any) {
      console.error('CSV parsing error:', err)
      alert('CSV parsing failed. Check console for details.')
    } finally {
      setLoading(false)
    }
  }

  // Manual order submission
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
        console.error(error)
        alert('Failed to add repair')
      } else {
        setManual({ listing_id: '', item_name: '', price: '', quantity: '', date_sold: '' })
        await fetchRepairs()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ padding: 20 }}>
      <h1>Repair Log</h1>

      {/* CSV Import */}
      <div style={{ marginBottom: 20 }}>
        <input type="file" accept=".csv" onChange={handleFileUpload} />
      </div>

      {loading && <p>Processing…</p>}

      {/* Manual Entry */}
      <form onSubmit={handleManualSubmit} style={{ marginBottom: 20 }}>
        <h2>Manual Entry</h2>
        <input
          type="text"
          placeholder="Order #"
          value={manual.listing_id}
          onChange={(e) => setManual({ ...manual, listing_id: e.target.value })}
          required
        />
        <input
          type="text"
          placeholder="Item Name"
          value={manual.item_name}
          onChange={(e) => setManual({ ...manual, item_name: e.target.value })}
          required
        />
        <input
          type="number"
          placeholder="Price"
          value={manual.price}
          onChange={(e) => setManual({ ...manual, price: e.target.value })}
          required
        />
        <input
          type="number"
          placeholder="Quantity"
          value={manual.quantity}
          onChange={(e) => setManual({ ...manual, quantity: e.target.value })}
          required
        />
        <input
          type="date"
          placeholder="Date Sold"
          value={manual.date_sold}
          onChange={(e) => setManual({ ...manual, date_sold: e.target.value })}
          required
        />
        <button type="submit" style={{ marginLeft: 10 }}>
          Add Repair
        </button>
      </form>

      {/* Table */}
      <table
        border={1}
        cellPadding={6}
        style={{ marginTop: 20, width: '100%' }}
      >
        <thead>
          <tr>
            <th>Date Sold</th>
            <th>Item</th>
            <th>Order #</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {repairs.map((r) => (
            <tr key={r.id}>
              <td>{r.date_sold.slice(0, 10)}</td>
              <td>{r.item_name}</td>
              <td>{r.listing_id}</td>
              <td>{r.quantity}</td>
              <td>£{r.price.toFixed(2)}</td>
              <td>{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
