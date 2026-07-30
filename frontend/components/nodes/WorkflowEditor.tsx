'use client'

import { useCallback, useRef, useState, useEffect, DragEvent } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Save, Loader2, Trash2, AlertCircle, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import WorkflowNode from './WorkflowNode'
import { NODE_DEFINITIONS, CATEGORY_LABELS } from './definitions'
import type { NodeTypeId, FlowConfig, NodeConfig } from './types'

const nodeTypes = {
  workflow: WorkflowNode,
}

interface WorkflowEditorProps {
  initialConfig?: FlowConfig
  onSave: (config: FlowConfig) => Promise<void>
  loading?: boolean
  status?: { kind: 'idle' | 'success' | 'error' | 'info'; message: string } | null
}

function generateId(): string {
  return `node_${Math.random().toString(36).substring(2, 9)}`
}

/** Map legacy handle IDs ("in"/"out") to the correct port ID from the node definition */
function resolveHandleId(typeId: NodeTypeId, handleId: string, portType: 'input' | 'output'): string {
  // If it's already a specific port ID (not "in" or "out"), return as-is
  if (handleId !== 'in' && handleId !== 'out') return handleId

  const def = NODE_DEFINITIONS[typeId]
  if (!def) return handleId

  // Find the first port of the matching type
  const port = def.ports.find((p) => p.type === portType)
  return port?.id || handleId
}

function nodeConfigToReactFlowNode(id: string, nc: NodeConfig, onConfigChange?: (nodeId: string, key: string, value: string) => void, onLabelChange?: (nodeId: string, label: string) => void): Node {
  const def = NODE_DEFINITIONS[nc.typeId]
  return {
    id,
    type: 'workflow',
    position: nc.position,
    data: {
      label: nc.label,
      typeId: nc.typeId,
      color: def?.color || '#666',
      icon: def?.icon || '📦',
      description: def?.description || '',
      category: def?.category || 'processing',
      config: nc.config,
      onConfigChange,
      onLabelChange,
    },
  }
}

const defaultEdgeOptions = {
  style: { stroke: 'oklch(1 0 0 / 30%)', strokeWidth: 2 },
  animated: true,
}

export default function WorkflowEditor({ initialConfig, onSave, loading, status }: WorkflowEditorProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const [masterEnabled, setMasterEnabled] = useState(initialConfig?.masterEnabled ?? true)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])

  // React Flow change handlers
  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  )
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  )

  // Callbacks for node config/label changes
  const handleConfigChange = useCallback(
    (nodeId: string, key: string, value: string) => {
      setNodes((nds: Node[]) =>
        nds.map((n: Node) => {
          if (n.id !== nodeId) return n
          const d = n.data as Record<string, unknown>
          const currentConfig = (d.config as Record<string, string>) || {}
          return {
            ...n,
            data: {
              ...d,
              config: { ...currentConfig, [key]: value },
            },
          }
        })
      )
    },
    [setNodes]
  )

  const handleLabelChange = useCallback(
    (nodeId: string, label: string) => {
      setNodes((nds: Node[]) =>
        nds.map((n: Node) => {
          if (n.id !== nodeId) return n
          return {
            ...n,
            data: { ...(n.data as Record<string, unknown>), label },
          }
        })
      )
    },
    [setNodes]
  )

  // Initialize nodes & edges from saved config (runs once on mount)
  // We use useEffect so handleConfigChange/handleLabelChange are available
  useEffect(() => {
    if (!initialConfig) return

    const loadedNodes: Node[] = []
    if (initialConfig.nodes) {
      Object.entries(initialConfig.nodes).forEach(([id, nc]) => {
        loadedNodes.push(
          nodeConfigToReactFlowNode(id, nc, handleConfigChange, handleLabelChange)
        )
      })
    }
    setNodes(loadedNodes)

    const loadedEdges: Edge[] = []
    if (initialConfig.edges) {
      // Build a lookup map: nodeId → NodeTypeId for resolving legacy handle IDs
      const nodeTypeMap: Record<string, NodeTypeId> = {}
      if (initialConfig.nodes) {
        Object.entries(initialConfig.nodes).forEach(([id, nc]) => {
          nodeTypeMap[id] = nc.typeId
        })
      }

      initialConfig.edges.forEach((e) => {
        // Resolve legacy handle IDs to the correct port IDs
        const sourceType = nodeTypeMap[e.source]
        const targetType = nodeTypeMap[e.target]
        loadedEdges.push({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: sourceType ? resolveHandleId(sourceType, e.sourceHandle || 'out', 'output') : (e.sourceHandle || 'out'),
          targetHandle: targetType ? resolveHandleId(targetType, e.targetHandle || 'in', 'input') : (e.targetHandle || 'in'),
          ...defaultEdgeOptions,
        })
      })
    }
    setEdges(loadedEdges)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // ^ intentionally run only on mount — initialConfig is the initial snapshot

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds: Edge[]) =>
        addEdge({ ...connection, ...defaultEdgeOptions }, eds)
      )
    },
    [setEdges]
  )

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      const typeId = event.dataTransfer.getData('application/reactflow') as NodeTypeId
      if (!typeId || !reactFlowInstance) return

      const def = NODE_DEFINITIONS[typeId]
      if (!def) return

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const id = generateId()
      const config: Record<string, string> = {}
      if (def.defaultConfig) {
        Object.entries(def.defaultConfig).forEach(([k, v]) => {
          config[k] = String(v)
        })
      }

      const newNode: Node = {
        id,
        type: 'workflow',
        position,
        data: {
          label: def.name,
          typeId: def.typeId,
          color: def.color,
          icon: def.icon,
          description: def.description,
          category: def.category,
          config,
          onConfigChange: handleConfigChange,
          onLabelChange: handleLabelChange,
        },
      }

      setNodes((nds: Node[]) => nds.concat(newNode))
    },
    [reactFlowInstance, setNodes, handleConfigChange, handleLabelChange]
  )

  const removeSelected = useCallback(() => {
    setNodes((nds: Node[]) => nds.filter((n: Node) => !n.selected))
    setEdges((eds: Edge[]) => eds.filter((e: Edge) => !e.selected))
  }, [setNodes, setEdges])

  const clearAll = useCallback(() => {
    setNodes([])
    setEdges([])
  }, [setNodes, setEdges])

  const handleSave = useCallback(async () => {
    const flowConfig: FlowConfig = {
      masterEnabled,
      nodes: {},
      edges: [],
    }

    nodes.forEach((n: Node) => {
      const d = n.data as Record<string, unknown>
      flowConfig.nodes[n.id] = {
        typeId: d.typeId as NodeTypeId,
        label: d.label as string,
        position: { x: n.position.x, y: n.position.y },
        config: (d.config as Record<string, string>) || {},
        enabled: true,
      }
    })

    edges.forEach((e: Edge) => {
      flowConfig.edges.push({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || 'out',
        targetHandle: e.targetHandle || 'in',
      })
    })

    await onSave(flowConfig)
  }, [nodes, edges, masterEnabled, onSave])

  const onDragStart = useCallback((event: DragEvent, typeId: NodeTypeId) => {
    event.dataTransfer.setData('application/reactflow', typeId)
    event.dataTransfer.effectAllowed = 'move'
  }, [])

  return (
    <div className="flex h-[600px] gap-4">
      {/* Sidebar - Draggable Node Palette */}
      <div className="w-56 shrink-0 space-y-4 overflow-y-auto rounded-xl border bg-card p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Nodes</p>
          <span className="text-[10px] text-muted-foreground">drag & drop</span>
        </div>

        {Object.entries(CATEGORY_LABELS).map(([category, label]) => {
          const categoryNodes = Object.values(NODE_DEFINITIONS).filter(
            (d) => d.category === category
          )
          if (categoryNodes.length === 0) return null

          return (
            <div key={category}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
              </p>
              <div className="space-y-1">
                {categoryNodes.map((def) => (
                  <div
                    key={def.typeId}
                    draggable
                    onDragStart={(e) => onDragStart(e, def.typeId)}
                    className="flex cursor-grab items-center gap-2 rounded-lg border border-border/50 bg-background/50 px-2 py-1.5 text-xs transition-colors hover:bg-accent/50 active:cursor-grabbing"
                  >
                    <GripVertical className="size-3 shrink-0 text-muted-foreground" />
                    <span>{def.icon}</span>
                    <span className="font-medium text-foreground">{def.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Canvas */}
      <div className="relative flex-1">
        {/* Toolbar */}
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg border bg-card/80 p-1.5 backdrop-blur-sm">
          <div className="flex items-center gap-1.5 px-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Gateway
            </span>
            <button
              onClick={() => setMasterEnabled(!masterEnabled)}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                masterEnabled ? 'bg-primary' : 'bg-input'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block size-4 rounded-full bg-background shadow-sm transition-transform',
                  masterEnabled ? 'translate-x-4' : 'translate-x-0'
                )}
              />
            </button>
          </div>

          <div className="h-5 w-px bg-border" />

          <Button
            variant="ghost"
            size="xs"
            onClick={removeSelected}
            disabled={!nodes.some((n: Node) => n.selected)}
            title="Delete selected"
          >
            <Trash2 className="size-3.5" />
          </Button>
          <Button variant="ghost" size="xs" onClick={clearAll} title="Clear all">
            <Trash2 className="size-3.5" />
            <span className="ml-1 text-[10px]">All</span>
          </Button>

          <div className="h-5 w-px bg-border" />

          <Button
            onClick={handleSave}
            disabled={loading}
            size="xs"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            <span className="ml-1">Save</span>
          </Button>
        </div>

        {/* Status message */}
        {status?.message && (
          <div
            className={cn(
              'absolute right-3 top-3 z-10 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs backdrop-blur-sm',
              status.kind === 'success' && 'border-primary/20 bg-primary/10 text-primary',
              status.kind === 'error' && 'border-destructive/20 bg-destructive/10 text-destructive',
              status.kind === 'info' && 'border-border bg-muted text-muted-foreground'
            )}
          >
            <AlertCircle className="size-3" />
            <span>{status.message}</span>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          fitView
          deleteKeyCode={['Backspace', 'Delete']}
          className="rounded-xl border bg-background/50"
        >
          <Background color="oklch(1 0 0 / 5%)" />
          <Controls className="!border-border !bg-card !text-foreground [&_button]:!border-border [&_button]:!bg-card [&_button]:!text-foreground" />
          <MiniMap
            className="!border-border !bg-card"
            nodeColor="oklch(1 0 0 / 20%)"
            maskColor="oklch(0 0 0 / 40%)"
          />
        </ReactFlow>
      </div>
    </div>
  )
}