'use client'

import { useState } from 'react'
import { Bot, Code2, LineChart, Workflow, Copy, Check, Wand2 } from 'lucide-react'
import { WidgetCard } from './widget-card'
import type { DashboardWidget } from './types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type AICoderMode = 'widget-metric' | 'workflow-node'

const METRIC_SOURCES = [
  { value: 'telemetry_metrics', label: 'AI Metrics (telemetry_metrics)' },
  { value: 'conversations', label: 'Conversations' },
  { value: 'telemetry_events', label: 'Telemetry Events (traces)' },
] as const

const AGGREGATIONS = ['avg', 'sum', 'count', 'max'] as const

function titleCase(s: string) {
  return s
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

export function AICoderWidget({ widget }: { widget: DashboardWidget; data?: unknown }) {
  const [mode, setMode] = useState<AICoderMode>('widget-metric')
  const [prompt, setPrompt] = useState('')
  const [source, setSource] = useState<string>(METRIC_SOURCES[0].value)
  const [aggregation, setAggregation] = useState<string>(AGGREGATIONS[0])
  const [field, setField] = useState('')
  const [generating, setGenerating] = useState(false)
  const [output, setOutput] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const generateWidgetBinding = () => {
    const safeName = (prompt.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'custom-metric').replace(/(^-|-$)/g, '')
    const title = prompt.trim().replace(/\s+/g, ' ') || 'Custom Metric'
    const metricField = field.trim() || 'value'

    return `// ── Step 1. Widget definition (widget-registry.ts) ─────────────────────
// Generated for: "${title}"
import { TrendingUp } from 'lucide-react'

export const DEFINITION = {
  type: '${safeName}',
  name: '${titleCase(safeName)}',
  description: '${title}',
  icon: TrendingUp,
  defaultWidth: 2,
  defaultHeight: 2,
  defaultDataSource: { nodeType: '${source}' },
  defaultRange: '30d',
  viewType: 'metric',
}

// ── Step 2. Data-source binding (connects to AI bot metrics) ─────────────
// The contract between the widget and your AI bot's telemetry.
export function dataSource() {
  return {
    endpoint: '/dashboard/widget-data/{tenantId}',
    source: '${source}',
    // Aggregation applied server-side:
    aggregation: '${aggregation}',
    field: '${metricField}',
    filter: { tenant_id: '{tenantId}' },
    range: '30d',
  }
}

// ── Step 3. Widget component (custom-metric-widget.tsx pattern) ──────────
// Reads the aggregated metric from the payload and renders it.
export function WidgetComponent({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="p-4">
      <h3 className="text-sm font-medium">${title}</h3>
      <p className="text-2xl font-bold tabular-nums">
        {formatMetric(data.${metricField}, '${aggregation}')}
      </p>
    </div>
  )
}`
  }

  const generateNodeDefinition = () => {
    const safeName = (prompt.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'custom-node').replace(/(^-|-$)/g, '')
    const title = prompt.trim().replace(/\s+/g, ' ') || 'Custom Node'

    return `// ── Workflow node definition (components/nodes/types.ts pattern) ──────────
// Generated for: "${title}"
export const NODE_DEFINITION = {
  type: '${safeName}',
  label: '${titleCase(safeName)}',
  category: 'custom',
  color: '#8b5cf6',
  inputs: {
    prompt: { type: 'string', default: '' },
    tenant_id: { type: 'string', default: '{tenantId}' },
  },
  outputs: {
    result: { type: 'any' },
    error: { type: 'string' },
  },
  // Ports that connect this node into the drag-and-drop canvas
  ports: [
    { id: 'in', type: 'input' },
    { id: 'out', type: 'output' },
  ],
}

// ── Execution handler (runs when the workflow reaches this node) ─────────
export async function handler(ctx: {
  inputs: Record<string, unknown>
  logger: { info: (m: string) => void }
}) {
  ctx.logger.info('[${safeName}] executing with ' + JSON.stringify(ctx.inputs))
  // TODO: implement ${title} logic here
  return { result: ctx.inputs.prompt }
}

// ── Register in registry.ts so it appears in the drag-and-drop palette ──
import NodeComponent from './nodes/${safeName}.tsx'
// NODE_CLASSES['${safeName}'] = NodeComponent`
  }

  const handleGenerate = () => {
    setGenerating(true)
    setCopied(false)
    const code = mode === 'widget-metric' ? generateWidgetBinding() : generateNodeDefinition()
    setTimeout(() => {
      setOutput(code)
      setGenerating(false)
    }, 700)
  }

  const handleCopy = async () => {
    if (!output) return
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard errors
    }
  }

  return (
    <WidgetCard widget={widget}>
      <div className="space-y-4">
        {/* Mode selector */}
        <div className="flex rounded-lg border border-border bg-muted/40 p-1">
          {(
            [
              { key: 'widget-metric' as const, label: 'Widget ↔ Metric', icon: LineChart },
              { key: 'workflow-node' as const, label: 'Workflow Node', icon: Workflow },
            ]
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setMode(key)
                setOutput(null)
              }}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                mode === key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-primary/5 p-3">
          <Bot className="size-4 shrink-0 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium">
              {mode === 'widget-metric'
                ? 'Connect a widget to AI bot metrics'
                : 'Build a drag-and-drop workflow node'}
            </p>
            <p className="text-xs text-muted-foreground">
              {mode === 'widget-metric'
                ? 'Describe the metric you want to surface. AI generates the widget + data-source binding code.'
                : 'Describe the node behavior. AI generates its definition, ports, and execution handler.'}
            </p>
          </div>
          <Code2 className="size-4 shrink-0 text-primary" />
        </div>

        {/* Prompt */}
        <div className="space-y-2">
          <label className="text-sm font-medium">
            {mode === 'widget-metric'
              ? 'What metric should this widget track?'
              : 'What should this node do?'}
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              mode === 'widget-metric'
                ? "E.g., 'Show deflection rate over the last 30 days'"
                : "E.g., 'Send a Telegram alert when error rate exceeds 5%'"
            }
            className="w-full resize-none rounded-lg border border-border bg-background p-3 text-sm"
            rows={2}
          />
        </div>

        {/* Widget-metric options */}
        {mode === 'widget-metric' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-medium">Data source</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full rounded-lg border border-border bg-background p-2 text-sm"
              >
                {METRIC_SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium">Aggregation</label>
              <select
                value={aggregation}
                onChange={(e) => setAggregation(e.target.value)}
                className="w-full rounded-lg border border-border bg-background p-2 text-sm"
              >
                {AGGREGATIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <Button onClick={handleGenerate} disabled={!prompt || generating} className="w-full gap-2">
          {generating ? (
            <>
              <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Generating…
            </>
          ) : (
            <>
              <Wand2 className="size-4" />
              {mode === 'widget-metric' ? 'Generate widget + metric binding' : 'Generate node definition'}
            </>
          )}
        </Button>

        {/* Output */}
        {output && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 className="size-4 text-primary" />
                <p className="text-xs font-medium">
                  {mode === 'widget-metric' ? 'Widget + data-source binding' : 'Workflow node code'}
                </p>
              </div>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background p-3 text-xs leading-relaxed">
              {output}
            </pre>
          </div>
        )}
      </div>
    </WidgetCard>
  )
}
