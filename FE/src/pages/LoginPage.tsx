import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'

export function LoginPage({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSubmitting(true)
    try { await onLogin(email, password) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Masuk gagal. Coba lagi.') }
    finally { setSubmitting(false) }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#eaf4f7] bg-[url('/login-background.png')] bg-cover bg-center px-5 py-10">
      <section className="w-full max-w-[420px] rounded-[24px] border border-[#d5e3e8] bg-white px-8 py-10 shadow-[0_18px_45px_rgba(17,62,77,0.13)] sm:px-9">
        <div className="flex justify-center"><img src="/comehear-logo.png" alt="ComeHear AI Medical Scribe" className="h-[58px] w-[270px] object-contain" /></div>
        <div className="mt-4 border-t border-[#d6dee3] pt-5">
          <h1 className="text-[27px] font-bold tracking-[-0.03em] text-[#102a43]">Masuk ke akun Anda</h1>
          <p className="mt-1.5 text-sm leading-5 text-[#6a7e96]">Akses konsultasi, SOAP, dan rekam medis pasien<br className="hidden sm:block" /> dengan aman.</p>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {params.has('expired') && <p role="alert" className="rounded-lg border border-[#f2b8b8] bg-[#fff0f0] p-2.5 text-xs text-[#a32222]">Sesi berakhir. Silakan masuk kembali.</p>}
          {error && <p role="alert" className="rounded-lg border border-[#f2b8b8] bg-[#fff0f0] p-2.5 text-xs text-[#a32222]">{error}</p>}
          <label className="block text-xs font-semibold text-[#3f5368]" htmlFor="email">Email
            <span className="relative mt-2 block"><Mail className="absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-[#0ba9bd]" /><input id="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} className="h-[52px] w-full rounded-xl border border-[#d5e1e8] bg-[#fbfdfe] pl-10 pr-3 text-sm font-normal text-[#102a43] outline-none placeholder:text-[#99abc0] focus:border-[#13a8bb] focus:ring-2 focus:ring-[#13a8bb]/15" placeholder="email@gmail.com" /></span>
          </label>
          <label className="block text-xs font-semibold text-[#3f5368]" htmlFor="password">Kata Sandi
            <span className="relative mt-2 block"><LockKeyhole className="absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-[#0ba9bd]" /><input id="password" autoComplete="current-password" required type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} className="h-[52px] w-full rounded-xl border border-[#d5e1e8] bg-[#fbfdfe] pl-10 pr-11 text-sm font-normal text-[#102a43] outline-none placeholder:text-[#99abc0] focus:border-[#13a8bb] focus:ring-2 focus:ring-[#13a8bb]/15" placeholder="••••••••••" /><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[#92a5b9]" aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}>{showPassword ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}</button></span>
          </label>
          <div className="flex justify-end"><button type="button" onClick={() => setShowHelp(!showHelp)} className="text-xs font-semibold text-[#0099ad] hover:underline">Lupa kata sandi?</button></div>
          {showHelp && <p className="text-xs text-[#60758a]">Hubungi admin fasilitas untuk mengatur ulang akses akun. Akun dokter diarahkan ke antrean pasien, akun petugas rekam medis ke dashboard.</p>}
          <Button type="submit" disabled={submitting} className="mt-1 h-[52px] w-full rounded-xl bg-[#17a5b7] text-sm font-bold text-white shadow-[0_8px_18px_rgba(23,165,183,0.24)] hover:bg-[#0e91a3]">{submitting ? 'Sedang masuk…' : 'Masuk'}</Button>
        </form>
      </section>
    </main>
  )
}
