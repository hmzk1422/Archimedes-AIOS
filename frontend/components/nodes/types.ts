export type NodeCategory = 'input' | 'processing' | 'output'

export type NodeTypeId =
  | 'telegram'
  | 'whatsapp'
  | 'zendesk'
  | 'webhook'
  | 'ai-agent'
  | 'hitl-gate'
  | 'transform'
  | 'database'
  | 'email'
  | 'http-response'

export interface NodeField {
  key: string
  label: string
  placeholder?: string
  type?: 'text' | 'password' | 'email' | 'number' | 'select'
  options?: { label: string; value: string }[]
  required?: boolean
}

export interface NodePort {
  id: string
  label: string
  type: 'input' | 'output'
}

export interface NodeDefinition {
  typeId: NodeTypeId
  category: NodeCategory
  name: string
  description: string
  color: string
  icon: string // emoji or icon name
  fields: NodeField[]
  ports: NodePort[]
  defaultConfig?: Record<string, unknown>
}

export interface NodeConfig {
  typeId: NodeTypeId
  label: string
  position: { x: number; y: number }
  config: Record<string, string>
  enabled: boolean
}

export interface EdgeConfig {
  id: string
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
}

export interface FlowConfig {
  nodes: Record<string, NodeConfig>
  edges: EdgeConfig[]
  masterEnabled: boolean
}