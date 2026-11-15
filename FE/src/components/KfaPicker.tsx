import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, LoaderCircle, PenLine, Search, X } from 'lucide-react'
import { searchKfaDrugs } from '@/lib/clinical'
import type { KfaDrug } from '@/lib/types'

export type KfaValue = { code: string; display: string; unit: string } | null

export function KfaPicker({
  value,
  onChange,
  onSelectManual,
  placeholder = 'Pilih atau cari obat KFA...',
  id,
}: {
  value: KfaValue
  onChange: (value: KfaValue) => void
  onSelectManual?: () => void
  placeholder?: string
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const search = useQuery({
    queryKey: ['kfa', q],
    queryFn: () => searchKfaDrugs(q),
    enabled: open,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-[#d2e1e7] bg-white px-3 text-left text-[13px] outline-none focus-visible:border-ch-brand"
      >
        <span className={`truncate ${value ? 'font-medium text-ch-ink' : 'text-[#a3b1bf]'}`}>
          {value ? `${value.display} (KFA ${value.code})` : placeholder}
        </span>
        <span className="flex items-center gap-1">
          {value && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Hapus pilihan"
              onClick={(e) => {
                e.stopPropagation()
                onChange(null)
              }}
              className="grid size-5 place-items-center rounded-full text-[#71859a] hover:bg-[#e6eef2]"
            >
              <X className="size-3.5" />
            </span>
          )}
          <ChevronDown className="size-4 text-[#71859a]" />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-11 z-30 rounded-[12px] border border-[#d3e2e8] bg-white p-2 shadow-xl">
          <label className="relative block">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ch-brand" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari nama obat atau kode KFA (mis. Paracetamol, Amox, 9300...)"
              className="h-9 w-full rounded-[8px] border border-[#d6e3e9] pl-9 pr-3 text-[13px] outline-none focus:border-ch-brand"
            />
          </label>

          <div role="listbox" className="mt-1.5 max-h-60 overflow-auto divide-y divide-[#edf3f6]">
            {search.isFetching ? (
              <p className="flex items-center gap-2 px-3 py-3 text-xs text-ch-muted">
                <LoaderCircle className="size-3.5 animate-spin" /> Memuat katalog obat KFA…
              </p>
            ) : !search.data?.length ? (
              <div className="p-3 text-center text-xs text-ch-muted">
                <p>Obat tidak ditemukan di katalog KFA terdaftar.</p>
                {onSelectManual && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectManual()
                      setOpen(false)
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 font-semibold text-ch-brand hover:underline"
                  >
                    <PenLine className="size-3.5" /> Tulis nama obat manual
                  </button>
                )}
              </div>
            ) : (
              search.data.map((item: KfaDrug) => (
                <button
                  key={item.code}
                  type="button"
                  role="option"
                  aria-selected={value?.code === item.code}
                  onClick={() => {
                    onChange({ code: item.code, display: item.display, unit: item.dose_unit })
                    setOpen(false)
                    setQ('')
                  }}
                  className={`flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-[#eef6f8] ${
                    value?.code === item.code ? 'bg-[#e6f6f8]' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ch-ink leading-snug">{item.display}</p>
                    <p className="mt-0.5 text-[11px] text-ch-muted">
                      Bentuk: <span className="font-semibold text-[#405669]">{item.form}</span> · Satuan: {item.dose_unit}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[#b8e2ea] bg-[#eef8fa] px-2 py-0.5 text-[10px] font-bold text-ch-teal">
                    KFA {item.code}
                  </span>
                </button>
              ))
            )}
          </div>

          {onSelectManual && (
            <div className="mt-2 border-t border-[#e2edf1] pt-2">
              <button
                type="button"
                onClick={() => {
                  onSelectManual()
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-ch-brand hover:bg-[#f0f9fa]"
              >
                <PenLine className="size-3.5" /> Tulis obat manual (non-KFA / racikan khusus)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
