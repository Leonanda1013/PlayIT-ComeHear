import type { ReactNode } from 'react'

const tones = {
  muted: 'border-[#cfdbe3] bg-[#edf2f6] text-[#52677b]',
  info: 'border-[#8edbe6] bg-[#dff6f9] text-ch-teal',
  ok: 'border-[#9fdcc0] bg-ch-ok-soft text-ch-ok',
  warn: 'border-[#f0d08a] bg-ch-warn-soft text-ch-warn',
} as const

export function Badge({ tone = 'muted', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11px] font-semibold leading-4 ${tones[tone]}`}>{children}</span>
}
