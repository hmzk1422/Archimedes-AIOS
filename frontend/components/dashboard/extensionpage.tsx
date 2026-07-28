'use client'

import { useEffect, useState, useCallback } from 'react'
import { AlertCircle, Loader2, Settings } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import WorkflowEditor from '@/components/nodes/WorkflowEditor'
import type { FlowConfig, NodeConfig, EdgeConfig, NodeTypeId } from '@/components/nodes/types'

type Status = { kind: 'idle' | 'success' | 'error' | 'info'; message: string }

/**
 * Converts the old flat platform config to the new flow node-based config.
 * Each platform becomes an Input node, and the AI agent becomes a Processing node.
 */
function legacyToFlowConfig(legacy: Record<string, unknown> | null): FlowConfig {
  if (!legacy) {
    return { masterEnabled: true, nodes: {}, edges: [] }
  }

  const connection = (legacy as Record<string, unknown>)['connection-extension'] as
    | Record<string, unknown>
    | undefined

  const masterEnabled = Boolean(connection?.enabled ?? true)
  const platforms = (connection?.platforms as Record<string, { enabled: boolean; config: Record<string, string> }>) ?? {}

  const nodes: Record<string, NodeConfig> = {}
  const edges: EdgeConfig[] = []

  let hasAiAgent = false

  Object.entries(platforms).forEach(([platformKey, pConfig], idx) => {
    if (!pConfig.enabled) return

    const nodeId = `node_legacy_${platformKey}`
    nodes[nodeId] = {
      typeId: platformKey as NodeTypeId,
      label: platformKey.charAt(0).toUpperCase() + platformKey.slice(1),
      position: { x: 50, y: idx * 200 + 50 },
      config: pConfig.config || {},
      enabled: true,
    }
    hasAiAgent = true
  })

  // Add a default AI Agent node if there are input platforms
  if (hasAiAgent) {
    const aiNodeId = 'node_legacy_ai_agent'
    nodes[aiNodeId] = {
      typeId: 'ai-agent',
      label: 'AI Agent',
      position: { x: 400, y: 150 },
      config: { system_prompt: '', temperature: '0.2' },
      enabled: true,
    }

    // Connect each input node to the AI agent
    Object.keys(nodes).forEach((nodeId) => {
      if (nodeId !== aiNodeId) {
        edges.push({
          id: `edge_${nodeId}_to_ai`,
          source: nodeId,
          target: aiNodeId,
          sourceHandle: 'out',
          targetHandle: 'in',
        })
      }
    })

    // Add a default Database output node
    const dbNodeId = 'node_legacy_db'
    nodes[dbNodeId] = {
      typeId: 'database',
      label: 'Database',
      position: { x: 750, y: 150 },
      config: { table_name: 'conversations', operation: 'insert' },
      enabled: true,
    }

    edges.push({
      id: `edge_ai_to_db`,
      source: aiNodeId,
      target: dbNodeId,
      sourceHandle: 'out',
      targetHandle: 'in',
    })
  }

  return { masterEnabled, nodes, edges }
}

/**
 * Converts the new flow node config back to the legacy flat platform config
 * so the existing backend (extension.py / profiles.extension) can still read it.
 */
function flowToLegacyConfig(flow: FlowConfig): Record<string, unknown> {
  const platforms: Record<string, { enabled: boolean; config: Record<string, string> }> = {
    telegram: { enabled: false, config: {} },
    whatsapp: { enabled: false, config: {} },
    zendesk: { enabled: false, config: {} },
  }

  // Extract platform credentials from input nodes
  Object.values(flow.nodes).forEach((node) => {
    if (node.typeId === 'telegram' || node.typeId === 'whatsapp' || node.typeId === 'zendesk') {
      platforms[node.typeId] = {
        enabled: node.enabled,
        config: node.config,
      }
    }
  })

  return {
    'connection-extension': {
      enabled: flow.masterEnabled,
      platforms,
    },
  }
}

export default function ExtensionPage() {
  const [flowConfig, setFlowConfig] = useState<FlowConfig>({ masterEnabled: true, nodes: {}, edges: [] })
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' })

  useEffect(() => {
    let cancelled = false

    async function loadExtensionSettings() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        if (!cancelled) setChecking(false)
        return
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('extension')
        .eq('id', user.id)
        .maybeSingle()

      if (cancelled) return

      if (error) {
        setStatus({ kind: 'error', message: 'Failed to load extension settings.' })
      } else {
        // Convert legacy config OR use the new flow format
        const ext = data?.extension as Record<string, unknown> | null
        setFlowConfig(legacyToFlowConfig(ext))
      }

      setChecking(false)
    }

    void loadExtensionSettings()

    return () => {
      cancelled = true
    }
  }, [])

  const handleSave = useCallback(async (config: FlowConfig) => {
    setLoading(true)
    setStatus({ kind: 'info', message: 'Saving workflow...' })
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      setStatus({ kind: 'error', message: 'You must be logged in.' })
      setLoading(false)
      return
    }

    try {
      // Convert to legacy format for backend compatibility
      const legacyConfig = flowToLegacyConfig(config)
      const { error } = await supabase
        .from('profiles')
        .update({ extension: legacyConfig })
        .eq('id', user.id)

      if (error) throw error

      setFlowConfig(config)
      setStatus({ kind: 'success', message: 'Workflow saved successfully.' })
    } catch (err) {
      console.error(err)
      setStatus({ kind: 'error', message: 'Failed to save workflow.' })
    } finally {
      setLoading(false)
    }
  }, [])

  if (checking) {
    return (
      <section className="space-y-6">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Connections</p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight">Agent Workflow</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Drag and drop nodes to build your agent workflow.
          </p>
        </div>
        <Card>
          <CardContent className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Connections</p>
        <h2 className="mt-1 font-display text-2xl font-bold tracking-tight">Agent Workflow</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Drag and drop nodes to build your agent workflow. Connect inputs → processing → outputs.
        </p>
      </div>

      {status.message && (
        <div className={cn(
          'rounded-lg border p-3 text-sm flex items-center gap-2',
          status.kind === 'success' && 'border-primary/20 bg-primary/10 text-primary',
          status.kind === 'error' && 'border-destructive/20 bg-destructive/10 text-destructive',
          status.kind === 'info' && 'border-border bg-muted text-muted-foreground'
        )}>
          <AlertCircle className="size-4" />
          <p>{status.message}</p>
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Settings className="size-5" />
            Node Editor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <WorkflowEditor
            initialConfig={flowConfig}
            onSave={handleSave}
            loading={loading}
            status={status.kind !== 'idle' ? status : null}
          />
        </CardContent>
      </Card>
    </section>
  )
}