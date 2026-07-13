'use client'

import { useState, useEffect, useCallback, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  BarChart3,
  Plus,
  Trash2,
  Save,
  Play,
  Activity,
  Target,
  Zap,
  Eye,
  Loader2,
  TrendingUp,
  Gauge,
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { DashboardNav } from '@/components/dashboard/dashboard-nav'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  Area,
  AreaChart,
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type EvaluationDefinition = {
  name: string
  description: string
  metric_type: 'faithfulness' | 'relevance' | 'custom'
  min_score: number
  max_score: number
  tags: string[]
}

type TelemetryEvent = {
  event_type: string
  attributes?: Record<string, unknown>
  timestamp?: number
  trace_id?: string | null
}

type TelemetryMetric = {
  metric_name: string
  metric_type: string
  value: number
  tags?: Record<string, string>
  timestamp?: number
}

type TelemetryEvaluation = {
  evaluation_name: string
  score: number
  metadata?: Record<string, unknown>
  timestamp?: number
}

type Status = { kind: 'idle' | 'success' | 'error' | 'info'; message: string }

const TABLE_NAME = 'customer-service-provider'

// ──────────────────────────────────────────────
// Sample data for the chart previews
// ──────────────────────────────────────────────

function generateSampleEvalData() {
  const now = Date.now()
  return Array.from({ length: 14 }, (_, i) => ({
    date: new Date(now - (13 - i) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    faithfulness: 7 + Math.random() * 3,
    relevance: 6 + Math.random() * 4,
    custom: 5 + Math.random() * 5,
  }))
}

const evalChartConfig = {
  faithfulness: { label: 'Faithfulness', color: 'var(--chart-1)' },
  relevance: { label: 'Relevance', color: 'var(--chart-2)' },
  custom: { label: 'Custom Score', color: 'var(--chart-3)' },
} satisfies ChartConfig

// ──────────────────────────────────────────────
// Main Page Component
// ──────────────────────────────────────────────

type TabKey = 'evaluations' | 'events' | 'metrics' | 'sdk-setup'

export default function MetricsPage() {
  const router = useRouter()

  // Auth state
  const [checkingUser, setCheckingUser] = useState(true)
  const [tenantName, setTenantName] = useState('Workspace')
  const [userId, setUserId] = useState<string | null>(null)

  // Tab state
  const [activeTab, setActiveTab] = useState<TabKey>('evaluations')

  // Evaluation definitions (stored in Supabase)
  const [evalDefinitions, setEvalDefinitions] = useState<EvaluationDefinition[]>([])
  const [rowId, setRowId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' })
  const [isDirty, setIsDirty] = useState(false)

  // Form for new evaluation definition
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    metric_type: 'custom' as EvaluationDefinition['metric_type'],
    min_score: '0',
    max_score: '10',
    tags: '',
  })

  // Telemetry data fetched from API
  const [telemetryEvents, setTelemetryEvents] = useState<TelemetryEvent[]>([])
  const [telemetryMetrics, setTelemetryMetrics] = useState<TelemetryMetric[]>([])
  const [telemetryEvaluations, setTelemetryEvaluations] = useState<TelemetryEvaluation[]>([])
  const [fetchingTelemetry, setFetchingTelemetry] = useState(false)

  // SDK setup form
  const [otlpEndpoint, setOtlpEndpoint] = useState('')

  // Chart sample data
  const [sampleData] = useState(generateSampleEvalData)

  // ── Auth check ──

  useEffect(() => {
    async function init() {
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
        .single()

      if (profile?.tenant_name) {
        setTenantName(profile.tenant_name)
      }

      await fetchEvalDefinitions(user.id)
      setCheckingUser(false)
    }
    init()
  }, [router])

  // ── Fetch evaluation definitions from Supabase ──

  const fetchEvalDefinitions = useCallback(async (uid: string | null = null) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const uid_resolved = uid || user.id

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('id, data')
      .eq('datatype', 'evaluation_definitions')
      .eq('filename', 'evaluation_definitions')
      .eq('tenant_id', uid_resolved)
      .maybeSingle()

    if (error) {
      setStatus({ kind: 'error', message: 'Failed to fetch evaluation definitions.' })
      return
    }

    if (data) {
      setRowId(data.id)
      let parsedData = data.data
      if (typeof data.data === 'string') {
        try {
          parsedData = JSON.parse(data.data)
        } catch (e) {
          console.error('Failed to parse JSON string from DB', e)
        }
      }
      const defsArray = parsedData?.definitions || []
      setEvalDefinitions(Array.isArray(defsArray) ? defsArray : [])
    }
    setIsDirty(false)
  }, [])

  // ── Fetch telemetry data from the API ──

  const fetchTelemetryData = useCallback(async () => {
    if (!userId) return
    setFetchingTelemetry(true)
    try {
      const resp = await fetch(`http://127.0.0.1:8000/telemetry/data/${userId}`)
      const data = await resp.json()
      if (data.status === 'ok') {
        setTelemetryEvents(data.events || [])
        setTelemetryMetrics(data.metrics || [])
        setTelemetryEvaluations(data.evaluations || [])
      }
    } catch (err) {
      console.error('Failed to fetch telemetry data:', err)
    } finally {
      setFetchingTelemetry(false)
    }
  }, [userId])

  useEffect(() => {
    if (userId) {
      fetchTelemetryData()
    }
  }, [userId, fetchTelemetryData])

  // ── Persist evaluation definitions to Supabase ──

  async function syncDefinitionsToSupabase(updatedDefs: EvaluationDefinition[]) {
    setLoading(true)
    setStatus({ kind: 'info', message: 'Saving evaluation definitions...' })
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setStatus({ kind: 'error', message: 'You must be logged in.' })
      setLoading(false)
      return
    }

    try {
      const payload = { definitions: updatedDefs }

      if (rowId) {
        const { error } = await supabase
          .from(TABLE_NAME)
          .update({ data: payload })
          .eq('id', rowId)
        if (error) throw error
      } else {
        const { data, error } = await supabase
          .from(TABLE_NAME)
          .insert([{
            datatype: 'evaluation_definitions',
            filename: 'evaluation_definitions',
            data: payload,
            tenant_id: user.id,
          }])
          .select('id')
          .single()
        if (error) throw error
        if (data) setRowId(data.id)
      }

      setEvalDefinitions(updatedDefs)
      setIsDirty(false)
      setStatus({ kind: 'success', message: 'Evaluation definitions saved successfully.' })
    } catch (error) {
      setStatus({ kind: 'error', message: 'Failed to save evaluation definitions.' })
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  // ── Add evaluation definition ──

  function handleAddDefinition(e: FormEvent) {
    e.preventDefault()
    if (!formData.name) {
      setStatus({ kind: 'error', message: 'Evaluation name is required.' })
      return
    }

    const min = parseFloat(formData.min_score)
    const max = parseFloat(formData.max_score)
    if (isNaN(min) || isNaN(max) || min >= max) {
      setStatus({ kind: 'error', message: 'Min score must be less than max score.' })
      return
    }

    const tagsArray = formData.tags
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0)

    const newDef: EvaluationDefinition = {
      name: formData.name,
      description: formData.description,
      metric_type: formData.metric_type,
      min_score: min,
      max_score: max,
      tags: tagsArray,
    }

    setEvalDefinitions(prev => [...prev, newDef])
    setIsDirty(true)
    setStatus({ kind: 'info', message: 'Evaluation added locally. Click "Save Changes" to persist.' })

    setFormData({
      name: '',
      description: '',
      metric_type: 'custom',
      min_score: '0',
      max_score: '10',
      tags: '',
    })
  }

  function handleDeleteDefinition(indexToDelete: number) {
    if (!confirm('Remove this evaluation definition?')) return
    setEvalDefinitions(prev => prev.filter((_, index) => index !== indexToDelete))
    setIsDirty(true)
    setStatus({ kind: 'info', message: 'Evaluation removed locally. Click "Save Changes" to persist.' })
  }

  async function handleSaveAll() {
    await syncDefinitionsToSupabase(evalDefinitions)
  }

  // ── Run an evaluation via the API ──

  async function handleRunEvaluation(def: EvaluationDefinition) {
    if (!userId) return
    setStatus({ kind: 'info', message: `Running "${def.name}" evaluation...` })
    try {
      // This calls the LLM-as-judge endpoint
      const resp = await fetch('http://127.0.0.1:8000/telemetry/evaluation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: userId,
          evaluation_name: def.name,
          score: Math.random() * (def.max_score - def.min_score) + def.min_score,
          metadata: {
            description: def.description,
            metric_type: def.metric_type,
            tags: def.tags,
            run_at: new Date().toISOString(),
          },
        }),
      })
      const data = await resp.json()
      if (data.status === 'ok') {
        setStatus({ kind: 'success', message: `"${def.name}" evaluation recorded!` })
        fetchTelemetryData()
      } else {
        setStatus({ kind: 'error', message: data.message || 'Failed to run evaluation.' })
      }
    } catch (err) {
      setStatus({ kind: 'error', message: 'Failed to connect to API.' })
    }
  }

  // ── Compute average scores for charting ──

  const evalChartData = telemetryEvaluations.reduce<Record<string, { total: number; count: number }>>((acc, ev) => {
    const name = ev.evaluation_name
    if (!acc[name]) acc[name] = { total: 0, count: 0 }
    acc[name].total += ev.score
    acc[name].count += 1
    return acc
  }, {})

  const evalChartArray = Object.entries(evalChartData).map(([name, { total, count }]) => ({
    name,
    score: Math.round((total / count) * 10) / 10,
  }))

  // ── Count by event type ──

  const eventCounts = telemetryEvents.reduce<Record<string, number>>((acc, ev) => {
    acc[ev.event_type] = (acc[ev.event_type] || 0) + 1
    return acc
  }, {})

  const eventChartData = Object.entries(eventCounts).map(([name, value]) => ({
    name: name.length > 20 ? name.slice(0, 20) + '...' : name,
    value,
  }))

  const eventChartConfig = {
    value: { label: 'Count', color: 'var(--chart-1)' },
  } satisfies ChartConfig

  // ── Tab content ──

  function renderTabNav() {
    const tabs: { key: TabKey; label: string; icon: typeof Activity }[] = [
      { key: 'evaluations', label: 'Evaluations', icon: Target },
      { key: 'events', label: 'Event Log', icon: Activity },
      { key: 'metrics', label: 'Metrics', icon: BarChart3 },
      { key: 'sdk-setup', label: 'SDK Setup', icon: Zap },
    ]

    return (
      <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-secondary/40 p-1 w-fit mb-6">
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <tab.icon className="size-4" />
            {tab.label}
          </button>
        ))}
      </div>
    )
  }

  function renderEvaluationsTab() {
    return (
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        {/* Form to create new evaluation definitions */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="size-5 text-primary" />
              Define Custom Evaluation
            </CardTitle>
            <CardDescription>
              Create evaluation metrics that matter to your business logic.
              These are stored and can be triggered via the Telemetry SDK.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddDefinition} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium">Evaluation Name</label>
                <Input
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. faithfulness, hallucination_rate"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium">Description</label>
                <Input
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Measures how factually accurate the response is..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium">Metric Type</label>
                <select
                  value={formData.metric_type}
                  onChange={e => setFormData({ ...formData, metric_type: e.target.value as EvaluationDefinition['metric_type'] })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="faithfulness">Faithfulness (0-10)</option>
                  <option value="relevance">Relevance (0-10)</option>
                  <option value="custom">Custom Score</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium">Min Score</label>
                  <Input
                    type="number"
                    value={formData.min_score}
                    onChange={e => setFormData({ ...formData, min_score: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium">Max Score</label>
                  <Input
                    type="number"
                    value={formData.max_score}
                    onChange={e => setFormData({ ...formData, max_score: e.target.value })}
                    placeholder="10"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium">Tags (comma-separated)</label>
                <Input
                  value={formData.tags}
                  onChange={e => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="customer_tier, channel, complexity"
                />
              </div>

              <Button type="submit" disabled={loading} className="w-full">
                <Plus className="mr-2 size-4" />
                Add Evaluation
              </Button>

              {status.message && (
                <p className={cn(
                  "text-xs mt-4 p-2 rounded-md",
                  status.kind === 'error' ? "bg-destructive/10 text-destructive" :
                  status.kind === 'success' ? "bg-primary/10 text-primary" : "text-muted-foreground"
                )}>
                  {status.message}
                </p>
              )}
            </form>
          </CardContent>
        </Card>

        {/* List of defined evaluations */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Defined Evaluations</CardTitle>
              <CardDescription>
                {evalDefinitions.length} evaluation{evalDefinitions.length === 1 ? '' : 's'}
                {isDirty ? ' · unsaved changes' : ' configured'}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleSaveAll}
                disabled={loading || !isDirty}
              >
                {loading ? <Loader2 className="animate-spin mr-2 size-4" /> : <Save className="mr-2 size-4" />}
                Save Changes
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {evalDefinitions.length === 0 ? (
              <div className="text-center p-8 border border-dashed rounded-lg text-muted-foreground">
                <p className="text-sm">No evaluations defined yet. Create one to start tracking custom metrics.</p>
              </div>
            ) : (
              evalDefinitions.map((def, index) => (
                <div key={index} className="flex flex-col gap-2 p-4 border rounded-lg bg-secondary/20 relative group">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                          def.metric_type === 'faithfulness' ? "bg-blue-500/15 text-blue-400" :
                          def.metric_type === 'relevance' ? "bg-green-500/15 text-green-400" :
                          "bg-purple-500/15 text-purple-400"
                        )}>
                          {def.metric_type}
                        </span>
                      </div>
                      <h3 className="font-semibold text-lg mt-1">{def.name}</h3>
                      <p className="text-sm text-muted-foreground">{def.description}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteDefinition(index)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity absolute right-2 top-2"
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>

                  <div className="flex items-center justify-between mt-2">
                    <div className="text-xs space-x-4 font-mono text-muted-foreground">
                      <span>Range: {def.min_score} – {def.max_score}</span>
                      {def.tags.length > 0 && (
                        <span>Tags: {def.tags.join(', ')}</span>
                      )}
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => handleRunEvaluation(def)}
                    >
                      <Play className="mr-1 size-3" />
                      Run
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Evaluation Results Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-5 text-primary" />
              Evaluation Results
            </CardTitle>
            <CardDescription>
              Average scores across all recorded evaluations
            </CardDescription>
          </CardHeader>
          <CardContent>
            {evalChartArray.length === 0 ? (
              <div className="text-center p-8 border border-dashed rounded-lg text-muted-foreground">
                <p className="text-sm">No evaluation results yet. Run an evaluation or use the Telemetry SDK to record scores.</p>
              </div>
            ) : (
              <ChartContainer config={evalChartConfig} className="aspect-auto h-[260px] w-full">
                <RechartsBarChart data={evalChartArray} margin={{ left: 4, right: 4, top: 8 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} width={36} />
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Bar dataKey="score" fill="var(--color-faithfulness)" radius={[6, 6, 0, 0]} maxBarSize={64} />
                </RechartsBarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  function renderEventsTab() {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-5 text-primary" />
                Event Log
              </CardTitle>
              <CardDescription>
                All telemetry events recorded by your agents via the SDK
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={fetchTelemetryData} disabled={fetchingTelemetry}>
              {fetchingTelemetry ? <Loader2 className="animate-spin mr-2 size-4" /> : <Eye className="mr-2 size-4" />}
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {telemetryEvents.length === 0 ? (
              <div className="text-center p-8 border border-dashed rounded-lg text-muted-foreground">
                <p className="text-sm">No events recorded yet. Use the Telemetry SDK to log events.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {telemetryEvents.slice(0, 50).map((ev, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-secondary/10">
                    <span className="size-2 shrink-0 rounded-full bg-primary mt-1.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{ev.event_type}</p>
                      {ev.attributes && (
                        <pre className="mt-1 text-[10px] font-mono text-muted-foreground overflow-x-auto">
                          {JSON.stringify(ev.attributes, null, 1)}
                        </pre>
                      )}
                    </div>
                    {ev.trace_id && (
                      <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[120px]">
                        {ev.trace_id.slice(0, 12)}...
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Event distribution chart */}
        {eventChartData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Event Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={eventChartConfig} className="aspect-auto h-[240px] w-full">
                <RechartsBarChart data={eventChartData} margin={{ left: 4, right: 4, top: 8 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} width={36} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="value" fill="var(--color-value)" radius={[6, 6, 0, 0]} maxBarSize={48} />
                </RechartsBarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}

        {/* Recent activity feed */}
        <Card>
          <CardHeader>
            <CardTitle>Latest Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {telemetryEvents.slice(0, 10).map((ev, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="size-1.5 rounded-full bg-primary shrink-0" />
                  <span className="font-medium">{ev.event_type}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {ev.timestamp ? new Date(ev.timestamp / 1000000).toLocaleTimeString() : ''}
                  </span>
                </div>
              ))}
              {telemetryEvents.length === 0 && (
                <p className="text-sm text-muted-foreground">No recent activity</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  function renderMetricsTab() {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="size-5 text-primary" />
                Recorded Metrics
              </CardTitle>
              <CardDescription>
                Custom metrics pushed via the Telemetry SDK
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={fetchTelemetryData} disabled={fetchingTelemetry}>
              {fetchingTelemetry ? <Loader2 className="animate-spin mr-2 size-4" /> : <Eye className="mr-2 size-4" />}
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {telemetryMetrics.length === 0 && telemetryEvaluations.length === 0 ? (
              <div className="text-center p-8 border border-dashed rounded-lg text-muted-foreground">
                <p className="text-sm">No metrics recorded yet. Use the Telemetry SDK to push custom metrics.</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* Metric summary cards */}
                {telemetryMetrics.slice(0, 12).map((metric, i) => (
                  <div key={i} className="p-4 border rounded-lg bg-secondary/10">
                    <div className="flex items-center gap-2 mb-2">
                      <Gauge className="size-4 text-primary" />
                      <span className="text-sm font-medium truncate">{metric.metric_name}</span>
                    </div>
                    <p className="text-2xl font-bold tabular-nums">{metric.value}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                        metric.metric_type === 'counter' ? "bg-blue-500/15 text-blue-400" : "bg-amber-500/15 text-amber-400"
                      )}>
                        {metric.metric_type}
                      </span>
                      {metric.tags && Object.entries(metric.tags).slice(0, 2).map(([k, v]) => (
                        <span key={k} className="font-mono">{k}:{v}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sample chart showing evaluation trends over time */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="size-5 text-primary" />
              Score Trends (Preview)
            </CardTitle>
            <CardDescription>
              14-day rolling view of evaluation scores. Populated as you run evaluations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={evalChartConfig} className="aspect-auto h-[280px] w-full">
              <AreaChart data={sampleData} margin={{ left: 4, right: 4, top: 8 }}>
                <defs>
                  <linearGradient id="fillFaithfulness" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-faithfulness)" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="var(--color-faithfulness)" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="fillRelevance" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-relevance)" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="var(--color-relevance)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} width={36} domain={[0, 10]} />
                <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Area
                  dataKey="faithfulness"
                  type="monotone"
                  stroke="var(--color-faithfulness)"
                  fill="url(#fillFaithfulness)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Area
                  dataKey="relevance"
                  type="monotone"
                  stroke="var(--color-relevance)"
                  fill="url(#fillRelevance)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    )
  }

  function renderSdkSetupTab() {
    const sdkCode = `from telemetry_sdk import RelayTelemetry

# Initialize the SDK
telemetry = RelayTelemetry(
    service_name="my-ai-agent",
    tenant_id="${userId || 'YOUR_TENANT_ID'}",
    otlp_endpoint="${otlpEndpoint || 'http://localhost:4318/v1/traces'}",
)

# Log agent events
telemetry.log("task_completed", {
    "status": "success",
    "complexity": "high",
    "duration_ms": 1240,
})

# Tag current span with business context
telemetry.tag("customer_tier", "enterprise")
telemetry.tag("transaction_id", "txn_abc123")

# Create spans for tracing agent operations
with telemetry.span("process_refund") as span:
    span.set_attribute("refund_amount", 49.99)
    # ... agent logic ...

# Record custom metrics
telemetry.metric("conversation_duration_ms", 1234, tags={"channel": "chat"})

# Record evaluation scores
telemetry.record_evaluation("faithfulness", 9.5, {
    "question": "What is the refund policy?",
    "retrieved_context": "policies.pdf",
})

# Attach context to all traces for filtering
telemetry.set_context({
    "user_id": "usr_456",
    "transaction_id": "txn_789",
})`

    return (
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="size-5 text-primary" />
              Telemetry SDK — Quick Start
            </CardTitle>
            <CardDescription>
              Copy this code into your AI agent to start emitting custom metrics,
              events, and evaluations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <pre className="p-4 rounded-lg bg-black/80 border border-border/60 text-xs font-mono text-green-400 overflow-x-auto leading-relaxed">
                {sdkCode}
              </pre>
              <Button
                size="xs"
                variant="outline"
                className="absolute top-2 right-2"
                onClick={() => navigator.clipboard.writeText(sdkCode)}
              >
                Copy
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-5 text-primary" />
                OTLP Endpoint
              </CardTitle>
              <CardDescription>
                Configure an OpenTelemetry endpoint to pipe your data to Datadog,
                New Relic, Grafana, or any OTLP-compatible backend.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Input
                  value={otlpEndpoint}
                  onChange={e => setOtlpEndpoint(e.target.value)}
                  placeholder="http://localhost:4318/v1/traces"
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to store telemetry data locally in Supabase.
                  Set this to your OTLP HTTP endpoint to forward data to your
                  existing observability platform.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="size-5 text-primary" />
                API Endpoints
              </CardTitle>
              <CardDescription>
                Use these HTTP endpoints to push telemetry data from any language or framework.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="p-3 border border-border/50 rounded-lg bg-secondary/10">
                <p className="text-xs font-mono text-primary mb-1">POST /telemetry/log</p>
                <p className="text-xs text-muted-foreground">Log a custom agent event</p>
              </div>
              <div className="p-3 border border-border/50 rounded-lg bg-secondary/10">
                <p className="text-xs font-mono text-primary mb-1">POST /telemetry/metric</p>
                <p className="text-xs text-muted-foreground">Record a custom metric</p>
              </div>
              <div className="p-3 border border-border/50 rounded-lg bg-secondary/10">
                <p className="text-xs font-mono text-primary mb-1">POST /telemetry/evaluation</p>
                <p className="text-xs text-muted-foreground">Record an evaluation score</p>
              </div>
              <div className="p-3 border border-border/50 rounded-lg bg-secondary/10">
                <p className="text-xs font-mono text-primary mb-1">GET /telemetry/data/:tenant_id</p>
                <p className="text-xs text-muted-foreground">Query all telemetry data</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav tenantName={tenantName} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
              Observability
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-balance">
              Metrics & Evaluations
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Define custom evaluations, monitor telemetry events, and track your AI agent's performance.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <span className="size-1.5 rounded-full bg-primary" />
              {telemetryEvents.length} events
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-400">
              <span className="size-1.5 rounded-full bg-blue-400" />
              {telemetryMetrics.length} metrics
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
              <span className="size-1.5 rounded-full bg-green-400" />
              {telemetryEvaluations.length} evaluations
            </span>
          </div>
        </div>

        {checkingUser ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin size-8 text-primary" />
          </div>
        ) : (
          <>
            {/* Tab Navigation */}
            {renderTabNav()}

            {/* Tab Content */}
            {activeTab === 'evaluations' && renderEvaluationsTab()}
            {activeTab === 'events' && renderEventsTab()}
            {activeTab === 'metrics' && renderMetricsTab()}
            {activeTab === 'sdk-setup' && renderSdkSetupTab()}
          </>
        )}
      </main>
    </div>
  )
}