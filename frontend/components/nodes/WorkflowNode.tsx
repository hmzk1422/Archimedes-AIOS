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

  // Look up the node definition to get the actual port definitions
  const nodeDef = NODE_DEFINITIONS[typeId]
  const ports: NodePort[] = nodeDef?.ports || []
  const fields = nodeDef?.fields || []

  const inputPorts = ports.filter((p) => p.type === 'input')
  const outputPorts = ports.filter((p) => p.type === 'output')

  return (
    <div
      className={cn(
        'min-w-[240px] rounded-lg border-2 bg-card shadow-md transition-all duration-200',
        'hover:shadow-lg',
        selected ? 'ring-2 ring-primary shadow-xl scale-[1.02]' : 'shadow-sm'
      )}
      style={{ borderColor: selected ? color : 'var(--border)' }}
    >
      {/* Header with colored accent */}
      <div
        className="flex items-center gap-2.5 rounded-t-md px-3 py-2.5"
        style={{ backgroundColor: `${color}20` }}
      >
        <div
          className="flex size-8 items-center justify-center rounded-md text-white shadow-sm"
          style={{ backgroundColor: color }}
        >
          <span className="text-base">{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <input
            value={label}
            onChange={handleLabel}
            className="w-full bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Node name"
            spellCheck={false}
          />
          <p className="text-[10px] text-muted-foreground truncate">{description}</p>
        </div>
      </div>

      {/* Config fields */}
      {Object.keys(config).length > 0 && (
        <div className="space-y-2 border-t border-border/50 px-3 py-2.5 bg-background/50">
          {Object.entries(config).map(([key, value]) => {
            const fieldDef = fields.find((f) => f.key === key)
            const fieldType = fieldDef?.type || 'text'
            const fieldLabel = fieldDef?.label || key.replace(/_/g, ' ')
            const fieldPlaceholder = fieldDef?.placeholder || `Enter ${key.replace(/_/g, ' ')}`

            // Select field
            if (fieldType === 'select' && fieldDef?.options) {
              return (
                <div key={key} className="space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {fieldLabel}
                  </label>
                  <select
                    value={value}
                    onChange={(e) => handleConfig(key, e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20"
                  >
                    {fieldDef.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )
            }

            // Textarea / JSON field
            if (fieldType === 'textarea' || fieldType === 'json') {
              return (
                <div key={key} className="space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {fieldLabel}
                  </label>
                  <textarea
                    value={value}
                    onChange={(e) => handleConfig(key, e.target.value)}
                    className="w-full min-h-[60px] rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono text-foreground outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 resize-y"
                    placeholder={fieldPlaceholder}
                    spellCheck={false}
                  />
                </div>
              )
            }

            // Password field
            if (fieldType === 'password') {
              return (
                <div key={key} className="space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {fieldLabel}
                  </label>
                  <input
                    type="password"
                    value={value}
                    onChange={(e) => handleConfig(key, e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20"
                    placeholder={fieldPlaceholder}
                    spellCheck={false}
                  />
                </div>
              )
            }

            // Default text/number/email input
            return (
              <div key={key} className="space-y-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {fieldLabel}
                </label>
                <input
                  type={fieldType === 'number' ? 'number' : fieldType === 'email' ? 'email' : 'text'}
                  value={value}
                  onChange={(e) => handleConfig(key, e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20"
                  placeholder={fieldPlaceholder}
                  spellCheck={false}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Input handles — one per input port definition */}
      {inputPorts.map((port, index) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          style={{
            top: `${((index + 1) / (inputPorts.length + 1)) * 100}%`,
            width: '10px',
            height: '10px',
            backgroundColor: '#3b82f6',
            border: '2px solid var(--background)',
            boxShadow: '0 0 0 1px #3b82f6',
          }}
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
          style={{
            top: `${((index + 1) / (outputPorts.length + 1)) * 100}%`,
            width: '10px',
            height: '10px',
            backgroundColor: '#10b981',
            border: '2px solid var(--background)',
            boxShadow: '0 0 0 1px #10b981',
          }}
          title={port.label}
        />
      ))}
    </div>
  )
}

export default memo(WorkflowNode)