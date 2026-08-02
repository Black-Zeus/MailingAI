import type { CSSProperties } from 'react'
import { formatNumber } from '../utils/format'

interface KpiCardProps {
  label: string
  value: number
  color?: CSSProperties['color']
}

export function KpiCard({ label, value, color }: KpiCardProps) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <strong style={color ? { color } : undefined}>{formatNumber(value)}</strong>
    </div>
  )
}
