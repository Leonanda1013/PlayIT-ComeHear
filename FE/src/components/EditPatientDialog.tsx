import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, UserCog } from 'lucide-react'
import { btn, Dialog, inputClass, Label, Notice, SelectInput, TextArea } from '@/components/ui/kit'
import { todayIso } from '@/lib/format'
import { updatePatient, type UpdatePatientData } from '@/lib/rm'
import type { Patient } from '@/lib/types'

export function EditPatientDialog({
  patient,
  open,
  onClose,
  onSuccess,
}: {
  patient: Patient | null
  open: boolean
  onClose: () => void
  onSuccess?: (updated: Patient) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<UpdatePatientData>({
    name: '',
    nik: '',
    birth_date: '',
    gender: 'male',
    phone: '',
    address: '',
  })
  const [errors, setErrors] = useState<Partial<Record<keyof UpdatePatientData, string>>>({})
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (patient) {
      setForm({
        name: patient.name || '',
        nik: patient.nik || '',
        birth_date: patient.birth_date ? patient.birth_date.slice(0, 10) : '',
        gender: patient.gender === 'female' ? 'female' : 'male',
        phone: patient.phone || '',
        address: patient.address || '',
      })
      setErrors({})
      setNotice(null)
    }
  }, [patient])

  const editMutation = useMutation({
    mutationFn: (data: UpdatePatientData) => {
      if (!patient) throw new Error('Pasien tidak valid.')
      return updatePatient(patient.id, data)
    },
    onSuccess: async (res) => {
      setNotice(res.message)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['registry'] }),
        queryClient.invalidateQueries({ queryKey: ['rm-visits'] }),
        queryClient.invalidateQueries({ queryKey: ['history'] }),
        queryClient.invalidateQueries({ queryKey: ['consultation'] }),
      ])
      if (onSuccess) onSuccess(res.patient)
      setTimeout(() => {
        onClose()
      }, 800)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!patient) return

    const errs: Partial<Record<keyof UpdatePatientData, string>> = {}
    if (!form.name.trim()) errs.name = 'Nama lengkap wajib diisi.'
    if (form.nik && !/^\d{16}$/.test(form.nik.trim())) {
      errs.nik = 'NIK harus berupa 16 digit angka.'
    }
    if (!form.birth_date) errs.birth_date = 'Tanggal lahir wajib dipilih.'
    if (!form.gender) errs.gender = 'Pilih jenis kelamin.'
    if (!form.address?.trim()) errs.address = 'Alamat lengkap wajib diisi.'

    setErrors(errs)
    if (Object.keys(errs).length === 0) {
      editMutation.mutate(form)
    }
  }

  if (!patient) return null

  return (
    <Dialog open={open} onClose={onClose} title="Edit Data Pasien" width={560}>
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div className="flex items-center justify-between rounded-[10px] bg-[#eef7f9] px-3.5 py-2.5 text-[12px] text-ch-ink">
          <div className="flex items-center gap-2">
            <UserCog className="size-4 text-ch-brand" />
            <span>
              Nomor RM: <b className="font-mono text-ch-teal">RM-{patient.rm_number}</b>
            </span>
          </div>
          {patient.ihs_number ? (
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
              IHS: {patient.ihs_number}
            </span>
          ) : (
            <span className="text-[11px] text-ch-muted">IHS Belum Tercatat</span>
          )}
        </div>

        {notice && (
          <Notice tone="ok">
            <span className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="size-4" /> {notice}
            </span>
          </Notice>
        )}

        {editMutation.isError && (
          <Notice tone="bad">
            <span className="flex items-center gap-1.5 font-medium">
              <AlertCircle className="size-4" /> {editMutation.error.message}
            </span>
          </Notice>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="edit-name" required>
              Nama Lengkap
            </Label>
            <input
              id="edit-name"
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Masukkan nama lengkap"
            />
            {errors.name && <p className="mt-1 text-[11px] text-ch-bad">{errors.name}</p>}
          </div>

          <div>
            <Label htmlFor="edit-nik">NIK (16 Digit)</Label>
            <input
              id="edit-nik"
              inputMode="numeric"
              maxLength={16}
              className={inputClass}
              value={form.nik}
              onChange={(e) => setForm({ ...form, nik: e.target.value.replace(/\D/g, '') })}
              placeholder="16 digit angka NIK"
            />
            {errors.nik ? (
              <p className="mt-1 text-[11px] text-ch-bad">{errors.nik}</p>
            ) : (
              <p className="mt-1 text-[10px] text-ch-faint">{form.nik?.length || 0}/16 digit</p>
            )}
          </div>

          <div>
            <Label htmlFor="edit-birth" required>
              Tanggal Lahir
            </Label>
            <input
              id="edit-birth"
              type="date"
              max={todayIso()}
              className={inputClass}
              value={form.birth_date}
              onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
            />
            {errors.birth_date && (
              <p className="mt-1 text-[11px] text-ch-bad">{errors.birth_date}</p>
            )}
          </div>

          <div>
            <Label htmlFor="edit-gender" required>
              Jenis Kelamin
            </Label>
            <SelectInput
              id="edit-gender"
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value })}
            >
              <option value="male">Laki-laki</option>
              <option value="female">Perempuan</option>
            </SelectInput>
            {errors.gender && <p className="mt-1 text-[11px] text-ch-bad">{errors.gender}</p>}
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="edit-phone">Nomor Telepon / WhatsApp</Label>
            <input
              id="edit-phone"
              inputMode="tel"
              className={inputClass}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^\d+]/g, '') })}
              placeholder="08xxxxxxxxxx"
            />
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="edit-address" required>
              Alamat Lengkap
            </Label>
            <TextArea
              id="edit-address"
              rows={2}
              className="text-sm"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Masukkan alamat domisili pasien"
            />
            {errors.address && <p className="mt-1 text-[11px] text-ch-bad">{errors.address}</p>}
          </div>
        </div>

        <p className="text-[11px] text-ch-muted">
          Perubahan NIK atau identitas demografi akan disinkronkan ke integrasi SATUSEHAT.
        </p>

        <div className="mt-5 flex justify-end gap-3 pt-2">
          <button
            type="button"
            className={btn.outline}
            onClick={onClose}
            disabled={editMutation.isPending}
          >
            Batal
          </button>
          <button
            type="submit"
            className={btn.primary}
            disabled={editMutation.isPending}
          >
            {editMutation.isPending ? 'Menyimpan…' : 'Simpan Perubahan'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
