export type ClinicConfig = {
  name: string
  serviceType: string
  address: string
  phone: string
  email: string
  licenseNumber: string
  faskesCode: string
}

/**
 * Konfigurasi identitas fasilitas kesehatan (faskes/klinik).
 * Nilai default mengacu pada DESIGN.md (Klinik Bunga Melati) dan dapat
 * di-override secara dinamis melalui environment variable (VITE_CLINIC_*).
 */
export const DEFAULT_CLINIC_CONFIG: ClinicConfig = {
  name: import.meta.env.VITE_CLINIC_NAME || 'KLINIK BUNGA MELATI',
  serviceType: import.meta.env.VITE_CLINIC_SERVICE_TYPE || 'PELAYANAN KESEHATAN RAWAT JALAN & REKAM MEDIS ELEKTRONIK',
  address: import.meta.env.VITE_CLINIC_ADDRESS || 'Jl. Melati Raya No. 12, Kebayoran Baru, Jakarta Selatan 12160',
  phone: import.meta.env.VITE_CLINIC_PHONE || '(021) 720-1845',
  email: import.meta.env.VITE_CLINIC_EMAIL || 'info@klinikbungamelati.id',
  licenseNumber: import.meta.env.VITE_CLINIC_LICENSE || '445/018/K-PRATAMA/DPMPTSP/2023',
  faskesCode: import.meta.env.VITE_CLINIC_FASKES_CODE || '317101234',
}
