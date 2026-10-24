'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2,
  Sparkles,
  Bot,
  MessageSquare,
  TicketCheck,
  Headphones,
  ShoppingCart,
  Shield,
  Globe,
  ArrowRight,
  Check,
  Plus,
  Settings,
  AlertCircle,
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { DashboardNav } from '@/components/dashboard/dashboard-nav'
import { PageBackground } from '@/components/page-background'
import WorkflowEditor from '@/components/nodes/WorkflowEditor'
import type { FlowConfig, NodeConfig, EdgeConfig, NodeTypeId } from '@/components/nodes/types'
import { cn } from '@/lib/utils'
import { saveWorkflowExtensionAction } from '@/app/actions'

// ─── Marketplace Templates ────────────────────────────────────────────

type TemplateId =
  | 'customer-support'
  | 'ticketing'
  | 'voice-agent'
  | 'ecommerce'
  | 'enterprise'
  | 'multilingual'

interface Template {
  id: TemplateId
  name: string
  description: string
  icon: React.ReactNode
  color: string
  popular?: boolean
  nodes: Record<string, NodeConfig>
  edges: EdgeConfig[]
}

const TEMPLATES: Template[] = [
  {
    id: 'customer-support',
    name: 'Customer Support',
    description: 'Telegram + WhatsApp → AI Agent → Database. Handles refunds, FAQs, and escalations.',
    icon: <MessageSquare className="size-5" />,
    color: 'from-blue-500 to-cyan-500',
    popular: true,
    nodes: {
      node_telegram: {
        typeId: 'telegram',
        label: 'Telegram',
        position: { x: 50, y: 50 },
        config: { telegram_token: '' },
        enabled: true,
      },
      node_whatsapp: {
        typeId: 'whatsapp',
        label: 'WhatsApp',
        position: { x: 50, y: 250 },
        config: { whatsapp_token: '', whatsapp_phone_id: '' },
        enabled: true,
      },
      node_ai: {
        typeId: 'ai-agent',
        label: 'AI Agent',
        position: { x: 400, y: 150 },
        config: { system_prompt: 'You are a helpful customer support agent.', temperature: '0.2' },
        enabled: true,
      },
      node_db: {
        typeId: 'database',
        label: 'Database',
        position: { x: 750, y: 150 },
        config: { table_name: 'conversations', operation: 'insert' },
        enabled: true,
      },
    },
    edges: [
      { id: 'e1', source: 'node_telegram', target: 'node_ai', sourceHandle: 'out-message', targetHandle: 'in-message' },
      { id: 'e2', source: 'node_whatsapp', target: 'node_ai', sourceHandle: 'out-message', targetHandle: 'in-message' },
      { id: 'e3', source: 'node_ai', target: 'node_db', sourceHandle: 'out-response', targetHandle: 'in' },
    ],
  },
  {
    id: 'ticketing',
    name: 'Ticketing System',
    description: 'Zendesk tickets → AI triage → HITL approval → Email response.',
    icon: <TicketCheck className="size-5" />,
    color: 'from-green-500 to-emerald-500',
    nodes: {
      node_zendesk: {
        typeId: 'zendesk',
        label: 'Zendesk',
        position: { x: 50, y: 150 },
        config: { zendesk_email: '', zendesk_token: '', zendesk_subdomain: '' },
        enabled: true,
      },
      node_ai: {
        typeId: 'ai-agent',
        label: 'AI Triage',
        position: { x: 400, y: 150 },
        config: { system_prompt: 'Triage support tickets by priority.', temperature: '0.1' },
        enabled: true,
      },
      node_hitl: {
        typeId: 'hitl-gate',
        label: 'Approval Gate',
        position: { x: 400, y: 350 },
        config: { approval_method: 'email', notify_email: '', timeout_minutes: '30' },
        enabled: true,
      },
      node_email: {
        typeId: 'email',
        label: 'Email Response',
        position: { x: 750, y: 150 },
        config: { to: '', subject_template: 'Ticket #{{ticket_id}} update' },
        enabled: true,
      },
    },
    edges: [
      { id: 'e1', source: 'node_zendesk', target: 'node_ai', sourceHandle: 'out-message', targetHandle: 'in-message' },
      { id: 'e2', source: 'node_ai', target: 'node_hitl', sourceHandle: 'out-hitl', targetHandle: 'in' },
      { id: 'e3', source: 'node_hitl', target: 'node_email', sourceHandle: 'out-approved', targetHandle: 'in' },
    ],
  },
  {
    id: 'voice-agent',
    name: 'Voice Agent',
    description: 'Webhook (Twilio/Vonage) → AI Agent → Transform → HTTP Response.',
    icon: <Headphones className="size-5" />,
    color: 'from-purple-500 to-violet-500',
    nodes: {
      node_webhook: {
        typeId: 'webhook',
        label: 'Voice Webhook',
        position: { x: 50, y: 150 },
        config: { webhook_url: '/webhook/voice', webhook_secret: '' },
        enabled: true,
      },
      node_ai: {
        typeId: 'ai-agent',
        label: 'Voice AI',
        position: { x: 400, y: 150 },
        config: { system_prompt: 'You are a voice-based customer service agent. Keep responses concise.', temperature: '0.3' },
        enabled: true,
      },
      node_transform: {
        typeId: 'transform',
        label: 'SSML Transform',
        position: { x: 400, y: 350 },
        config: { template: '<speak>{{response}}</speak>' },
        enabled: true,
      },
      node_response: {
        typeId: 'http-response',
        label: 'HTTP Response',
        position: { x: 750, y: 150 },
        config: { status_code: '200' },
        enabled: true,
      },
    },
    edges: [
      { id: 'e1', source: 'node_webhook', target: 'node_ai', sourceHandle: 'out-payload', targetHandle: 'in-message' },
      { id: 'e2', source: 'node_ai', target: 'node_transform', sourceHandle: 'out-response', targetHandle: 'in' },
      { id: 'e3', source: 'node_transform', target: 'node_response', sourceHandle: 'out-transformed', targetHandle: 'in' },
    ],
  },
  {
    id: 'ecommerce',
    name: 'E-Commerce',
    description: 'Webhook (Shopify) → AI Agent → Database + Email for order inquiries.',
    icon: <ShoppingCart className="size-5" />,
    color: 'from-orange-500 to-amber-500',
    nodes: {
      node_webhook: {
        typeId: 'webhook',
        label: 'Shopify Webhook',
        position: { x: 50, y: 150 },
        config: { webhook_url: '/webhook/shopify', webhook_secret: '' },
        enabled: true,
      },
      node_ai: {
        typeId: 'ai-agent',
        label: 'Commerce AI',
        position: { x: 400, y: 150 },
        config: { system_prompt: 'Handle order status, returns, and shipping inquiries.', temperature: '0.2' },
        enabled: true,
      },
      node_db: {
        typeId: 'database',
        label: 'Orders DB',
        position: { x: 750, y: 80 },
        config: { table_name: 'orders', operation: 'upsert' },
        enabled: true,
      },
      node_email: {
        typeId: 'email',
        label: 'Customer Email',
        position: { x: 750, y: 280 },
        config: { to: '', subject_template: 'Order #{{order_id}} update' },
        enabled: true,
      },
    },
    edges: [
      { id: 'e1', source: 'node_webhook', target: 'node_ai', sourceHandle: 'out-payload', targetHandle: 'in-message' },
      { id: 'e2', source: 'node_ai', target: 'node_db', sourceHandle: 'out-response', targetHandle: 'in' },
      { id: 'e3', source: 'node_ai', target: 'node_email', sourceHandle: 'out-response', targetHandle: 'in' },
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise Security',
    description: 'All channels → AI Agent → HITL Gate → Email approval for sensitive actions.',
    icon: <Shield className="size-5" />,
    color: 'from-red-500 to-rose-500',
    nodes: {
      node_telegram: {
        typeId: 'telegram',
        label: 'Telegram',
        position: { x: 50, y: 50 },
        config: { telegram_token: '' },
        enabled: true,
      },
      node_zendesk: {
        typeId: 'zendesk',
        label: 'Zendesk',
        position: { x: 50, y: 250 },
        config: { zendesk_email: '', zendesk_token: '', zendesk_subdomain: '' },
        enabled: true,
      },
      node_ai: {
        typeId: 'ai-agent',
        label: 'Security AI',
        position: { x: 400, y: 150 },
        config: { system_prompt: 'You are a security-aware customer service agent. Flag any sensitive actions for human approval.', temperature: '0.1' },
        enabled: true,
      },
      node_hitl: {
        typeId: 'hitl-gate',
        label: 'Security Gate',
        position: { x: 400, y: 350 },
        config: { approval_method: 'both', notify_email: 'security@company.com', timeout_minutes: '60' },
        enabled: true,
      },
      node_db: {
        typeId: 'database',
        label: 'Audit Log',
        position: { x: 750, y: 80 },
        config: { table_name: 'audit_log', operation: 'insert' },
        enabled: true,
      },
      node_email: {
        typeId: 'email',
        label: 'Security Alert',
        position: { x: 750, y: 280 },
        config: { to: 'security@company.com', subject_template: 'Security alert: {{action}}' },
        enabled: true,
      },
    },
    edges: [
      { id: 'e1', source: 'node_telegram', target: 'node_ai', sourceHandle: 'out-message', targetHandle: 'in-message' },
      { id: 'e2', source: 'node_zendesk', target: 'node_ai', sourceHandle: 'out-message', targetHandle: 'in-message' },
      { id: 'e3', source: 'node_ai', target: 'node_hitl', sourceHandle: 'out-hitl', targetHandle: 'in' },
      { id: 'e4', source: 'node_ai', target: 'node_db', sourceHandle: 'out-response', targetHandle: 'in' },
      { id: 'e5', source: 'node_hitl', target: 'node_email', sourceHandle: 'out-approved', targetHandle: 'in' },
    ],
  },
  {
    id: 'multilingual',
    name: 'Multilingual Support',
    description: 'WhatsApp → AI Agent (multi-language) → Transform → Database.',
    icon: <Globe className="size-5" />,
    color: 'from-teal-500 to-cyan-500',
    nodes: {
      node_whatsapp: {
        typeId: 'whatsapp',
        label: 'WhatsApp',
        position: { x: 50, y: 150 },
        config: { whatsapp_token: '', whatsapp_phone_id: '' },
        enabled: true,
      },
      node_ai: {
        typeId: 'ai-agent',
        label: 'Multi-Lang AI',
        position: { x: 400, y: 150 },
        config: { system_prompt: 'You are a multilingual customer service agent. Detect the user language and respond in the same language.', temperature: '0.2' },
        enabled: true,
      },
      node_transform: {
        typeId: 'transform',
        label: 'Format Response',
        position: { x: 400, y: 350 },
        config: { template: '{{response}}' },
        enabled: true,
      },
      node_db: {
        typeId: 'database',
        label: 'Conversations',
        position: { x: 750, y: 150 },
        config: { table_name: 'conversations', operation: 'insert' },
        enabled: true,
      },
    },
    edges: [
      { id: 'e1', source: 'node_whatsapp', target: 'node_ai', sourceHandle: 'out-message', targetHandle: 'in-message' },
      { id: 'e2', source: 'node_ai', target: 'node_transform', sourceHandle: 'out-response', targetHandle: 'in' },
      { id: 'e3', source: 'node_transform', target: 'node_db', sourceHandle: 'out-transformed', targetHandle: 'in' },
    ],
  },
]

// ─── Status helper ────────────────────────────────────────────────────

type Status = { kind: 'idle' | 'success' | 'error' | 'info'; message: string }

// ─── Marketplace Page ─────────────────────────────────────────────────

export default function MarketplacePage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [tenantName, setTenantName] = useState('there')
  const [checking, setChecking] = useState(true)

  // View state: 'browse' | 'editor'
  const [view, setView] = useState<'browse' | 'editor'>('browse')
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [flowConfig, setFlowConfig] = useState<FlowConfig>({ masterEnabled: true, nodes: {}, edges: [] })
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' })

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/auth')
        return
      }
      setUserId(user.id)
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_name')
        .eq('id', user.id)
        .maybeSingle()
      if (profile?.tenant_name) setTenantName(profile.tenant_name)
      setChecking(false)
    }
    load()
  }, [router])

  const handleSelectTemplate = useCallback((template: Template) => {
    setSelectedTemplate(template)
    setFlowConfig({
      masterEnabled: true,
      nodes: { ...template.nodes },
      edges: [...template.edges],
    })
    setView('editor')
    setStatus({ kind: 'idle', message: '' })
  }, [])

  const handleSave = useCallback(async (config: FlowConfig) => {
    if (!userId) return
    setSaving(true)
    setStatus({ kind: 'info', message: 'Deploying your custom AI agent...' })

    try {
      // Deploy to the workspace OWNER's profile row (the shared flow the AI
      // runtime executes) via the service-role server action. Deploying a
      // template must replace the flow the whole team sees — not a per-user
      // copy that the runtime ignores.
      await saveWorkflowExtensionAction({
        'connection-extension': {
          enabled: config.masterEnabled,
          platforms: extractPlatforms(config),
          flow: {
            masterEnabled: config.masterEnabled,
            nodes: config.nodes,
            edges: config.edges,
          },
        },
      })

      setFlowConfig(config)
      setStatus({ kind: 'success', message: `✅ "${selectedTemplate?.name ?? 'Custom AI'}" deployed successfully!` })
    } catch (err) {
      console.error(err)
      setStatus({ kind: 'error', message: 'Failed to deploy agent.' })
    } finally {
      setSaving(false)
    }
  }, [userId, selectedTemplate])

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-background">
      <PageBackground />
      <DashboardNav tenantName={tenantName} />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
        {view === 'browse' ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
                  Marketplace
                </p>
                <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">
                  Custom AI Agents
                </h1>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  Choose a pre-built template or start from scratch. Each agent is a drag-and-drop workflow
                  you can customize to your needs.
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedTemplate(null)
                  setFlowConfig({ masterEnabled: true, nodes: {}, edges: [] })
                  setView('editor')
                }}
                className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Plus className="size-4" />
                Blank Canvas
              </button>
            </div>

            {/* Template Grid */}
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  onClick={() => handleSelectTemplate(template)}
                  className="group relative flex flex-col rounded-xl border border-border/60 bg-card p-6 text-left transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
                >
                  {template.popular && (
                    <span className="absolute -top-2.5 right-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                      POPULAR
                    </span>
                  )}

                  <div className={cn(
                    'flex size-10 items-center justify-center rounded-lg bg-gradient-to-br text-white',
                    template.color
                  )}>
                    {template.icon}
                  </div>

                  <h3 className="mt-4 font-display text-lg font-bold text-foreground group-hover:text-primary transition-colors">
                    {template.name}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {template.description}
                  </p>

                  {/* Node count badges */}
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {Object.values(template.nodes).map((node) => (
                      <span
                        key={node.typeId}
                        className="rounded-md border border-border/40 bg-background/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        {node.label}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center gap-1.5 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    Customize <ArrowRight className="size-3" />
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Editor View */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <button
                  onClick={() => setView('browse')}
                  className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
                >
                  ← Back to Marketplace
                </button>
                <h1 className="font-display text-2xl font-bold tracking-tight">
                  {selectedTemplate ? `Customize: ${selectedTemplate.name}` : 'Blank Canvas'}
                </h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Drag, drop, and connect nodes to build your AI agent workflow.
                </p>
              </div>

              {/* Status indicator */}
              {status.message && (
                <div className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
                  status.kind === 'success' && 'border-primary/20 bg-primary/10 text-primary',
                  status.kind === 'error' && 'border-destructive/20 bg-destructive/10 text-destructive',
                  status.kind === 'info' && 'border-border bg-muted text-muted-foreground'
                )}>
                  <AlertCircle className="size-3.5" />
                  <span>{status.message}</span>
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-card">
              <WorkflowEditor
                initialConfig={flowConfig}
                onSave={handleSave}
                loading={saving}
                status={status.kind !== 'idle' ? status : null}
              />
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// ─── Helper: extract platform configs from flow ───────────────────────

function extractPlatforms(flow: FlowConfig): Record<string, { enabled: boolean; config: Record<string, string> }> {
  const platforms: Record<string, { enabled: boolean; config: Record<string, string> }> = {
    telegram: { enabled: false, config: {} },
    whatsapp: { enabled: false, config: {} },
    zendesk: { enabled: false, config: {} },
  }

  Object.values(flow.nodes).forEach((node) => {
    if (node.typeId === 'telegram' || node.typeId === 'whatsapp' || node.typeId === 'zendesk') {
      platforms[node.typeId] = {
        enabled: node.enabled,
        config: node.config,
      }
    }
  })

  return platforms
}