import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type LabeledButtonVariant = 'default' | 'primary' | 'danger'
export type LabeledButtonSize = 'sm' | 'md'

interface LabeledButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: LabeledButtonVariant
  size?: LabeledButtonSize
  loading?: boolean
  /** Texto a mostrar en lugar de `children` mientras `loading` es true (ej. "Guardando…"). */
  loadingText?: ReactNode
  className?: string
  children: ReactNode
}

export function LabeledButton({
  variant = 'default',
  size = 'md',
  loading = false,
  loadingText,
  disabled = false,
  className = '',
  type = 'button',
  children,
  ...rest
}: LabeledButtonProps) {
  const classes = ['btn', 'btn-labeled', size === 'sm' ? 'small' : '', variant !== 'default' ? variant : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={classes} disabled={disabled || loading} {...rest}>
      {loading && loadingText !== undefined ? loadingText : children}
    </button>
  )
}
