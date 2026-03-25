'use client'

import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

export function ScoreToggleField({ label, total, value, nullLabel, disabled, step, onChange }: {
  label: string
  total: number
  value: number | null
  nullLabel: string
  disabled: boolean
  step?: number
  onChange: (v: number | null) => void
}) {
  const active = value !== null
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Switch
        checked={active}
        disabled={disabled}
        onCheckedChange={(checked) => onChange(checked ? 0 : null)}
      />
      <span className="text-xs text-gray-400 shrink-0">{label}</span>
      {active ? (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={0}
            max={total}
            step={step ?? 1}
            value={value ?? 0}
            onChange={(e) => onChange(Number(e.target.value))}
            disabled={disabled}
            className="h-8 w-16 text-center text-sm"
          />
          <span className="text-xs text-gray-300">/{total}</span>
        </div>
      ) : (
        <span className="text-xs text-gray-300">{nullLabel}</span>
      )}
    </div>
  )
}
