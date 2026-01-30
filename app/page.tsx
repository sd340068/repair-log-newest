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

  // Fetch data
  const fetchRepairs = async () => {
    const { data, error } = await supabase
      .from('repairs')
      .select('*')
      .order('date_sold', { ascending: false })

    if (error) {
      console.error(error)
    } else {
      setRepairs(data || [])
    }
  }

  useEffect(() => {
    fetchRepairs()
  }, [])

  // CSV Upload handler
  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)

    // 🔑 Dynamic import — THIS is what fixes Vercel
    const Papa = (await import('papaparse')).default

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results: any) => {
        const rows = results.data.map((row: any) => ({
          listing_id: row['Order number'],
          item_name: row['Item title'],
          price: Number(
            String(row['Total price']).replace(/[^0-9.-]+/g, '')
          ),
          quantity: Number(row['Quantity'] || 1),
          date_sold: new Date(row['Sale date']).toISOString(),
          source: 'csv',
        }))

        const { error } = await supabase
          .from('repairs')
          .upsert(rows, { onConflict: 'listing_id' })

        if (error) {
          console.error(error)
          alert('Import failed')
        } else {
          await fetchRepairs()
          alert('Imported successfully')
        }

        setLoading(false)
      },
    })
  }

  return (
    <main style={{ padding: 20 }}>
      <h1>Repair Log</h1>

      <input
        type="file"
        accept=".csv"
        onChange={handleFileUpload}
      />

      {loading && <p>Importing…</p>}

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
