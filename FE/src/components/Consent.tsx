import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/lib/api'
import { visitPath } from '@/lib/clinical'
import type { Consultation } from '@/lib/types'

export type Decision = 'setuju' | 'tolak' | ''

export function initialDecision(data: Consultation): Decision {
  return data.visit.status === 'manual' ? 'tolak' : data.visit.consent ? 'setuju' : ''
}

/** Persetujuan rekaman: pilihan langsung tampil, penyimpanan ke server berjalan di belakang (berurutan, pilihan terakhir menang). */
export function useConsent(data: Consultation, onError: (message: string) => void) {
  const id = data.visit.id
  const queryClient = useQueryClient()
  const [consent, setConsent] = useState<Decision>(() => initialDecision(data))
  const saving = useRef<Promise<unknown>>(Promise.resolve())

  function decide(decision: 'setuju' | 'tolak') {
    if (decision === consent) return
    const previous = consent
    setConsent(decision)
    saving.current = saving.current.catch(() => undefined).then(async () => {
      const body = new FormData(); body.set('decision', decision)
      await apiRequest(visitPath(id, '/consent'), { method: 'POST', body })
      void queryClient.invalidateQueries({ queryKey: ['consultation', id] })
    })
    saving.current.catch((caught) => { setConsent(previous); onError(caught instanceof Error ? caught.message : 'Persetujuan gagal disimpan. Coba pilih lagi.') })
  }

  return { consent, decide, saved: () => saving.current }
}

export function ConsentBlock({ consent, onDecide, disabled }: { consent: Decision; onDecide: (decision: 'setuju' | 'tolak') => void; disabled?: boolean }) {
  return <div className="mt-3 border-t border-[#dce6eb] pt-3">
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_456px]">
      <div className="lg:border-r lg:border-[#dce6eb] lg:pr-4">
        <h3 className="text-[15px] font-semibold leading-5 text-ch-ink">Persetujuan Rekaman Percakapan Klinis</h3>
        <p className="mt-1.5 text-[11px] leading-4 text-[#5f7284]">Sesuai UU PDP No. 27/2022 &amp; Permenkes RI No. 24/2022.</p>
        <ul className="mt-2 space-y-1.5 text-[11px] leading-4 text-[#5f7284]">
          <li>• Tujuan: Otomatisasi draf anamnesis (SOAP Subjektif) &amp; arsip riwayat konsultasi pasien.</li>
          <li>• Penyimpanan: Audio &amp; transkrip disimpan terenkripsi di server lokal klinik (tidak dikirim ke pihak ketiga).</li>
          <li>• Pengembangan Model: Data rekaman digunakan khusus untuk peningkatan performa model internal faskes dengan penyamaran identitas (de-identification).</li>
        </ul>
        <a href="#ketentuan" onClick={(e) => e.preventDefault()} className="mt-2 inline-block text-[11px] font-medium text-ch-brand hover:underline">[Pelajari Ketentuan Kerahasiaan Data &amp; AI ↗]</a>
      </div>
      <div>
        <div role="radiogroup" aria-label="Persetujuan perekaman" className="space-y-2">
          <ConsentOption active={consent === 'setuju'} disabled={disabled} onClick={() => onDecide('setuju')}>Pasien Menyetujui Perekaman (AI Scribe Aktif)</ConsentOption>
          <ConsentOption active={consent === 'tolak'} disabled={disabled} onClick={() => onDecide('tolak')}>Pasien Menolak Perekaman (Pencatatan Manual)</ConsentOption>
        </div>
        <p className="mt-4 text-[11px] text-[#8a9bad]">Diverifikasi verbal oleh perawat/dokter saat pasien masuk.</p>
      </div>
    </div>
    <div className="h-[30px]" />
  </div>
}

function ConsentOption({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="radio" aria-checked={active} disabled={disabled} onClick={onClick}
    className={`flex h-9 w-full items-center gap-2.5 rounded-full border px-3 text-left text-[13px] transition-colors disabled:cursor-not-allowed ${active ? 'border-[#8fd6e1] bg-[#dff4f7] font-medium text-[#0b6e7d]' : 'border-[#dce6eb] bg-[#f8fbfc] text-[#33475b] hover:bg-[#eef6f8]'}`}>
    <span className={`grid size-3.5 shrink-0 place-items-center rounded-full border ${active ? 'border-[#0b8597] bg-white' : 'border-[#5f7284] bg-white'}`}>{active && <span className="size-2 rounded-full bg-[#0b8597]" />}</span>{children}
  </button>
}
