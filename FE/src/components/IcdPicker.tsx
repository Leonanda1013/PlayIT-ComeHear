import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, LoaderCircle, Search, X } from 'lucide-react'
import { apiRequest } from '@/lib/api'

export type IcdValue = { code: string; display: string } | null

/** Pencarian ICD-10 SATUSEHAT (GET /api/icd?q=). Hasil memperlihatkan kode + deskripsi agar dokter bisa memeriksa pilihannya. */
export function IcdPicker({ value, onChange, placeholder = 'ICD-10', id }: { value: IcdValue; onChange: (value: IcdValue) => void; placeholder?: string; id?: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const search = useQuery({
    queryKey: ['icd', q], queryFn: () => apiRequest<{ code: string; display: string }[]>(`/api/icd?q=${encodeURIComponent(q)}`),
    enabled: open && q.trim().length >= 2, staleTime: 5 * 60_000,
  })
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return <div ref={ref} className="relative">
    <button id={id} type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-10 w-full items-center justify-between gap-2 rounded-full border border-[#d2e1e7] bg-ch-field px-4 text-left text-[13px] outline-none focus-visible:border-ch-brand">
      <span className={`truncate ${value ? 'text-ch-ink' : 'text-[#a3b1bf]'}`}>{value ? `${value.code} - ${value.display}` : placeholder}</span>
      <span className="flex items-center gap-1">{value && <span role="button" tabIndex={-1} aria-label="Hapus kode" onClick={(e) => { e.stopPropagation(); onChange(null) }} className="grid size-5 place-items-center rounded-full text-[#71859a] hover:bg-[#e6eef2]"><X className="size-3.5" /></span>}<ChevronDown className="size-4 text-[#71859a]" /></span>
    </button>
    {open && <div className="absolute left-0 right-0 top-12 z-30 rounded-[12px] border border-[#d3e2e8] bg-white p-2 shadow-lg">
      <label className="relative block"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ch-brand" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode atau nama Inggris (mis. H81, vertigo, fever)" className="h-9 w-full rounded-[8px] border border-[#d6e3e9] pl-9 pr-3 text-[13px] outline-none focus:border-ch-brand" /></label>
      <div role="listbox" className="mt-1 max-h-64 overflow-auto">
        {q.trim().length < 2 ? <p className="px-2 py-3 text-xs text-ch-muted">Ketik minimal 2 huruf.</p>
          : search.isFetching ? <p className="flex items-center gap-2 px-2 py-3 text-xs text-ch-muted"><LoaderCircle className="size-3.5 animate-spin" /> Mencari…</p>
          : !search.data?.length ? <p className="px-2 py-3 text-xs text-ch-muted">Kode tidak ditemukan di tabel ICD-10 SATUSEHAT.</p>
          : search.data.map((item) => <button key={item.code} type="button" role="option" aria-selected={value?.code === item.code} onClick={() => { onChange(item); setOpen(false); setQ('') }} className="flex w-full gap-2 rounded-[8px] px-2 py-2 text-left text-[13px] hover:bg-[#eef6f8]"><b className="w-14 shrink-0 text-ch-teal">{item.code}</b><span>{item.display}</span></button>)}
      </div>
    </div>}
  </div>
}
