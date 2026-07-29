import { useState } from 'react'
import type { MailFolderNode } from '../types/messages'

interface FolderTreeProps {
  nodes: MailFolderNode[]
  selected: Set<string>
  onChange: (selected: Set<string>) => void
  readOnly?: boolean
}

function collectIds(node: MailFolderNode): string[] {
  return [node.folder_id, ...node.children.flatMap(collectIds)]
}

function countSelected(node: MailFolderNode, selected: Set<string>): { total: number; selected: number } {
  let total = 1
  let sel = selected.has(node.folder_id) ? 1 : 0
  for (const child of node.children) {
    const c = countSelected(child, selected)
    total += c.total
    sel += c.selected
  }
  return { total, selected: sel }
}

function FolderNode({
  node,
  depth,
  selected,
  onChange,
  readOnly,
}: {
  node: MailFolderNode
  depth: number
  selected: Set<string>
  onChange: (selected: Set<string>) => void
  readOnly?: boolean
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  const hasChildren = node.children.length > 0
  const { total, selected: selCount } = countSelected(node, selected)
  const checked = selCount === total
  const indeterminate = selCount > 0 && selCount < total

  function toggle() {
    const ids = collectIds(node)
    const next = new Set(selected)
    if (checked) {
      ids.forEach((id) => next.delete(id))
    } else {
      ids.forEach((id) => next.add(id))
    }
    onChange(next)
  }

  return (
    <div className="folder-tree-node">
      <div className={`folder-tree-row${checked ? ' is-checked' : ''}${indeterminate ? ' is-indeterminate' : ''}`}>
        {hasChildren ? (
          <button
            type="button"
            className={`folder-tree-toggle${expanded ? ' is-expanded' : ''}`}
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? 'Contraer' : 'Expandir'}
          >
            ▸
          </button>
        ) : (
          <span className="folder-tree-toggle-spacer" />
        )}
        <label>
          {!readOnly && (
            <input
              type="checkbox"
              checked={checked}
              ref={(el) => {
                if (el) el.indeterminate = indeterminate
              }}
              onChange={toggle}
            />
          )}
          <span className="folder-tree-icon">{hasChildren && expanded ? '📂' : '📁'}</span>
          <span className="folder-tree-name">{node.display_name}</span>
          <span className={`folder-tree-count${node.total_item_count === 0 ? ' is-empty' : ''}`}>
            {node.total_item_count === 0 ? 'vacía' : node.total_item_count}
          </span>
        </label>
      </div>
      {hasChildren && expanded && (
        <div className="folder-tree-children">
          {node.children.map((child) => (
            <FolderNode
              key={child.folder_id}
              node={child}
              depth={depth + 1}
              selected={selected}
              onChange={onChange}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function FolderTree({ nodes, selected, onChange, readOnly }: FolderTreeProps) {
  if (nodes.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: 12 }}>No hay carpetas descubiertas todavía — corre un trabajo "Descubrir carpetas" primero.</p>
  }
  return (
    <div className="folder-tree">
      {nodes.map((node) => (
        <FolderNode key={node.folder_id} node={node} depth={0} selected={selected} onChange={onChange} readOnly={readOnly} />
      ))}
    </div>
  )
}
