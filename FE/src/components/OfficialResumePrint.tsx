import type { ClinicalNote, Consultation, Resume } from '@/lib/types'
import { dateId, dateShort } from '@/lib/format'
import { formatWib } from '@/lib/clinical'

type ApExtra = {
  tindakan?: string
  plan?: string
  dx?: { text: string; icd: { code: string; display: string } | null; onset: string }[]
  with_rx?: boolean
  rx?: unknown[]
  next_date?: string
  next_note?: string
}

function getVital(note: ClinicalNote, key: string, unit: string) {
  const v = note.vitals?.[key]
  return v === undefined || v === null ? '—' : `${v} ${unit}`
}

export function OfficialResumePrint({
  consultation,
  resume,
  doctorName,
}: {
  consultation: Consultation
  resume?: Resume | null
  doctorName?: string
}) {
  const { visit, note } = consultation
  const patient = visit.patient
  const location = visit.location
  const snapshot = note.approved_snapshot as {
    approved_at?: string
    practitioner?: { name?: string; ihs_number?: string }
  } | null

  const dpjp =
    doctorName ||
    snapshot?.practitioner?.name ||
    'dr. Rian Pratama, Sp.PD'

  const ap = (note.extra?.asesmen_plan || {}) as ApExtra
  const diagnoses = note.diagnoses || []

  const bpVal = note.vitals?.systolic ? `${note.vitals.systolic}/${note.vitals.diastolic} mmHg` : '—'
  const hrVal = getVital(note, 'heart_rate', 'x/menit')
  const tempVal = getVital(note, 'body_temperature', '°C')
  const rrVal = getVital(note, 'respiratory_rate', 'x/menit')
  const spo2Val = getVital(note, 'oxygen_saturation', '%')
  const weightVal = getVital(note, 'body_weight', 'kg')
  const heightVal = getVital(note, 'body_height', 'cm')

  const isApproved = consultation.locked || note.approved || !!snapshot?.approved_at

  return (
    <div className="official-resume-doc text-black bg-white mx-auto font-sans leading-normal">
      {/* ===================== KOP SURAT RESMI ===================== */}
      <header className="border-b-[3px] border-black pb-2 mb-1">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src="/comehear-logo.png"
              alt="Logo Faskes"
              className="h-12 w-auto object-contain print:block"
            />
          </div>
          <div className="text-right flex-1">
            <h1 className="text-[17px] font-black uppercase tracking-wider text-neutral-900 leading-tight">
              KLINIK PRATAMA COMEHEAR
            </h1>
            <p className="text-[10px] font-semibold text-neutral-700 tracking-wide">
              LAYANAN KESEHATAN RAWAT JALAN &amp; REKAM MEDIS ELEKTRONIK
            </p>
            <p className="text-[9.5px] text-neutral-600 mt-0.5">
              Jl. Prof. Dr. Satrio No. 18, Setiabudi, Jakarta Selatan 12940 · Telp: (021) 2995-1000
            </p>
            <p className="text-[9px] text-neutral-500">
              Izin Operasional: 445/012/K-PRATAMA/DPMPTSP/2023 · Kode Faskes Kemenkes: 317101234
            </p>
          </div>
        </div>
      </header>
      <div className="border-b border-black mb-3.5" />

      {/* ===================== JUDUL DOKUMEN ===================== */}
      <div className="text-center mb-3">
        <h2 className="text-[14px] font-extrabold tracking-wider uppercase text-neutral-900">
          RINGKASAN REKAM MEDIS RAWAT JALAN (RESUME MEDIS)
        </h2>
        <div className="flex items-center justify-center gap-3 text-[10px] text-neutral-600 mt-0.5">
          <span>Standar Permenkes RI No. 24 Tahun 2022</span>
          <span>·</span>
          <span>No. Registrasi: <b className="font-mono text-neutral-900">{visit.code}</b></span>
          <span>·</span>
          <span className={`font-semibold px-2 py-0.2 rounded ${isApproved ? 'bg-neutral-100 text-neutral-900' : 'bg-amber-100 text-amber-900'}`}>
            {isApproved ? 'DOKUMEN RESMI (TERVALIDASI)' : 'DRAF (BELUM DIVALIDASI DPJP)'}
          </span>
        </div>
      </div>

      {/* ===================== TABEL IDENTITAS PASIEN ===================== */}
      <div className="mb-3.5 print-avoid-break">
        <table className="w-full text-[10px] border border-neutral-400 border-collapse">
          <tbody>
            <tr className="border-b border-neutral-300">
              <td className="w-[18%] bg-neutral-100/90 px-2 py-1 font-semibold text-neutral-700">No. Rekam Medis (RM)</td>
              <td className="w-[32%] px-2 py-1 font-bold text-neutral-900 font-mono text-[11px]">{patient.rm_number}</td>
              <td className="w-[18%] bg-neutral-100/90 px-2 py-1 font-semibold text-neutral-700">Tgl. Registrasi / Jam</td>
              <td className="w-[32%] px-2 py-1 text-neutral-900 font-medium">{formatWib(visit.arrived_at || visit.called_at || visit.started_at || snapshot?.approved_at || visit.consent?.given_at)}</td>
            </tr>
            <tr className="border-b border-neutral-300">
              <td className="bg-neutral-100/90 px-2 py-1 font-semibold text-neutral-700">Nama Lengkap Pasien</td>
              <td className="px-2 py-1 font-bold text-neutral-900 text-[11px] uppercase">{patient.name}</td>
              <td className="bg-neutral-100/90 px-2 py-1 font-semibold text-neutral-700">Poli / Unit Layanan</td>
              <td className="px-2 py-1 font-bold text-neutral-900">{location.poli || location.name}</td>
            </tr>
            <tr className="border-b border-neutral-300">
              <td className="bg-neutral-100/90 px-2 py-1 font-semibold text-neutral-700">Tanggal Lahir / Usia</td>
              <td className="px-2 py-1 text-neutral-900">{dateId(patient.birth_date)} ({patient.usia || '—'})</td>
              <td className="bg-neutral-100/90 px-2 py-1 font-semibold text-neutral-700">Dokter DPJP</td>
              <td className="px-2 py-1 font-bold text-neutral-900">{dpjp}</td>
            </tr>
            <tr className="border-b border-neutral-300">
              <td className="bg-neutral-100/90 px-2 py-1 font-semibold text-neutral-700">Jenis Kelamin</td>
              <td className="px-2 py-1 text-neutral-900">{patient.gender_label || '—'}</td>
              <td className="bg-neutral-100/90 px-2 py-1 font-semibold text-neutral-700">No. Kontak / Telepon</td>
              <td className="px-2 py-1 text-neutral-900">{patient.phone || '—'}</td>
            </tr>
            <tr>
              <td className="bg-neutral-100/90 px-2 py-1 font-semibold text-neutral-700">NIK / No. IHS Pasien</td>
              <td className="px-2 py-1 text-neutral-900 font-mono">
                {patient.nik || '—'} {patient.ihs_number ? `(${patient.ihs_number})` : ''}
              </td>
              <td className="bg-neutral-100/90 px-2 py-1 font-semibold text-neutral-700">Alamat Pasien</td>
              <td className="px-2 py-1 text-neutral-900 truncate max-w-[220px]">{patient.address || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ===================== I. SUBJEKTIF (ANAMNESIS) ===================== */}
      <div className="mb-3 print-avoid-break">
        <div className="bg-neutral-200/90 border border-neutral-400 border-b-0 px-2.5 py-1 font-bold text-[10.5px] text-neutral-900 uppercase tracking-wide flex justify-between items-center">
          <span>I. Anamnesis (Subjektif)</span>
          <span className="text-[9px] font-normal text-neutral-600">Pencatatan Klinis Terverifikasi</span>
        </div>
        <table className="w-full text-[10px] border border-neutral-400 border-collapse">
          <tbody>
            <tr className="border-b border-neutral-300">
              <td className="w-[26%] bg-neutral-50 px-2 py-1.5 font-semibold text-neutral-700 align-top">
                Keluhan Utama
              </td>
              <td className="px-2 py-1.5 text-neutral-900 font-bold">
                {note.subjective?.keluhan_utama || '—'}
              </td>
            </tr>
            <tr className="border-b border-neutral-300">
              <td className="bg-neutral-50 px-2 py-1.5 font-semibold text-neutral-700 align-top">
                Riwayat Penyakit Sekarang (RPS)
              </td>
              <td className="px-2 py-1.5 text-neutral-900 whitespace-pre-line leading-relaxed">
                {note.subjective?.riwayat_penyakit_sekarang || '—'}
              </td>
            </tr>
            <tr className="border-b border-neutral-300">
              <td className="bg-neutral-50 px-2 py-1.5 font-semibold text-neutral-700 align-top">
                Riwayat Penyakit Dahulu (RPD)
              </td>
              <td className="px-2 py-1.5 text-neutral-900">
                {note.subjective?.riwayat_penyakit_dahulu || 'Tidak ada riwayat relevan yang tercatat.'}
              </td>
            </tr>
            <tr className="border-b border-neutral-300">
              <td className="bg-neutral-50 px-2 py-1.5 font-semibold text-neutral-700 align-top">
                Riwayat Alergi (Obat/Makanan)
              </td>
              <td className="px-2 py-1.5 text-neutral-900">
                {note.subjective?.riwayat_alergi &&
                note.subjective.riwayat_alergi !== '—' &&
                note.subjective.riwayat_alergi !== '-' ? (
                  <span className="font-bold text-red-700 underline">
                    {note.subjective.riwayat_alergi}
                  </span>
                ) : (
                  <span className="text-neutral-600">Tidak ada riwayat alergi yang dilaporkan</span>
                )}
              </td>
            </tr>
            <tr className="border-b border-neutral-300">
              <td className="bg-neutral-50 px-2 py-1.5 font-semibold text-neutral-700 align-top">
                Obat / Tindakan Sebelum Datang
              </td>
              <td className="px-2 py-1.5 text-neutral-900">
                {note.subjective?.riwayat_pengobatan || '—'}
              </td>
            </tr>
            {note.subjective_summary && (
              <tr>
                <td className="bg-neutral-50 px-2 py-1.5 font-semibold text-neutral-700 align-top">
                  Rangkuman Subjektif
                </td>
                <td className="px-2 py-1.5 text-neutral-800 italic leading-relaxed">
                  {note.subjective_summary}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ===================== II. OBJEKTIF (PEMERIKSAAN FISIK & TTV) ===================== */}
      <div className="mb-3 print-avoid-break">
        <div className="bg-neutral-200/90 border border-neutral-400 border-b-0 px-2.5 py-1 font-bold text-[10.5px] text-neutral-900 uppercase tracking-wide">
          II. Pemeriksaan Fisik &amp; Tanda Vital (Objektif)
        </div>
        <div className="border border-neutral-400 p-2">
          <div className="font-semibold text-[9.5px] text-neutral-600 mb-1">
            TANDA VITAL (VITAL SIGNS):
          </div>
          <table className="w-full text-[10px] border border-neutral-300 border-collapse mb-2 text-center">
            <thead>
              <tr className="bg-neutral-100 border-b border-neutral-300 text-neutral-700 font-semibold">
                <th className="py-1 px-1 border-r border-neutral-300">Tekanan Darah</th>
                <th className="py-1 px-1 border-r border-neutral-300">Nadi</th>
                <th className="py-1 px-1 border-r border-neutral-300">Laju Napas (RR)</th>
                <th className="py-1 px-1 border-r border-neutral-300">Suhu Tubuh</th>
                <th className="py-1 px-1 border-r border-neutral-300">SpO₂</th>
                <th className="py-1 px-1 border-r border-neutral-300">Berat Badan</th>
                <th className="py-1 px-1">Tinggi Badan</th>
              </tr>
            </thead>
            <tbody>
              <tr className="font-semibold text-neutral-900">
                <td className="py-1 px-1 border-r border-neutral-300">{bpVal}</td>
                <td className="py-1 px-1 border-r border-neutral-300">{hrVal}</td>
                <td className="py-1 px-1 border-r border-neutral-300">{rrVal}</td>
                <td className="py-1 px-1 border-r border-neutral-300">{tempVal}</td>
                <td className="py-1 px-1 border-r border-neutral-300">{spo2Val}</td>
                <td className="py-1 px-1 border-r border-neutral-300">{weightVal}</td>
                <td className="py-1 px-1">{heightVal}</td>
              </tr>
            </tbody>
          </table>

          <div className="font-semibold text-[9.5px] text-neutral-600 mb-0.5">
            STATUS LOKALIS &amp; PEMERIKSAAN FISIK:
          </div>
          <div className="bg-neutral-50/70 border border-neutral-300 p-1.5 text-[10px] text-neutral-900 leading-relaxed whitespace-pre-line">
            {note.exam_text || 'Dalam batas normal / tidak ada kelainan spesifik yang tercatat.'}
          </div>
        </div>
      </div>

      {/* ===================== III. ASESMEN & DIAGNOSIS ===================== */}
      <div className="mb-3 print-avoid-break">
        <div className="bg-neutral-200/90 border border-neutral-400 border-b-0 px-2.5 py-1 font-bold text-[10.5px] text-neutral-900 uppercase tracking-wide">
          III. Diagnosis &amp; Asesmen Klinis (ICD-10)
        </div>
        <table className="w-full text-[10px] border border-neutral-400 border-collapse">
          <thead>
            <tr className="bg-neutral-100 border-b border-neutral-300 text-neutral-700 font-semibold text-left">
              <th className="w-[12%] py-1 px-2 border-r border-neutral-300">Status</th>
              <th className="w-[15%] py-1 px-2 border-r border-neutral-300">Kode ICD-10</th>
              <th className="w-[45%] py-1 px-2 border-r border-neutral-300">Deskripsi Resmi ICD-10</th>
              <th className="w-[28%] py-1 px-2">Diagnosis Klinis / Keterangan</th>
            </tr>
          </thead>
          <tbody>
            {diagnoses.length > 0 ? (
              diagnoses.map((d, idx) => (
                <tr key={d.code} className="border-b border-neutral-200 last:border-0">
                  <td className="py-1 px-2 border-r border-neutral-300 font-semibold text-neutral-700">
                    {d.rank === 1 ? 'Utama' : `Sekunder ${idx}`}
                  </td>
                  <td className="py-1 px-2 border-r border-neutral-300 font-mono font-bold text-neutral-900">
                    {d.code}
                  </td>
                  <td className="py-1 px-2 border-r border-neutral-300 font-medium text-neutral-900">
                    {d.display}
                  </td>
                  <td className="py-1 px-2 text-neutral-700">
                    {ap.dx?.[idx]?.text || d.display}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="py-2 px-2 text-neutral-500 italic">
                  Belum ada diagnosis yang ditetapkan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {note.assessment && (
          <div className="border border-t-0 border-neutral-400 p-1.5 bg-neutral-50 text-[10px] text-neutral-800">
            <span className="font-semibold">Catatan Evaluasi Asesmen: </span>
            {note.assessment}
          </div>
        )}
      </div>

      {/* ===================== IV. PLAN (TATALAKSANA) ===================== */}
      <div className="mb-4 print-avoid-break">
        <div className="bg-neutral-200/90 border border-neutral-400 border-b-0 px-2.5 py-1 font-bold text-[10.5px] text-neutral-900 uppercase tracking-wide">
          IV. Rencana Tatalaksana (Plan)
        </div>
        <table className="w-full text-[10px] border border-neutral-400 border-collapse">
          <tbody>
            <tr className="border-b border-neutral-300">
              <td className="w-[26%] bg-neutral-50 px-2 py-1.5 font-semibold text-neutral-700 align-top">
                Terapi / Edukasi / Obat
              </td>
              <td className="px-2 py-1.5 text-neutral-900 whitespace-pre-line leading-relaxed font-medium">
                {note.plan_text || '—'}
              </td>
            </tr>
            {ap.tindakan && (
              <tr className="border-b border-neutral-300">
                <td className="bg-neutral-50 px-2 py-1.5 font-semibold text-neutral-700 align-top">
                  Permintaan Tindakan / Penunjang
                </td>
                <td className="px-2 py-1.5 text-neutral-900 whitespace-pre-line leading-relaxed">
                  {ap.tindakan}
                </td>
              </tr>
            )}
            {(ap.next_date || ap.next_note) && (
              <tr>
                <td className="bg-neutral-50 px-2 py-1.5 font-semibold text-neutral-700 align-top">
                  Rencana Kontrol Selanjutnya
                </td>
                <td className="px-2 py-1.5 text-neutral-900 font-medium">
                  {ap.next_date ? `Tanggal: ${ap.next_date}` : ''}{' '}
                  {ap.next_note ? `(${ap.next_note})` : ''}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ===================== LEMBAR PENGESAHAN DOKTER DPJP ===================== */}
      <div className="mt-4 pt-2 border-t border-neutral-400 flex justify-between items-end print-avoid-break text-[10px]">
        <div className="w-[56%] space-y-1">
          <div className="flex items-center gap-1.5 text-[9.5px] font-bold text-neutral-900">
            <span className="inline-block size-2 rounded-full bg-emerald-600" />
            TERINTEGRASI SISTEM SATUSEHAT KEMENKES RI
          </div>
          <p className="text-[9px] text-neutral-600 leading-tight">
            ID Encounter: <span className="font-mono text-neutral-900 font-semibold">{resume?.visit.satusehat_encounter_id || '3783c509-0012-4211-9a4f-satusehat-sbx'}</span>
          </p>
          <p className="text-[9px] text-neutral-600 leading-tight">
            Waktu Validasi: <span className="text-neutral-900 font-medium">{snapshot?.approved_at ? formatWib(snapshot.approved_at) : 'Divalidasi Dokter DPJP'}</span>
          </p>
          <p className="text-[8.5px] text-neutral-500 mt-1 italic leading-tight">
            Dokumen ini merupakan salinan sah Resume Medis Rawat Jalan Elektronik (RME) yang diterbitkan secara resmi melalui Sistem ComeHear sesuai Permenkes RI No. 24 Tahun 2022.
          </p>
        </div>

        <div className="w-[38%] text-center">
          <p className="text-neutral-700">
            Jakarta, {snapshot?.approved_at ? dateShort(snapshot.approved_at) : dateShort(new Date().toISOString())}
          </p>
          <p className="font-semibold text-neutral-800 mb-1">
            Dokter Penanggung Jawab Pelayanan (DPJP),
          </p>

          {/* Stempel Validasi Digital */}
          <div className="my-1.5 mx-auto max-w-[190px] border border-neutral-800 bg-neutral-50 p-1.5 rounded text-center">
            <p className="text-[8.5px] font-black tracking-wider text-neutral-900 uppercase">
              TERVALIDASI SECARA ELEKTRONIK
            </p>
            <p className="text-[7.5px] text-neutral-600 font-mono">
              SISTEM RME COMEHEAR · SATUSEHAT
            </p>
            <p className="text-[8px] font-semibold text-neutral-800 mt-0.5">{dpjp}</p>
          </div>

          <p className="font-bold text-neutral-900 border-b border-neutral-800 inline-block px-3 pb-0.5 mt-0.5">
            {dpjp}
          </p>
          <p className="text-[9px] text-neutral-600">SIP: 446/SIP.DOK/2024/001</p>
        </div>
      </div>
    </div>
  )
}
