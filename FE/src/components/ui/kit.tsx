import { Children, isValidElement, useEffect, useRef, useState } from 'react'
import { AlertCircle, Check as CheckIcon, CheckCircle2, ChevronDown, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/* Komponen dasar ComeHear: mengikuti DESIGN.md (panel terang, border tipis, teal untuk aksi utama). */

export const inputClass = 'h-10 w-full rounded-[10px] border border-[#d2e1e7] bg-white px-3 text-sm text-ch-ink outline-none transition placeholder:text-[#a3b1bf] focus:border-ch-brand focus:ring-2 focus:ring-ch-brand/15 disabled:bg-[#f2f6f8] disabled:text-ch-muted'

export function Panel({ className, children, highlight }: { className?: string; children: React.ReactNode; highlight?: boolean }) {
  return <section className={cn('rounded-[16px] border bg-ch-panel p-5', highlight ? 'border-ch-brand shadow-[0_0_0_1px_#14a3b8]' : 'border-[#d3e2e8]', className)}>{children}</section>
}

export function PanelTitle({ children, action, sub }: { children: React.ReactNode; action?: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-[20px] font-bold leading-7 text-ch-ink">{children}</h2>{sub && <p className="mt-0.5 text-xs text-ch-muted">{sub}</p>}</div>{action}</div>
}

const tones = {
  ok: 'border-[#9fdcc0] bg-ch-ok-soft text-ch-ok',
  bad: 'border-[#f3b6b6] bg-ch-bad-soft text-ch-bad',
  info: 'border-[#8edbe6] bg-[#dff6f9] text-ch-teal',
  blue: 'border-[#7fb6ff] bg-[#e8f3ff] text-[#0a66d1]',
  muted: 'border-[#cfdbe3] bg-[#edf2f6] text-[#52677b]',
  warn: 'border-[#f0d08a] bg-ch-warn-soft text-ch-warn',
} as const

export type Tone = keyof typeof tones

export function Badge({ tone = 'muted', children, className, icon }: { tone?: Tone; children: React.ReactNode; className?: string; icon?: React.ReactNode }) {
  return <span className={cn('inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11px] font-semibold leading-4', tones[tone], className)}>{icon}{children}</span>
}

export function FieldBox({ label, children, className, htmlFor }: { label: React.ReactNode; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return <div className={cn('rounded-[12px] border border-[#d6e3e9] bg-ch-field p-3', className)}><label htmlFor={htmlFor} className="mb-2 block text-xs font-semibold text-[#3f5468]">{label}</label>{children}</div>
}

export function Label({ children, required, htmlFor }: { children: React.ReactNode; required?: boolean; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold text-[#3f5468]">{children}{required && <span className="text-ch-bad"> *</span>}</label>
}

export function UnitInput({ unit, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { unit?: string }) {
  return <span className="relative block"><input {...props} className={cn(inputClass, 'font-inter', unit && 'pr-16', className)} />{unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] text-[#8799ad]">{unit}</span>}</span>
}

export type SelectOption = {
  value: string | number
  label: React.ReactNode
  subtext?: React.ReactNode
  disabled?: boolean
}

export interface SelectInputProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  children?: React.ReactNode
  options?: readonly (readonly [string | number, React.ReactNode])[] | SelectOption[]
  icon?: React.ComponentType<{ className?: string }>
  menuTitle?: string
  placeholder?: string
}

function extractOptions(nodes: React.ReactNode): SelectOption[] {
  const result: SelectOption[] = []
  Children.forEach(nodes, (child) => {
    if (!isValidElement(child)) return
    if (child.type === 'option') {
      const { value, children: optLabel, disabled, 'data-subtext': subtext } = child.props as any
      result.push({
        value: value !== undefined ? value : (typeof optLabel === 'string' ? optLabel : ''),
        label: optLabel ?? value,
        subtext,
        disabled,
      })
    } else if (child.props && (child.props as any).children) {
      result.push(...extractOptions((child.props as any).children))
    }
  })
  return result
}

export function SelectInput({
  className,
  children,
  options,
  icon: Icon,
  menuTitle,
  placeholder,
  value,
  defaultValue,
  onChange,
  disabled,
  id,
  name,
  'aria-label': ariaLabel,
}: SelectInputProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const parsedOptions: SelectOption[] = []
  if (options && options.length > 0) {
    for (const item of options) {
      if (Array.isArray(item)) {
        parsedOptions.push({ value: item[0], label: item[1] })
      } else if (item && typeof item === 'object') {
        parsedOptions.push(item as SelectOption)
      }
    }
  } else if (children) {
    parsedOptions.push(...extractOptions(children))
  }

  const currentValue = value !== undefined ? String(value) : defaultValue !== undefined ? String(defaultValue) : ''
  const selectedOption = parsedOptions.find((o) => String(o.value) === currentValue)
  const displayLabel = selectedOption ? selectedOption.label : (placeholder || parsedOptions[0]?.label || 'Pilih...')

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [open])

  const handleSelect = (val: string | number) => {
    setOpen(false)
    if (onChange) {
      const fakeEvent = {
        target: { name: name || '', id: id || '', value: String(val) },
        currentTarget: { name: name || '', id: id || '', value: String(val) },
      } as unknown as React.ChangeEvent<HTMLSelectElement>
      onChange(fakeEvent)
    }
  }

  const titleText = menuTitle || (typeof ariaLabel === 'string' ? ariaLabel : undefined)

  return (
    <div ref={containerRef} className={cn('relative inline-block w-full', className)}>
      <button
        type="button"
        id={id}
        name={name}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-[10px] border border-[#d2e1e7] bg-white px-3 text-[13px] font-medium text-ch-ink shadow-sm transition hover:border-ch-brand focus:border-ch-brand focus:outline-none focus:ring-2 focus:ring-ch-brand/15 disabled:cursor-not-allowed disabled:bg-[#f2f6f8] disabled:text-ch-muted',
          open && 'border-ch-brand ring-2 ring-ch-brand/15'
        )}
      >
        <div className="flex min-w-0 items-center gap-2 truncate">
          {Icon && <Icon className="size-4 shrink-0 text-ch-brand" />}
          <span className="truncate">{displayLabel}</span>
        </div>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-[#6b7f93] transition-transform duration-150',
            open && 'rotate-180 text-ch-brand'
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+5px)] z-50 min-w-full w-max max-w-[340px] rounded-[12px] border border-[#d3e2e8] bg-white p-1.5 shadow-lg max-h-60 overflow-y-auto"
        >
          {titleText && (
            <p className="px-2.5 py-1.5 text-[11px] font-semibold text-ch-muted">{titleText}</p>
          )}
          <div className="space-y-0.5">
            {parsedOptions.map((opt, i) => {
              const isSelected = String(opt.value) === currentValue
              return (
                <button
                  key={`${opt.value}-${i}`}
                  type="button"
                  role="menuitem"
                  disabled={opt.disabled}
                  onClick={() => handleSelect(opt.value)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] transition hover:bg-[#eef6f8]',
                    isSelected ? 'bg-[#e6f6f8] font-semibold text-ch-ink' : 'text-[#33475b]',
                    opt.disabled && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{opt.label}</span>
                    {opt.subtext && (
                      <span className="truncate text-[11px] text-ch-muted">{opt.subtext}</span>
                    )}
                  </div>
                  {isSelected && <CheckIcon className="ml-2 size-3.5 shrink-0 text-ch-teal" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function TextArea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('w-full rounded-[10px] border border-[#d2e1e7] bg-white p-3 text-sm text-ch-ink outline-none placeholder:text-[#a3b1bf] focus:border-ch-brand focus:ring-2 focus:ring-ch-brand/15', className)} />
}

export function Radio({ label, checked, onChange, name, disabled }: { label: React.ReactNode; checked: boolean; onChange: () => void; name: string; disabled?: boolean }) {
  return <label className={cn('inline-flex cursor-pointer items-center gap-2 text-xs text-[#33475b]', disabled && 'cursor-not-allowed opacity-60')}><input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} className="peer sr-only" /><span className="grid size-4 place-items-center rounded-full border border-[#9aabba] bg-white peer-checked:border-ch-brand peer-focus-visible:ring-2 peer-focus-visible:ring-ch-brand/30">{checked && <span className="size-2 rounded-full bg-ch-brand" />}</span>{label}</label>
}

export function Check({ label, checked, onChange, disabled }: { label: React.ReactNode; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[#33475b]"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded accent-ch-brand" />{label}</label>
}

export function SectionLabel({ number, children }: { number?: string; children: React.ReactNode }) {
  return <h3 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wide text-[#4d6275]">{number && <span className="mr-2">{number}</span>}{children}</h3>
}

export function FieldCaps({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#73879a]">{children}</p>
}

export const btn = {
  primary: 'inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-ch-brand px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-ch-brand-hover disabled:cursor-not-allowed disabled:opacity-50',
  outline: 'inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[#d2e1e7] bg-white px-4 text-sm font-semibold text-[#24384c] transition hover:border-ch-brand hover:text-ch-teal disabled:cursor-not-allowed disabled:opacity-50',
  soft: 'inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-[#d2e1e7] bg-[#eef4f7] px-4 text-sm font-semibold text-[#3d5266] transition hover:bg-[#e3eef2] disabled:cursor-not-allowed disabled:opacity-50',
  ghostTeal: 'inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-[#8edbe6] bg-[#e2f6f9] px-3 text-xs font-semibold text-[#0b8597] transition hover:bg-[#d3f0f4]',
  danger: 'inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-[#bf2e36] px-4 text-sm font-semibold text-white hover:bg-[#a5242c] disabled:opacity-50',
}

export function Notice({ tone = 'ok', children, className }: { tone?: 'ok' | 'bad' | 'info'; children: React.ReactNode; className?: string }) {
  const config = tone === 'ok'
    ? {
        border: 'border-[#b1dfbb]',
        bg: 'bg-[#f0faf4]',
        text: 'text-[#145a32]',
        icon: <CheckCircle2 className="size-4 shrink-0 text-[#198754]" />,
      }
    : tone === 'bad'
    ? {
        border: 'border-[#f5c2c7]',
        bg: 'bg-[#fdf2f2]',
        text: 'text-[#9f1c24]',
        icon: <AlertCircle className="size-4 shrink-0 text-[#dc3545]" />,
      }
    : {
        border: 'border-[#a3dfea]',
        bg: 'bg-[#edf9fb]',
        text: 'text-[#0b6e7d]',
        icon: <Info className="size-4 shrink-0 text-ch-brand" />,
      }

  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cn(
        'flex items-center gap-2.5 rounded-[12px] border px-4 py-3 text-[13px] font-medium shadow-xs leading-relaxed',
        config.border,
        config.bg,
        config.text,
        className
      )}
    >
      {config.icon}
      <div className="flex-1">{children}</div>
    </div>
  )
}

export function Dialog({ open, onClose, title, children, width = 500 }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); previous?.focus() }
  }, [open, onClose])
  if (!open) return null
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#081d2d]/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }} className="max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-[16px] border border-[#d3e2e8] bg-white p-6 shadow-[0_20px_50px_rgba(8,29,45,0.18)]">
      <div className="flex items-start justify-between gap-4"><h2 className="text-[20px] font-bold text-ch-ink">{title}</h2><button type="button" aria-label="Tutup" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-ch-muted hover:bg-[#eef4f7]"><X className="size-4" /></button></div>
      <div className="mt-3">{children}</div>
    </div>
  </div>
}
