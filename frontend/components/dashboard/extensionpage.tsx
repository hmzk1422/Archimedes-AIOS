'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Save, Loader2, Settings, AlertCircle } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { DashboardNav } from '@/components/dashboard/dashboard-nav'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

// Types
type AgentTask = {
  name: string
  datatype: string
  description: string
  endpoint: string
  method: string
  required_args: string[]
}

type Extension = {
  name: string
  version: string
  enabled: boolean
  args: string
}

type Status = { kind: 'idle' | 'success' | 'error' | 'info'; message: string }

const TABLE_NAME = 'customer-service-provider'

export default function ExtensionPage() {
  const router = useRouter()
  
  // State
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [extensions, setExtensions] = useState<Extension[]>([])
  const [rowId, setRowId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' })

  // Fetch data
  const fetchData = useCallback(async () => {
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

    if (data) {
      setRowId(data.id)
      const parsed = typeof data.data === 'string' ? JSON.parse(data.data) : data.data
      setTasks(Array.isArray(parsed?.tasks) ? parsed.tasks : [])
      setExtensions(Array.isArray(parsed?.extensions) ? parsed.extensions : [])
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Save changes
  async function handleSave() {
    setLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    try {
      const payload = { tasks, extensions }
      if (rowId) {
        await supabase.from(TABLE_NAME).update({ data: payload }).eq('id', rowId)
      } else {
        await supabase.from(TABLE_NAME).insert([{ 
            datatype: 'tasks', 
            filename: 'tasks', 
            data: payload, 
            tenant_id: user?.id 
        }])
      }
      setIsDirty(false)
      setStatus({ kind: 'success', message: 'Configuration saved successfully.' })
    } catch (err) {
      setStatus({ kind: 'error', message: 'Failed to save configuration.' })
    } finally {
      setLoading(false)
    }
  }

  const updateExtension = (index: number, field: keyof Extension, value: any) => {
    const newExts = [...extensions]
    newExts[index] = { ...newExts[index], [field]: value }
    setExtensions(newExts)
    setIsDirty(true)
  }

  return (
    <div className="min-h-screen bg-background">  
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Agent Extensions</h1>
            <p className="text-muted-foreground">Toggle and configure your active agents.</p>
          </div>
          <Button onClick={handleSave} disabled={loading || !isDirty}>
            {loading ? <Loader2 className="animate-spin size-4" /> : <Save className="size-4" />}
            <span className="ml-2">Save Changes</span>
          </Button>
        </div>

        {status.message && (
          <div className={cn("mb-6 p-4 rounded-lg border flex items-center gap-2", 
            status.kind === 'success' ? "bg-green-50 text-green-800 border-green-200" : "bg-red-50 text-red-800 border-red-200")}>
            <AlertCircle className="size-4" />
            <p className="text-sm">{status.message}</p>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="size-5" /> Enabled Extensions
            </CardTitle>
            <CardDescription>Manage your extension list and provide required arguments.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {extensions.map((ext, i) => (
              <div key={i} className="p-4 border rounded-xl bg-card shadow-sm space-y-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <Switch 
                      checked={ext.enabled} 
                      onCheckedChange={(val) => updateExtension(i, 'enabled', val)} 
                    />
                    <div>
                      <p className="font-semibold">{ext.name}</p>
                      <p className="text-xs text-muted-foreground">Version {ext.version}</p>
                    </div>
                  </div>
                </div>
                
                {ext.enabled && (
                  <div className="pl-12 pt-2 animate-in slide-in-from-top-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Configuration Arguments
                    </label>
                    <Input 
                      className="mt-1"
                      placeholder="e.g. timeout=30, mode=fast" 
                      value={ext.args} 
                      onChange={(e) => updateExtension(i, 'args', e.target.value)} 
                    />
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}