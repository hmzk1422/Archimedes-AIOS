'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  Loader2,
  Save,
  Plus,
  Trash2,
  Shield,
  Gauge,
  MessageSquare,
  Users,
  ChevronDown,
  ChevronUp,
  List,
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type TaskPolicy = {
  name: string
  require_hitl: boolean
  conditions: {
    amount_threshold?: number | null
    requires_sentiment_check?: boolean
    always_require?: boolean
  }
  description: string
}

type HITLSettings = {
  version: string
  global_defaults: {
    response_gating: {
      confidence_threshold: number
      sentiment_escalation: string[]
      auto_approve_safe_responses: boolean
    }
    notifications: {
      channels: string[]
      alert_on_fail: boolean
    }
  }
  task_policies: TaskPolicy[]
}

type Status = { kind: 'idle' | 'success' | 'error' | 'info'; message: string }

// ──────────────────────────────────────────────
// Default Configuration
// ──────────────────────────────────────────────

const DEFAULT_HITL_SETTINGS: HITLSettings = {
  version: '1.0',
  global_defaults: {
    response_gating: {
      confidence_threshold: 0.85,
      sentiment_escalation: ['negative', 'angry'],
      auto_approve_safe_responses: true,
    },
    notifications: {
      channels: ['dashboard'],
      alert_on_fail: true,
    },
  },
  task_policies: [],
}

const NOTIFICATION_CHANNELS = ['dashboard', 'slack', 'email', 'webhook']

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export default function HITLSettings({ tenantId: _tenantId }: { tenantId?: string }) {
  const router = useRouter()
  const [settings, setSettings] = useState<HITLSettings>(() => JSON.parse(JSON.stringify(DEFAULT_HITL_SETTINGS)))
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [isDirty, setIsDirty] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' })

  // Collapsible sections
  const [globalExpanded, setGlobalExpanded] = useState(true)
  const [policiesExpanded, setPoliciesExpanded] = useState(true)

  // Task names from the tasks array (for dropdown)
  const [availableTaskNames, setAvailableTaskNames] = useState<string[]>([])

  // New policy form state
  const [newPolicy, setNewPolicy] = useState<TaskPolicy>({
    name: '',
    require_hitl: true,
    conditions: {
      amount_threshold: null,
      requires_sentiment_check: false,
      always_require: false,
    },
    description: '',
  })

  // Fetch existing HITL config and task names
  const fetchData = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    try {
      // Fetch HITL config
      const configResponse = await fetch(`http://localhost:8000/hitl/config/${user.id}`)
      const configResult = await configResponse.json()

      if (configResult.status === 'ok' && configResult.config) {
        setSettings((prev) => ({
          ...prev,
          ...configResult.config,
          global_defaults: {
            ...prev.global_defaults,
            ...(configResult.config.global_defaults || {}),
            response_gating: {
              ...prev.global_defaults.response_gating,
              ...(configResult.config.global_defaults?.response_gating || {}),
            },
            notifications: {
              ...prev.global_defaults.notifications,
              ...(configResult.config.global_defaults?.notifications || {}),
            },
          },
          task_policies: configResult.config.task_policies || [],
        }))
      }

      // Fetch available task names for dropdown
      const namesResponse = await fetch(`http://localhost:8000/hitl/task-names/${user.id}`)
      const namesResult = await namesResponse.json()
      if (namesResult.status === 'ok' && namesResult.task_names) {
        setAvailableTaskNames(namesResult.task_names)
      }
    } catch (e) {
      console.error('Failed to fetch HITL data:', e)
    }

    setChecking(false)
    setIsDirty(false)
  }, [])

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/auth')
        return
      }
      await fetchData()
    }
    init()
  }, [router, fetchData])

  // ── Global defaults handlers ──

  function updateConfidenceThreshold(value: string) {
    const num = parseFloat(value)
    if (!isNaN(num) && num >= 0 && num <= 1) {
      setSettings((prev) => ({
        ...prev,
        global_defaults: {
          ...prev.global_defaults,
          response_gating: {
            ...prev.global_defaults.response_gating,
            confidence_threshold: num,
          },
        },
      }))
      setIsDirty(true)
    }
  }

  function toggleSentimentEscalation(sentiment: string) {
    setSettings((prev) => {
      const current = prev.global_defaults.response_gating.sentiment_escalation
      const exists = current.includes(sentiment)
      return {
        ...prev,
        global_defaults: {
          ...prev.global_defaults,
          response_gating: {
            ...prev.global_defaults.response_gating,
            sentiment_escalation: exists
              ? current.filter((s) => s !== sentiment)
              : [...current, sentiment],
          },
        },
      }
    })
    setIsDirty(true)
  }

  function toggleAutoApprove(value: boolean) {
    setSettings((prev) => ({
      ...prev,
      global_defaults: {
        ...prev.global_defaults,
        response_gating: {
          ...prev.global_defaults.response_gating,
          auto_approve_safe_responses: value,
        },
      },
    }))
    setIsDirty(true)
  }

  function toggleNotificationChannel(channel: string) {
    setSettings((prev) => {
      const current = prev.global_defaults.notifications.channels
      const exists = current.includes(channel)
      return {
        ...prev,
        global_defaults: {
          ...prev.global_defaults,
          notifications: {
            ...prev.global_defaults.notifications,
            channels: exists
              ? current.filter((c) => c !== channel)
              : [...current, channel],
          },
        },
      }
    })
    setIsDirty(true)
  }

  function toggleAlertOnFail(value: boolean) {
    setSettings((prev) => ({
      ...prev,
      global_defaults: {
        ...prev.global_defaults,
        notifications: {
          ...prev.global_defaults.notifications,
          alert_on_fail: value,
        },
      },
    }))
    setIsDirty(true)
  }

  // ── Task policy handlers ──

  function addPolicy() {
    if (!newPolicy.name.trim()) {
      setStatus({ kind: 'error', message: 'Task name is required.' })
      return
    }

    // Check for duplicates
    if (settings.task_policies.some((p) => p.name === newPolicy.name.trim())) {
      setStatus({ kind: 'error', message: `A policy for "${newPolicy.name}" already exists.` })
      return
    }

    setSettings((prev) => ({
      ...prev,
      task_policies: [
        ...prev.task_policies,
        {
          ...newPolicy,
          name: newPolicy.name.trim(),
          conditions: {
            ...newPolicy.conditions,
            amount_threshold: newPolicy.conditions.amount_threshold || null,
          },
        },
      ],
    }))

    setNewPolicy({
      name: '',
      require_hitl: true,
      conditions: {
        amount_threshold: null,
        requires_sentiment_check: false,
        always_require: false,
      },
      description: '',
    })

    setIsDirty(true)
    setStatus({ kind: 'info', message: 'Policy added locally. Click "Save HITL Settings" to persist.' })
  }

  function removePolicy(index: number) {
    setSettings((prev) => ({
      ...prev,
      task_policies: prev.task_policies.filter((_, i) => i !== index),
    }))
    setIsDirty(true)
  }

  function updatePolicy(index: number, updates: Partial<TaskPolicy>) {
    setSettings((prev) => {
      const policies = [...prev.task_policies]
      policies[index] = { ...policies[index], ...updates }
      return { ...prev, task_policies: policies }
    })
    setIsDirty(true)
  }

  function updatePolicyCondition(index: number, condition: string, value: any) {
    setSettings((prev) => {
      const policies = [...prev.task_policies]
      policies[index] = {
        ...policies[index],
        conditions: {
          ...policies[index].conditions,
          [condition]: value,
        },
      }
      return { ...prev, task_policies: policies }
    })
    setIsDirty(true)
  }

  // ── Save ──

  async function handleSave() {
    setLoading(true)
    setStatus({ kind: 'info', message: 'Saving HITL settings...' })

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setStatus({ kind: 'error', message: 'You must be logged in.' })
      setLoading(false)
      return
    }

    try {
      const response = await fetch('http://localhost:8000/hitl/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: user.id,
          settings,
        }),
      })

      const result = await response.json()
      if (result.status === 'ok') {
        setIsDirty(false)
        setStatus({ kind: 'success', message: 'HITL settings saved successfully.' })
      } else {
        setStatus({ kind: 'error', message: result.message || 'Failed to save.' })
      }
    } catch (e) {
      setStatus({ kind: 'error', message: 'Failed to connect to server.' })
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // ── Render ──

  if (checking) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" /> Loading HITL configuration...
      </div>
    )
  }

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Governance</p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="size-6 text-primary" />
            Human-In-The-Loop
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Configure when the AI should pause and ask for human approval before executing sensitive actions.
            Policies are linked to task names — the same names you define in the Task Mappings above.
          </p>
        </div>
        <Button onClick={handleSave} disabled={loading || !isDirty}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          <span>Save HITL Settings</span>
        </Button>
      </div>

      {status.message && (
        <div
          className={cn(
            'rounded-lg border p-3 text-sm flex items-center gap-2',
            status.kind === 'success' && 'border-primary/20 bg-primary/10 text-primary',
            status.kind === 'error' && 'border-destructive/20 bg-destructive/10 text-destructive',
            status.kind === 'info' && 'border-border bg-muted text-muted-foreground'
          )}
        >
          <AlertCircle className="size-4" />
          <p>{status.message}</p>
        </div>
      )}

      {/* ── Global Defaults ── */}
      <Card>
        <CardHeader
          className="flex flex-row items-center justify-between space-y-0 pb-4 cursor-pointer select-none"
          onClick={() => setGlobalExpanded(!globalExpanded)}
        >
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Gauge className="size-5" />
              Global Defaults
              {globalExpanded ? <ChevronUp className="size-4 text-muted-foreground ml-1" /> : <ChevronDown className="size-4 text-muted-foreground ml-1" />}
            </CardTitle>
            <CardDescription>
              Apply across all tasks. Individual task policies can override these.
            </CardDescription>
          </div>
        </CardHeader>

        {globalExpanded && (
          <CardContent className="space-y-6">
            {/* Confidence Threshold */}
            <div className="rounded-lg border bg-card p-4">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <Gauge className="size-4 text-primary" />
                Response-Based Gating
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Confidence Threshold
                  </label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={settings.global_defaults.response_gating.confidence_threshold}
                      onChange={(e) => updateConfidenceThreshold(e.target.value)}
                      className="w-24"
                    />
                    <span className="text-xs text-muted-foreground">
                      (0.0 – 1.0)
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    If AI confidence is below this value, the response is shown as a draft to a human.
                  </p>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Auto-Approve Safe Responses
                  </label>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={settings.global_defaults.response_gating.auto_approve_safe_responses}
                      onCheckedChange={toggleAutoApprove}
                    />
                    <span className="text-sm">
                      {settings.global_defaults.response_gating.auto_approve_safe_responses
                        ? 'Safe tasks execute without human review'
                        : 'All tasks require human review'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sentiment Escalation */}
            <div className="rounded-lg border bg-card p-4">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <MessageSquare className="size-4 text-primary" />
                Context-Based Escalation (Sentiment)
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Select which customer sentiments should trigger human escalation.
              </p>
              <div className="flex flex-wrap gap-2">
                {['negative', 'angry', 'frustrated', 'abusive', 'sad'].map((sentiment) => {
                  const isActive = settings.global_defaults.response_gating.sentiment_escalation.includes(sentiment)
                  return (
                    <button
                      key={sentiment}
                      onClick={() => toggleSentimentEscalation(sentiment)}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                        isActive
                          ? 'bg-destructive/10 border-destructive/30 text-destructive'
                          : 'bg-secondary/50 border-border text-muted-foreground hover:bg-secondary'
                      )}
                    >
                      {sentiment}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Notification Channels */}
            <div className="rounded-lg border bg-card p-4">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <Users className="size-4 text-primary" />
                Notification Channels
              </h3>
              <div className="flex flex-wrap gap-2 mb-3">
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const isActive = settings.global_defaults.notifications.channels.includes(channel)
                  return (
                    <button
                      key={channel}
                      onClick={() => toggleNotificationChannel(channel)}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors capitalize',
                        isActive
                          ? 'bg-primary/10 border-primary/30 text-primary'
                          : 'bg-secondary/50 border-border text-muted-foreground hover:bg-secondary'
                      )}
                    >
                      {channel}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={settings.global_defaults.notifications.alert_on_fail}
                  onCheckedChange={toggleAlertOnFail}
                />
                <span className="text-sm">Alert on HITL failure</span>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── Task Policies ── */}
      <Card>
        <CardHeader
          className="flex flex-row items-center justify-between space-y-0 pb-4 cursor-pointer select-none"
          onClick={() => setPoliciesExpanded(!policiesExpanded)}
        >
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Shield className="size-5" />
              Task-Specific Policies
              {policiesExpanded ? <ChevronUp className="size-4 text-muted-foreground ml-1" /> : <ChevronDown className="size-4 text-muted-foreground ml-1" />}
            </CardTitle>
            <CardDescription>
              Override global settings for specific task names. The "name" must match the task
              name from the Task Mappings above.
            </CardDescription>
          </div>
          <span className="text-xs text-muted-foreground">
            {settings.task_policies.length} polic{settings.task_policies.length === 1 ? 'y' : 'ies'}
          </span>
        </CardHeader>

        {policiesExpanded && (
          <CardContent className="space-y-4">
            {/* Add new policy form */}
            <div className="rounded-lg border border-dashed bg-secondary/20 p-4 space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Plus className="size-4" />
                Add Task Policy
              </h4>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Task Name
                    {availableTaskNames.length > 0 && (
                      <span className="ml-1 text-[10px] text-primary">(select or type)</span>
                    )}
                  </label>
                  <div className="relative">
                    <select
                      value={newPolicy.name}
                      onChange={(e) => {
                        const val = e.target.value
                        setNewPolicy({ ...newPolicy, name: val })
                        // Auto-fill description if we can find a matching task
                        if (val) {
                          // The description can be set manually, no auto-fill from here
                        }
                      }}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">-- Select a task --</option>
                      {availableTaskNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                      {availableTaskNames.length === 0 && (
                        <option value="" disabled>
                          No tasks found — add tasks in the section above first
                        </option>
                      )}
                    </select>
                    {availableTaskNames.length > 0 && (
                      <List className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Must match the "name" field in your task mapping above
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Description</label>
                  <Input
                    value={newPolicy.description}
                    onChange={(e) => setNewPolicy({ ...newPolicy, description: e.target.value })}
                    placeholder="High-risk financial action"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Amount Threshold ($)</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newPolicy.conditions.amount_threshold ?? ''}
                    onChange={(e) =>
                      setNewPolicy({
                        ...newPolicy,
                        conditions: {
                          ...newPolicy.conditions,
                          amount_threshold: e.target.value ? parseFloat(e.target.value) : null,
                        },
                      })
                    }
                    placeholder="50.00"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 mt-2">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={newPolicy.conditions.always_require}
                    onCheckedChange={(v) =>
                      setNewPolicy({
                        ...newPolicy,
                        conditions: { ...newPolicy.conditions, always_require: v },
                      })
                    }
                  />
                  Always require human
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={newPolicy.conditions.requires_sentiment_check}
                    onCheckedChange={(v) =>
                      setNewPolicy({
                        ...newPolicy,
                        conditions: { ...newPolicy.conditions, requires_sentiment_check: v },
                      })
                    }
                  />
                  Check sentiment
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={newPolicy.require_hitl}
                    onCheckedChange={(v) => setNewPolicy({ ...newPolicy, require_hitl: v })}
                  />
                  Require HITL
                </label>
              </div>
              <Button size="sm" onClick={addPolicy} className="mt-2">
                <Plus className="mr-1 size-4" /> Add Policy
              </Button>
            </div>

            {/* Existing policies list */}
            {settings.task_policies.length === 0 ? (
              <div className="text-center p-8 border border-dashed rounded-lg text-muted-foreground">
                <p className="text-sm">No task policies defined. Add one above to override global defaults.</p>
              </div>
            ) : (
              settings.task_policies.map((policy, index) => (
                <div
                  key={index}
                  className="flex flex-col gap-3 p-4 border rounded-lg bg-secondary/20 relative group"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-bold text-primary uppercase">{policy.name}</code>
                        {policy.conditions.always_require && (
                          <span className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full font-medium">
                            ALWAYS HITL
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{policy.description}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removePolicy(index)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <label className="flex items-center gap-2">
                      <Switch
                        checked={policy.require_hitl}
                        onCheckedChange={(v) => updatePolicy(index, { require_hitl: v })}
                      />
                      Require HITL
                    </label>
                    <label className="flex items-center gap-2">
                      <Switch
                        checked={policy.conditions.always_require || false}
                        onCheckedChange={(v) => updatePolicyCondition(index, 'always_require', v)}
                      />
                      Always require
                    </label>
                    <label className="flex items-center gap-2">
                      <Switch
                        checked={policy.conditions.requires_sentiment_check || false}
                        onCheckedChange={(v) => updatePolicyCondition(index, 'requires_sentiment_check', v)}
                      />
                      Sentiment check
                    </label>
                    {!policy.conditions.always_require && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{'Amount >'}</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          className="w-20 h-7 text-xs"
                          value={policy.conditions.amount_threshold ?? ''}
                          onChange={(e) =>
                            updatePolicyCondition(
                              index,
                              'amount_threshold',
                              e.target.value ? parseFloat(e.target.value) : null
                            )
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        )}
      </Card>

      {/* Config Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Configuration Preview</CardTitle>
          <CardDescription>This JSON will be saved to the database.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="text-xs font-mono bg-background border border-border/50 rounded-lg p-4 overflow-x-auto max-h-60">
            {JSON.stringify(settings, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </section>
  )
}