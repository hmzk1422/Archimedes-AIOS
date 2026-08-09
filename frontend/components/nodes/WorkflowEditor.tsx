'use client'

import { useCallback, useRef, useState, useEffect, DragEvent, ClipboardEvent, useMemo } from 'react'
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
import { Save, Loader2, Trash2, AlertCircle, GripVertical, Search, X, Copy, ClipboardPaste } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import WorkflowNode from './WorkflowNode'
import { NODE_DEFINITIONS, CATEGORY_LABELS } from './definitions'
import { useActivepiecesNodes, type NodeDefinition } from '@/hooks/useActivepiecesNodes'
import type { NodeTypeId, FlowConfig, NodeConfig } from './types'

const nodeTypes = {
  workflow: WorkflowNode,
}

interface WorkflowEditorProps {
  initialConfig?: FlowConfig
  onSave: (config: FlowConfig) => Promise<void>
  loading?: boolean
  status?: { kind: 'idle' | 'success' | 'error' | 'info'; message: string } | null
  /** When true the editor fills its parent's height instead of a fixed 600px tall box. */
  fullScreen?: boolean
}

function generateId(): string {
  return `node_${Math.random().toString(36).substring(2, 9)}`
}

/** Serializable copy/paste payload — works in-canvas and across canvases/tabs. */
interface ClipboardNode {
  id: string
  typeId: NodeTypeId
  label: string
  position: { x: number; y: number }
  config: Record<string, string>
}

interface ClipboardData {
  nodes: ClipboardNode[]
  edges: { source: string; target: string; sourceHandle: string; targetHandle: string }[]
}

/** Map legacy handle IDs ("in"/"out") to the correct port ID from the node definition */
function resolveHandleId(typeId: NodeTypeId, handleId: string, portType: 'input' | 'output'): string {
  if (handleId !== 'in' && handleId !== 'out') return handleId

  const def = NODE_DEFINITIONS[typeId]
  if (!def) return handleId

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
  style: { stroke: 'oklch(1 0 0 / 20%)', strokeWidth: 2 },
  animated: false,
  type: 'smoothstep',
}

// Connection validation
const isValidConnection = (connection: Connection): boolean => {
  if (!connection.source || !connection.target) return false
  if (connection.source === connection.target) return false

  const sourceHandle = connection.sourceHandle || ''
  const targetHandle = connection.targetHandle || ''

  const isSourceOutput = sourceHandle.startsWith('out')
  const isTargetInput = targetHandle.startsWith('in')

  return isSourceOutput && isTargetInput
}

export default function WorkflowEditor({ initialConfig, onSave, loading, status, fullScreen = false }: WorkflowEditorProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const [masterEnabled, setMasterEnabled] = useState(initialConfig?.masterEnabled ?? true)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  
  // Load Activepieces nodes dynamically
  const { nodeDefinitions: dynamicNodeDefinitions, loading: piecesLoading } = useActivepiecesNodes()
  
  // Merge hardcoded definitions with dynamic ones — memoize to prevent infinite re-renders
  const allNodeDefinitions = useMemo(
    () => ({ ...NODE_DEFINITIONS, ...dynamicNodeDefinitions }) as Record<string, NodeDefinition>,
    [dynamicNodeDefinitions]
  )
  const allCategoryLabels = {
    input: 'Triggers',
    processing: 'Logic & AI',
    output: 'Actions',
  }
  
  // Initialize expanded categories only once when definitions first load
  const [defsInitialized, setDefsInitialized] = useState(false)
  useEffect(() => {
    if (!defsInitialized && Object.keys(allNodeDefinitions).length > 0) {
      setExpandedCategories(new Set(Object.keys(allCategoryLabels)))
      setDefsInitialized(true)
    }
  }, [allNodeDefinitions, defsInitialized])

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  )
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  )

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
      const nodeTypeMap: Record<string, NodeTypeId> = {}
      if (initialConfig.nodes) {
        Object.entries(initialConfig.nodes).forEach(([id, nc]) => {
          nodeTypeMap[id] = nc.typeId
        })
      }

      initialConfig.edges.forEach((e) => {
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

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection)) return

      setEdges((eds: Edge[]) =>
        addEdge({ 
          ...connection, 
          ...defaultEdgeOptions,
          id: `edge_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        }, eds)
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
      const typeId = event.dataTransfer.getData('application/reactflow')
      if (!typeId || !reactFlowInstance) return

      const def = allNodeDefinitions[typeId] as NodeDefinition | undefined
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
          typeId: def.typeId as NodeTypeId,
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
    [reactFlowInstance, setNodes, handleConfigChange, handleLabelChange, allNodeDefinitions]
  )

  const removeSelected = useCallback(() => {
    setNodes((nds: Node[]) => nds.filter((n: Node) => !n.selected))
    setEdges((eds: Edge[]) => eds.filter((e: Edge) => !e.selected))
  }, [setNodes, setEdges])

  const clearAll = useCallback(() => {
    setNodes([])
    setEdges([])
  }, [setNodes, setEdges])

  // ──────────────────────────────────────────────
  // Copy / Paste (Activepieces-style)
  // ──────────────────────────────────────────────
  const clipboardRef = useRef<ClipboardData | null>(null)
  const [canPaste, setCanPaste] = useState(false)

  const copySelection = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected)
    if (selectedNodes.length === 0) return

    const selectedIds = new Set(selectedNodes.map((n) => n.id))
    const selectedEdges = edges.filter(
      (e) => selectedIds.has(e.source) && selectedIds.has(e.target)
    )

    const clipData: ClipboardData = {
      nodes: selectedNodes.map((n) => {
        const d = n.data as Record<string, unknown>
        return {
          id: n.id,
          typeId: (d.typeId as NodeTypeId) || 'ai-agent',
          label: (d.label as string) || '',
          position: { x: n.position.x, y: n.position.y },
          config: (d.config as Record<string, string>) || {},
        }
      }),
      edges: selectedEdges.map((e) => ({
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || 'out',
        targetHandle: e.targetHandle || 'in',
      })),
    }

    clipboardRef.current = clipData
    setCanPaste(true)

    // Also put a portable JSON payload on the real clipboard so the same nodes can
    // be pasted into another flow / another tab, just like Activepieces.
    try {
      navigator.clipboard?.writeText(JSON.stringify(clipData))
    } catch {
      // best-effort — the in-memory ref still enables in-canvas paste
    }
  }, [nodes, edges])

  const pasteFromData = useCallback(
    (clipData: ClipboardData, at?: { x: number; y: number }) => {
      const sourceNodes = clipData.nodes || []
      if (sourceNodes.length === 0) return

      let minX = Infinity
      let minY = Infinity
      sourceNodes.forEach((n) => {
        if (n.position.x < minX) minX = n.position.x
        if (n.position.y < minY) minY = n.position.y
      })

      // "at" positions the top-left of the pasted group at the drop point (if given),
      // otherwise the pasted group is offset from the original nodes.
      const offsetX = at ? at.x - minX : 40
      const offsetY = at ? at.y - minY : 40

      const idMap = new Map<string, string>()
      const newNodes: Node[] = sourceNodes.map((n) => {
        const newId = generateId()
        idMap.set(n.id, newId)
        return nodeConfigToReactFlowNode(
          newId,
          {
            typeId: n.typeId,
            label: n.label,
            position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
            config: n.config || {},
            enabled: true,
          },
          handleConfigChange,
          handleLabelChange
        )
      })

      const newEdges: Edge[] = (clipData.edges || [])
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({
          ...defaultEdgeOptions,
          id: `edge_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          source: idMap.get(e.source)!,
          target: idMap.get(e.target)!,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
          selected: false,
        }))

      setNodes((nds: Node[]) =>
        nds
          .map((n) => (n.selected ? { ...n, selected: false } : n))
          .concat(newNodes.map((n) => ({ ...n, selected: true })))
      )
      setEdges((eds: Edge[]) => eds.concat(newEdges))
      setCanPaste(true)
    },
    [setNodes, setEdges, handleConfigChange, handleLabelChange]
  )

  const pasteClipboard = useCallback(() => {
    if (clipboardRef.current) {
      pasteFromData(clipboardRef.current)
    }
  }, [pasteFromData])

  // Handles pasting a JSON payload from an external clipboard (e.g. copied from
  // another flow, another tab, or a JSON export).
  const handleCanvasPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const text = event.clipboardData?.getData('text/plain')
      if (!text) return

      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return // not our JSON payload
      }

      if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as ClipboardData).nodes)) {
        return
      }

      const raw = parsed as ClipboardData
      const normalizedNodes: ClipboardNode[] = (raw.nodes || [])
        .filter((n) => n && typeof n === 'object' && typeof n.typeId === 'string')
        .map((n) => ({
          id: String(n.id ?? generateId()),
          typeId: n.typeId as NodeTypeId,
          label: String(n.label ?? ''),
          position: {
            x: Number(n.position?.x ?? 0),
            y: Number(n.position?.y ?? 0),
          },
          config: (n.config as Record<string, string>) || {},
        }))

      if (normalizedNodes.length === 0) return

      event.preventDefault()
      clipboardRef.current = { nodes: normalizedNodes, edges: raw.edges || [] }
      pasteFromData(clipboardRef.current)
    },
    [pasteFromData]
  )

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

  const onDragStart = useCallback((event: DragEvent, typeId: string) => {
    event.dataTransfer.setData('application/reactflow', typeId)
    event.dataTransfer.effectAllowed = 'move'
  }, [])

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  const filteredNodes = Object.entries(allNodeDefinitions).filter(([_, def]) => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    const nodeDef = def as NodeDefinition
    return (
      nodeDef.name.toLowerCase().includes(query) ||
      nodeDef.description.toLowerCase().includes(query)
    )
  })

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
          return
        }
        removeSelected()
      }
      
      if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
          return
        }
        event.preventDefault()
        copySelection()
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
          return
        }
        event.preventDefault()
        pasteClipboard()
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault()
        if (!loading) {
          handleSave()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [removeSelected, copySelection, pasteClipboard, handleSave, loading])

  return (
    <div className={cn('flex gap-4', fullScreen ? 'h-full min-h-0' : 'h-[600px]')}>
      {/* Sidebar - Draggable Node Palette */}
      <div className="w-64 shrink-0 flex flex-col rounded-xl border border-border bg-card shadow-sm">
        {/* Search */}
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search nodes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-input bg-background pl-8 pr-8 py-1.5 text-xs outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Node list */}
        <div className="flex-1 overflow-y-auto p-3">
          {Object.entries(allCategoryLabels).map(([category, label]) => {
            const categoryNodes = filteredNodes.filter(([_, def]) => def.category === category)
            if (categoryNodes.length === 0) return null

            const isExpanded = expandedCategories.has(category)

            return (
              <div key={category} className="mb-3">
                <button
                  onClick={() => toggleCategory(category)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent/50"
                >
                  <span>{label}</span>
                  <span className="text-muted-foreground">{isExpanded ? '−' : '+'}</span>
                </button>

                {isExpanded && (
                  <div className="mt-1 space-y-1">
                    {categoryNodes.map(([typeId, def]) => (
                      <div
                        key={def.typeId}
                        draggable
                        onDragStart={(e) => onDragStart(e, typeId)}
                        className="group flex cursor-grab items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-xs transition-all hover:border-muted-foreground/50 hover:shadow-sm active:cursor-grabbing"
                      >
                        <GripVertical className="size-3 shrink-0 text-muted-foreground group-hover:text-foreground" />
                        <div
                          className="flex size-6 shrink-0 items-center justify-center rounded-md text-white"
                          style={{ backgroundColor: def.color }}
                        >
                          <span className="text-xs">{def.icon}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">{def.name}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Canvas */}
      <div className="relative flex-1 rounded-xl border border-border bg-background/50 shadow-sm overflow-hidden" onPaste={handleCanvasPaste}>
        {/* Toolbar */}
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-border bg-card p-1.5 shadow-sm">
          <div className="flex items-center gap-1.5 px-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Gateway
            </span>
            <button
              onClick={() => setMasterEnabled(!masterEnabled)}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                masterEnabled ? 'bg-primary' : 'bg-input'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block size-4 rounded-full bg-background shadow-sm transition-transform duration-200',
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
            className="hover:bg-accent/50"
          >
            <Trash2 className="size-3.5 text-foreground" />
          </Button>
          <Button variant="ghost" size="xs" onClick={clearAll} title="Clear all" className="hover:bg-accent/50">
            <Trash2 className="size-3.5 text-foreground" />
            <span className="ml-1 text-[10px] text-foreground">All</span>
          </Button>

          <div className="h-5 w-px bg-border" />

          <Button
            variant="ghost"
            size="xs"
            onClick={copySelection}
            disabled={!nodes.some((n: Node) => n.selected)}
            title="Copy selected (Ctrl+C)"
            className="hover:bg-accent/50"
          >
            <Copy className="size-3.5 text-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={pasteClipboard}
            disabled={!canPaste}
            title="Paste (Ctrl+V)"
            className="hover:bg-accent/50"
          >
            <ClipboardPaste className="size-3.5 text-foreground" />
          </Button>

          <div className="h-5 w-px bg-border" />

          <Button
            onClick={handleSave}
            disabled={loading}
            size="xs"
            className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            <span className="ml-1 text-xs">Save</span>
          </Button>
        </div>

        {/* Status message */}
        {status?.message && (
          <div
            className={cn(
              'absolute right-3 top-3 z-10 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm',
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
          fitViewOptions={{ padding: 0.2 }}
          deleteKeyCode={['Backspace', 'Delete']}
          className="bg-background/50"
          defaultEdgeOptions={defaultEdgeOptions}
          proOptions={{ hideAttribution: true }}
          snapToGrid={true}
          snapGrid={[15, 15]}
          connectionLineStyle={{ stroke: 'oklch(95% 0.04 80)', strokeWidth: 2 }}
          minZoom={0.1}
          maxZoom={2}
        >
          <Background color="oklch(1 0 0 / 5%)" gap={16} size={1} />
          <Controls 
            className="!border-border !bg-card !text-foreground [&_button]:!border-border [&_button]:!bg-card [&_button]:!text-foreground hover:[&_button]:!bg-accent/50"
            showInteractive={false}
          />
          <MiniMap
            className="!border-border !bg-card"
            nodeColor={(node) => (node.data as Record<string, unknown>)?.color as string || 'oklch(1 0 0 / 20%)'}
            maskColor="oklch(0 0 0 / 40%)"
            style={{ height: 120, width: 200 }}
          />
        </ReactFlow>

        {/* Empty state */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="mb-2 text-4xl">🎯</div>
              <p className="text-sm font-medium text-muted-foreground">Drag nodes here to build your workflow</p>
              <p className="mt-1 text-xs text-muted-foreground/70">or search for a node in the sidebar</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}