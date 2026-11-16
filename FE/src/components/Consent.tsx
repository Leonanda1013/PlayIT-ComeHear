import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, UserCheck } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { visitPath } from '@/lib/clinical'
import { btn, Dialog, inputClass, SelectInput } from '@/components/ui/kit'
import type { Consultation } from '@/lib/types'

export type Decision = 'setuju' | 'tolak' | ''

export const RELATIONS = [
  { value: 'pasien', label: 'Pasien Sendiri' },
  { value: 'pasangan', label: 'Pasangan (Suami/Istri)' },
  { value: 'ibu', label: 'Ibu' },
  { value: 'ayah', label: 'Ayah' },
  { value: 'anak', label: 'Anak' },
  { value: 'wali', label: 'Wali' },
  { value: 'keluarga', label: 'Keluarga' },
  { value: 'lainnya', label: 'Lainnya' },
] as const

export function initialDecision(data: Consultation): Decision {
  if (data.visit.status === 'manual') return 'tolak'
  const c = data.visit.consent as { decision?: string } | null
  if (c?.decision === 'tolak') return 'tolak'
  if (c?.decision === 'setuju') return 'setuju'
  return data.visit.status === 'consented' ? 'setuju' : data.visit.consent ? 'setuju' : ''
}

/** Persetujuan rekaman: pilihan langsung tampil, penyimpanan ke server berjalan di belakang (berurutan, pilihan terakhir menang). */
export function useConsent(data: Consultation, onError: (message: string) => void) {
  const id = data.visit.id
  const patientName = data.visit.patient.name
  const consentObj = data.visit.consent as { decision?: string; given_by_name?: string; relation?: string } | null
  const queryClient = useQueryClient()
  const [consent, setConsent] = useState<Decision>(() => initialDecision(data))
  const [givenByName, setGivenByName] = useState<string>(() => consentObj?.given_by_name || patientName)
  const [relation, setRelation] = useState<string>(() => consentObj?.relation || 'pasien')
  const saving = useRef<Promise<unknown>>(Promise.resolve())

  function decide(decision: 'setuju' | 'tolak', customGiver?: string, customRel?: string) {
    if (decision === consent && !customGiver && !customRel) return
    const previous = consent
    setConsent(decision)
    const giver = (customGiver || givenByName || patientName).trim()
    const rel = (customRel || relation || 'pasien').trim().toLowerCase()
    if (customGiver) setGivenByName(giver)
    if (customRel) setRelation(rel)

    saving.current = saving.current.catch(() => undefined).then(async () => {
      const body = new FormData()
      body.set('decision', decision)
      body.set('given_by_name', giver || patientName)
      body.set('relation', rel || 'pasien')
      await apiRequest(visitPath(id, '/consent'), { method: 'POST', body })
      void queryClient.invalidateQueries({ queryKey: ['consultation', id] })
    })
    saving.current.catch((caught) => {
      setConsent(previous)
      onError(caught instanceof Error ? caught.message : 'Persetujuan gagal disimpan. Coba pilih lagi.')
    })
  }

  return { consent, decide, givenByName, setGivenByName, relation, setRelation, saved: () => saving.current }
}

export function ConsentBlock({
  consent,
  onDecide,
  disabled,
  patientName = '',
  givenByName,
  relation = 'pasien',
  onUpdateGiver,
}: {
  consent: Decision
  onDecide: (decision: 'setuju' | 'tolak', giver?: string, rel?: string) => void
  disabled?: boolean
  patientName?: string
  givenByName?: string
  relation?: string
  onUpdateGiver?: (name: string, rel: string) => void
}) {
  const [showTerms, setShowTerms] = useState(false)
  const [showConfirmSetuju, setShowConfirmSetuju] = useState(false)
  const [showGiverDetails, setShowGiverDetails] = useState(relation !== 'pasien')
  const currentGiver = givenByName || patientName

  function handleSelectSetuju() {
    if (consent === 'tolak') {
      setShowConfirmSetuju(true)
    } else {
      onDecide('setuju', currentGiver, relation)
    }
  }

  function handleRelationChange(newRel: string) {
    const isSelf = newRel === 'pasien'
    const name = isSelf ? patientName : currentGiver === patientName ? '' : currentGiver
    if (onUpdateGiver) onUpdateGiver(name, newRel)
    if (consent) onDecide(consent, name, newRel)
  }

  function handleNameChange(newName: string) {
    if (onUpdateGiver) onUpdateGiver(newName, relation)
  }

  function handleNameBlur() {
    if (consent && onUpdateGiver) onDecide(consent, currentGiver, relation)
  }

  return (
    <>
      <div className="mt-3 border-t border-[#dce6eb] pt-3">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_456px]">
          <div className="lg:border-r lg:border-[#dce6eb] lg:pr-4">
            <h3 className="text-[15px] font-semibold leading-5 text-ch-ink">Persetujuan Rekaman Percakapan Klinis</h3>
            <p className="mt-1.5 text-[11px] leading-4 text-[#5f7284]">Sesuai UU PDP No. 27/2022 &amp; Permenkes RI No. 24/2022.</p>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-4 text-[#5f7284]">
              <li>• Tujuan: Otomatisasi draf anamnesis (SOAP Subjektif) &amp; arsip riwayat konsultasi pasien.</li>
              <li>• Penyimpanan: Audio &amp; transkrip disimpan di server lokal fasilitas kesehatan (tanpa enkripsi khusus di tingkat aplikasi).</li>
              <li>• Pemrosesan AI: Transkrip percakapan diproses melalui layanan model AI (pihak ketiga) hanya untuk kebutuhan ekstraksi draf klinis.</li>
              <li>• Pelatihan Model: Data rekaman dan transkrip percakapan tidak digunakan untuk melatih atau mengembangkan model AI internal maupun pihak ketiga.</li>
            </ul>
            <button
              type="button"
              onClick={() => setShowTerms(true)}
              className="mt-2 inline-block text-[11px] font-medium text-ch-brand hover:underline"
            >
              [Pelajari Ketentuan Kerahasiaan Data &amp; AI ↗]
            </button>
          </div>
          <div>
            <div role="radiogroup" aria-label="Persetujuan perekaman" className="space-y-2">
              <ConsentOption
                active={consent === 'setuju'}
                disabled={disabled}
                onClick={handleSelectSetuju}
              >
                Pasien Menyetujui Perekaman (AI Scribe Aktif)
              </ConsentOption>
              <ConsentOption
                active={consent === 'tolak'}
                disabled={disabled}
                onClick={() => onDecide('tolak', currentGiver, relation)}
              >
                Pasien Menolak Perekaman (Pencatatan Manual)
              </ConsentOption>
            </div>

            {/* Identitas Pemberi Persetujuan (Pasien sendiri atau Wali/Keluarga) */}
            <div className="mt-3 rounded-[10px] border border-[#e2ecf0] bg-[#fbfdfe] p-2.5 text-xs text-[#4a5f70]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium">
                  <UserCheck className="size-3.5 text-ch-teal" /> Pemberi persetujuan:{' '}
                  <b>{relation === 'pasien' ? 'Pasien Sendiri' : `${RELATIONS.find((r) => r.value === relation)?.label || relation} (${currentGiver || '—'})`}</b>
                </span>
                <button
                  type="button"
                  onClick={() => setShowGiverDetails(!showGiverDetails)}
                  className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-ch-teal hover:underline"
                >
                  {showGiverDetails ? 'Sembunyikan' : 'Ubah Wali/Keluarga'}
                  <ChevronDown className={`size-3 transition-transform ${showGiverDetails ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {showGiverDetails && (
                <div className="mt-2.5 grid gap-2 sm:grid-cols-2 border-t border-[#e8f0f3] pt-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-[#5a6e80]">Hubungan dengan pasien</label>
                    <SelectInput
                      aria-label="Hubungan dengan pasien"
                      value={relation}
                      onChange={(e) => handleRelationChange(e.target.value)}
                      className="h-8 text-[12px]"
                      disabled={disabled}
                    >
                      {RELATIONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </SelectInput>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-[#5a6e80]">Nama pemberi persetujuan</label>
                    <input
                      type="text"
                      className={`${inputClass} h-8 text-[12px]`}
                      value={currentGiver}
                      onChange={(e) => handleNameChange(e.target.value)}
                      onBlur={handleNameBlur}
                      placeholder="Nama lengkap pemberi"
                      disabled={disabled || relation === 'pasien'}
                    />
                  </div>
                </div>
              )}
            </div>

            <p className="mt-2 text-[11px] text-[#8a9bad]">Diverifikasi verbal oleh perawat/dokter saat pasien masuk.</p>
          </div>
        </div>
        <div className="h-[30px]" />
      </div>

      <Dialog open={showTerms} onClose={() => setShowTerms(false)} title="Ringkasan Ketentuan Kerahasiaan Data & AI" width={560}>
        <div className="space-y-3.5 text-[13px] leading-relaxed text-[#33475b]">
          <p className="text-xs text-ch-muted">
            Berikut adalah ringkasan ketentuan privasi dan pemrosesan kecerdasan buatan (AI) pada alur konsultasi ComeHear:
          </p>
          <div className="rounded-[10px] border border-[#dce6eb] bg-[#f8fbfc] p-3.5 space-y-2.5">
            <div>
              <p className="font-semibold text-ch-ink">1. Tujuan Pemrosesan</p>
              <p className="text-xs text-[#526578]">
                Perekaman percakapan klinis semata-mata ditujukan untuk menghasilkan draf awal catatan anamnesis (SOAP Subjektif) guna mempercepat kerja administratif tenaga medis.
              </p>
            </div>
            <div>
              <p className="font-semibold text-ch-ink">2. Penyimpanan &amp; Retensi</p>
              <p className="text-xs text-[#526578]">
                Berkas audio dan transkrip percakapan disimpan pada media penyimpanan server lokal faskes. Berkas audio dapat dihapus dari server setelah resume medis divalidasi dan disahkan oleh dokter.
              </p>
            </div>
            <div>
              <p className="font-semibold text-ch-ink">3. Penggunaan Layanan Pihak Ketiga</p>
              <p className="text-xs text-[#526578]">
                Teks transkrip percakapan dikirimkan secara aman melalui saluran API ke penyedia model kecerdasan buatan (pihak ketiga) semata-mata untuk proses ekstraksi struktur medis SOAP.
              </p>
            </div>
            <div>
              <p className="font-semibold text-ch-ink">4. Tidak Digunakan untuk Pelatihan Model</p>
              <p className="text-xs text-[#526578]">
                Data rekaman audio maupun teks transkrip percakapan pasien tidak digunakan sebagai data pelatihan (training) model kecerdasan buatan, baik bagi model internal faskes maupun penyedia pihak ketiga.
              </p>
            </div>
            <div>
              <p className="font-semibold text-ch-ink">5. Kendali Penuh &amp; Hak Pasien</p>
              <p className="text-xs text-[#526578]">
                Dokter penanggung jawab memegang kendali penuh untuk meninjau, menyunting, atau membatalkan seluruh isi draf AI. Pasien berhak menolak perekaman tanpa mengurangi hak pelayanan kesehatan standar (dilanjutkan dengan pencatatan manual).
              </p>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button type="button" onClick={() => setShowTerms(false)} className={btn.primary}>
              Tutup
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog open={showConfirmSetuju} onClose={() => setShowConfirmSetuju(false)} title="Konfirmasi Perubahan Persetujuan" width={520}>
        <div className="space-y-3.5 text-[13px] leading-relaxed text-[#33475b]">
          <p>
            Sebelumnya pasien tercatat <strong className="font-semibold text-[#b42727]">MENOLAK</strong> perekaman percakapan klinis.
          </p>
          <p className="text-xs text-[#526578]">
            Pastikan pasien atau wali pendamping telah secara lisan menyatakan menyetujui perekaman sebelum mengaktifkan AI Scribe.
          </p>
          <div className="rounded-[10px] border border-[#f0c27b] bg-[#fffaf0] p-3 text-xs text-[#78350f]">
            <strong className="block font-semibold">Peringatan Audit (UU PDP No. 27/2022):</strong>
            <span className="mt-0.5 block leading-normal">
              Perubahan status dari penolakan ke persetujuan akan dicatat secara permanen dalam riwayat audit atas nama akun Anda.
            </span>
          </div>
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setShowConfirmSetuju(false)}
              className="inline-flex h-9 items-center rounded-[8px] border border-[#cfdbe2] bg-[#f0f4f7] px-4 text-[13px] font-semibold text-[#4b5f70] hover:bg-[#e4ecf0]"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => {
                setShowConfirmSetuju(false)
                onDecide('setuju', currentGiver, relation)
              }}
              className="inline-flex h-9 items-center rounded-[8px] bg-ch-brand px-4 text-[13px] font-semibold text-white hover:bg-ch-brand-hover shadow-sm"
            >
              Ya, Pasien Menyetujui
            </button>
          </div>
        </div>
      </Dialog>
    </>
  )
}

function ConsentOption({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="radio" aria-checked={active} disabled={disabled} onClick={onClick}
    className={`flex h-9 w-full items-center gap-2.5 rounded-full border px-3 text-left text-[13px] transition-colors disabled:cursor-not-allowed ${active ? 'border-[#8fd6e1] bg-[#dff4f7] font-medium text-[#0b6e7d]' : 'border-[#dce6eb] bg-[#f8fbfc] text-[#33475b] hover:bg-[#eef6f8]'}`}>
    <span className={`grid size-3.5 shrink-0 place-items-center rounded-full border ${active ? 'border-[#0b8597] bg-white' : 'border-[#5f7284] bg-white'}`}>{active && <span className="size-2 rounded-full bg-[#0b8597]" />}</span>{children}
  </button>
}
