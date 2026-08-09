'use client'

import { useState, useEffect, useCallback, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2, Trash2, Save, FileJson, Shield, Puzzle, ListTodo, Workflow } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { DashboardNav } from '@/components/dashboard/dashboard-nav'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import ExtensionPage from '@/components/dashboard/extensionpage'
import { PageBackground } from '@/components/page-background'

// 1. Define the exact structure based on your 6 parameters
type AgentTask = {
  name: string
  datatype: string
  description: string
  endpoint: string
  method: string
  required_args: string[]
}

type Status = { kind: 'idle' | 'success' | 'error' | 'info'; message: string }

// IMPORTANT: Replace this with the actual name of your Supabase table
const TABLE_NAME = 'customer-service-provider'

export default function TasksPage() {
  const router = useRouter()

  // State
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [checkingUser, setCheckingUser] = useState(true)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' })
  const [rowId, setRowId] = useState<string | null>(null) // Track the DB row ID if it exists
  const [tenantName, setTenantName] = useState<string>('Workspace') // Track tenant name for nav
  const [isDirty, setIsDirty] = useState(false) // Unsaved local edits not yet written to Supabase
  const [activeSection, setActiveSection] = useState<'tasks' | 'workflow'>('tasks')

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    datatype: '',
    description: '',
    endpoint: '',
    method: 'GET',
    required_args: '' // We will split this by comma before saving
  })

  // 2. Fetch the single JSON array from the specific row.
  // If a row already exists for this tenant, rowId gets set here, which is
  // what makes syncTasksToSupabase() below take the UPDATE path instead of
  // INSERT. The fetched tasks are loaded straight into the viewer, so any
  // previously saved configuration is visible immediately.
  const fetchTasksData = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('id, data')
      .eq('datatype', 'tasks')
      .eq('filename', 'tasks')
      .eq('tenant_id', user.id)
      .maybeSingle()

    if (error) {
      setStatus({ kind: 'error', message: 'Failed to fetch task configuration.' })
      return
    }

    if (data) {
    setRowId(data.id)
    
    // ADD THIS PARSING LOGIC:
    let parsedData = data.data;
    if (typeof data.data === 'string') {
        try {
        parsedData = JSON.parse(data.data);
        } catch (e) {
        console.error("Failed to parse JSON string from DB", e);
        }
    }

    const tasksArray = parsedData?.tasks || []
    setTasks(Array.isArray(tasksArray) ? tasksArray : [])
    }
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

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_name')
        .eq('id', user.id)
        .single()

      if (profile?.tenant_name) {
        setTenantName(profile.tenant_name)
      }

      await fetchTasksData()
      setCheckingUser(false)
    }
    init()
  }, [router, fetchTasksData])

  // 3. Persist the CURRENT in-memory tasks array to the database in its
  // entirety. rowId is only set when a row already exists for this tenant,
  // so this naturally inserts the first time and updates every time after
  // - no separate "create vs modify" branch needed elsewhere.
  async function syncTasksToSupabase(updatedTasks: AgentTask[]) {
    setLoading(true)
    setStatus({ kind: 'info', message: 'Saving changes...' })
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setStatus({ kind: 'error', message: 'You must be logged in.' })
      setLoading(false)
      return
    }

    try {
      if (rowId) {
        // IMPORTANT: Fetch existing data first to preserve HITL settings
        // that are stored in the same row alongside task definitions.
        const { data: existingRow } = await supabase
          .from(TABLE_NAME)
          .select('data')
          .eq('id', rowId)
          .single()

        let mergedData: Record<string, unknown> = { tasks: updatedTasks }
        if (existingRow?.data) {
          let raw = existingRow.data
          if (typeof raw === 'string') {
            try { raw = JSON.parse(raw) } catch {}
          }
          if (typeof raw === 'object' && raw !== null) {
            // Preserve HITL settings that were saved separately
            const existing = raw as Record<string, unknown>
            if (existing.settings) {
              mergedData.settings = existing.settings
            }
          }
        }

        const { error } = await supabase
          .from(TABLE_NAME)
          .update({ data: mergedData })
          .eq('id', rowId)
        if (error) throw error
      } else {
        const { data, error } = await supabase
          .from(TABLE_NAME)
          .insert([{
            datatype: 'tasks',
            filename: 'tasks',
            data: { tasks: updatedTasks },
            tenant_id: user.id
          }])
          .select('id')
          .single()

        if (error) throw error
        if (data) setRowId(data.id)
      }

      setTasks(updatedTasks)
      setIsDirty(false)
      setStatus({ kind: 'success', message: 'Configuration saved successfully.' })
    } catch (error) {
      setStatus({ kind: 'error', message: 'Failed to save configuration.' })
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  // 4. Add a task to the LOCAL array only - no Supabase call. It just stages
  // the task in the viewer. Nothing is written to the database until "Save
  // Changes" is clicked, which persists the whole array at once.
  function handleAddTask(e: FormEvent) {
    e.preventDefault()
    if (!formData.name || !formData.endpoint) {
      setStatus({ kind: 'error', message: 'Name and Endpoint are required.' })
      return
    }

    const argsArray = formData.required_args
      .split(',')
      .map(arg => arg.trim())
      .filter(arg => arg.length > 0)

    const newTask: AgentTask = {
      name: formData.name,
      datatype: formData.datatype,
      description: formData.description,
      endpoint: formData.endpoint,
      method: formData.method,
      required_args: argsArray
    }

    setTasks(prev => [...prev, newTask])
    setIsDirty(true)
    setStatus({ kind: 'info', message: 'Task added locally. Click "Save Changes" to write it to the database.' })

    // Reset form
    setFormData({
      name: '',
      datatype: '',
      description: '',
      endpoint: '',
      method: 'GET',
      required_args: ''
    })
  }

  // 5. Remove a task from the LOCAL array only - same reasoning as above.
  function handleDeleteTask(indexToDelete: number) {
    if (!confirm('Remove this task configuration?')) return
    setTasks(prev => prev.filter((_, index) => index !== indexToDelete))
    setIsDirty(true)
    setStatus({ kind: 'info', message: 'Task removed locally. Click "Save Changes" to write it to the database.' })
  }

  // 6. Explicit save - writes the entire current tasks array to Supabase
  // in one shot (insert if this tenant has no row yet, update otherwise).
  async function handleSaveAll() {
    await syncTasksToSupabase(tasks)
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background">
      <PageBackground />
      <DashboardNav tenantName={tenantName} />
      <main className="flex min-h-0 flex-1 overflow-hidden">

        {/* Sidebar — switch between Agent Tasks and Agentic Workflow */}
        <aside className="flex w-52 shrink-0 flex-col border-r border-border/60 bg-card/60 backdrop-blur-md">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <Puzzle className="size-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Actions</span>
          </div>
          <nav className="flex flex-1 flex-col gap-1 p-2">
            {([
              { key: 'tasks' as const, label: 'Agent Tasks', icon: ListTodo },
              { key: 'workflow' as const, label: 'Agentic Workflow', icon: Workflow },
            ]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveSection(key)}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  activeSection === key
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </nav>
          <div className="border-t border-border/60 px-4 py-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Tip</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/80">
              Select a node and press Ctrl+C then Ctrl+V to duplicate it — just like Activepieces.
            </p>
          </div>
        </aside>

        {/* Content */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {checkingUser ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="animate-spin size-8 text-primary" />
            </div>
          ) : activeSection === 'workflow' ? (
            <div className="h-full overflow-hidden p-6">
              <ExtensionPage fullScreen />
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <div className="mx-auto max-w-5xl px-6 py-8">
                <div className="mb-8">
                  <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Configuration</p>
                  <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">Agent Tasks Map</h1>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    Manage the JSON API definitions stored in the database.
                  </p>
                </div>

                <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">

            {/* Form to stage a new task locally */}
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Add New Task</CardTitle>
                <CardDescription>Stage a new API mapping object. Nothing is saved until you click Save Changes.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleAddTask} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium">Name</label>
                    <Input
                      value={formData.name}
                      onChange={e => setFormData({...formData, name: e.target.value})}
                      placeholder="e.g. get_claim_status"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium">Datatype</label>
                    <Input
                      value={formData.datatype}
                      onChange={e => setFormData({...formData, datatype: e.target.value})}
                      placeholder="e.g. ADMINISTRATION"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium">Description</label>
                    <Input
                      value={formData.description}
                      onChange={e => setFormData({...formData, description: e.target.value})}
                      placeholder="Fetches the real-time status..."
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium">Endpoint URL</label>
                    <Input
                      value={formData.endpoint}
                      onChange={e => setFormData({...formData, endpoint: e.target.value})}
                      placeholder="http://127.0.0.1:8001/api/..."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Method</label>
                      <select
                        value={formData.method}
                        onChange={e => setFormData({...formData, method: e.target.value})}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Required Args</label>
                      <Input
                        value={formData.required_args}
                        onChange={e => setFormData({...formData, required_args: e.target.value})}
                        placeholder="claim_id, user_id"
                      />
                    </div>
                  </div>

                  <Button type="submit" disabled={loading} className="w-full mt-4">
                    <Plus className="mr-2 size-4" />
                    Add Task
                  </Button>

                  {status.message && (
                    <p className={cn("text-xs mt-4 p-2 rounded-md",
                      status.kind === 'error' ? "bg-destructive/10 text-destructive" :
                      status.kind === 'success' ? "bg-primary/10 text-primary" : "text-muted-foreground"
                    )}>
                      {status.message}
                    </p>
                  )}
                </form>
              </CardContent>
            </Card>

            {/* Displaying the JSON Array */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Current Configuration</CardTitle>
                  <CardDescription>
                    {tasks.length} task{tasks.length === 1 ? '' : 's'}{isDirty ? ' · unsaved changes' : ' mapped in the database.'}
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
                  <FileJson className="size-5 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {tasks.length === 0 ? (
                  <div className="text-center p-8 border border-dashed rounded-lg text-muted-foreground">
                    <p className="text-sm">No tasks found. Add one and click Save Changes to initialize the JSON array.</p>
                  </div>
                ) : (
                  tasks.map((task, index) => (
                    <div key={index} className="flex flex-col gap-2 p-4 border rounded-lg bg-secondary/20 relative group">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-xs font-bold text-primary uppercase tracking-wider">{task.method}</span>
                          <h3 className="font-semibold text-lg">{task.name}</h3>
                          <p className="text-sm text-muted-foreground">{task.description}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteTask(index)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity absolute right-2 top-2"
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>

                      <div className="mt-2 text-xs space-y-1 font-mono bg-background p-2 rounded-md border border-border/50 break-all">
                        <p><span className="text-muted-foreground">Datatype:</span> {task.datatype}</p>
                        <p><span className="text-muted-foreground">Endpoint:</span> {task.endpoint}</p>
                        <p><span className="text-muted-foreground">Args:</span> {task.required_args.length > 0 ? task.required_args.join(', ') : 'None'}</p>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
