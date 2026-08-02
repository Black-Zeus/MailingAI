import { Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { CSSProperties, MouseEventHandler } from 'react'

export type ActionButtonVariant = 'default' | 'primary' | 'danger' | 'active'
export type ActionButtonSize = 'sm' | 'md'

interface ActionButtonBaseProps {
  icon: LucideIcon
  /** Texto de la acción -- alimenta el tooltip (hover) y el aria-label a la vez, para que nunca queden desincronizados. */
  label: string
  variant?: ActionButtonVariant
  size?: ActionButtonSize
  loading?: boolean
  disabled?: boolean
  className?: string
  style?: CSSProperties
}

interface ActionButtonAsButton extends ActionButtonBaseProps {
  href?: undefined
  onClick?: MouseEventHandler<HTMLButtonElement>
  type?: 'button' | 'submit'
}

interface ActionButtonAsAnchor extends ActionButtonBaseProps {
  href: string
  target?: string
  rel?: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
}

export type ActionButtonProps = ActionButtonAsButton | ActionButtonAsAnchor

const ICON_SIZE: Record<ActionButtonSize, number> = { sm: 15, md: 18 }

export function ActionButton(props: ActionButtonProps) {
  const { icon: Icon, label, variant = 'default', size = 'md', loading = false, disabled = false, className = '', style } = props
  const classes = ['btn', 'icon-btn', size === 'sm' ? 'icon-btn-sm' : '', variant !== 'default' ? variant : '', className]
    .filter(Boolean)
    .join(' ')
  const iconSize = ICON_SIZE[size]
  const content = loading ? (
    <Loader2 size={iconSize} strokeWidth={2.25} className="icon-spin" />
  ) : (
    <Icon size={iconSize} strokeWidth={2.25} />
  )

  if (props.href !== undefined) {
    return (
      <a
        href={props.href}
        target={props.target}
        rel={props.rel}
        onClick={props.onClick}
        className={classes}
        data-tooltip={label}
        aria-label={label}
        style={style}
      >
        {content}
      </a>
    )
  }

  return (
    <button
      type={props.type ?? 'button'}
      onClick={props.onClick}
      disabled={disabled || loading}
      className={classes}
      data-tooltip={label}
      aria-label={label}
      style={style}
    >
      {content}
    </button>
  )
}
