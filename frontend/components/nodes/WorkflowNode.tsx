'use client'

import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { NODE_DEFINITIONS } from './definitions'
import type { NodePort } from './types'

export type WorkflowNodeData = {
  label: string
  typeId: string
  color: string
  icon: string
  description: string
  category: string
  config?: Record<string, string>
  onConfigChange?: (nodeId: string, key: string, value: string) => void
  onLabelChange?: (nodeId: string, label: string) => void
}

function WorkflowNode({ data, selected, id }: NodeProps) {
  const d = data as unknown as WorkflowNodeData
  const { label, color, icon, description, category, config = {}, onConfigChange, onLabelChange, typeId } = d

  const handleConfig = useCallback(
    (key: string, value: string) => {
      onConfigChange?.(id, key, value)
    },
    [id, onConfigChange]
  )

  const handleLabel = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onLabelChange?.(id, e.target.value)
    },
    [id, onLabelChange]
  )

  const categoryColorMap: Record<string, string> = {
    input: 'border-l-blue-500',
    processing: 'border-l-amber-500',
    output: 'border-l-emerald-500',
  }

  const categoryBadge: Record<string, string> = {
    input: 'bg-blue-500/15 text-blue-400',
    processing: 'bg-amber-500/15 text-amber-400',
    output: 'bg-emerald-500/15 text-emerald-400',
  }

  // Look up the node definition to get the actual port definitions
  const nodeDef = NODE_DEFINITIONS[typeId]
  const ports: NodePort[] = nodeDef?.ports || []

  const inputPorts = ports.filter((p) => p.type === 'input')
  const outputPorts = ports.filter((p) => p.type === 'output')

  return (
    <div
      className={cn(
        'min-w-[220px] rounded-xl border bg-card shadow-lg transition-shadow',
        'border-l-4',
        categoryColorMap[category] || 'border-l-border',
        selected && 'ring-2 ring-ring shadow-xl'
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
        <span className="text-lg">{icon}</span>
        <input
          value={label}
          onChange={handleLabel}
          className="flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Node name"
          spellCheck={false}
        />
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
            categoryBadge[category]
          )}
        >
          {category}
        </span>
      </div>

      {/* Config fields */}
      <div className="space-y-2 px-3 py-2.5">
        {Object.entries(config).length > 0 ? (
          Object.entries(config).map(([key, value]) => (
            <div key={key} className="space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {key.replace(/_/g, ' ')}
              </label>
              <input
                value={value}
                onChange={(e) => handleConfig(key, e.target.value)}
                className="w-full rounded-md border border-border/60 bg-background/50 px-2 py-1 text-xs text-foreground outline-none transition-colors focus:border-ring"
                placeholder={`Enter ${key.replace(/_/g, ' ')}`}
                spellCheck={false}
              />
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>

      {/* Input handles — one per input port definition */}
      {inputPorts.map((port, index) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          style={{ top: `${((index + 1) / (inputPorts.length + 1)) * 100}%` }}
          className="!size-3 !border-2 !border-background !bg-blue-500"
          title={port.label}
        />
      ))}

      {/* Output handles — one per output port definition */}
      {outputPorts.map((port, index) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Right}
          id={port.id}
          style={{ top: `${((index + 1) / (outputPorts.length + 1)) * 100}%` }}
          className="!size-3 !border-2 !border-background !bg-emerald-500"
          title={port.label}
        />
      ))}
    </div>
  )
}

export default memo(WorkflowNode)