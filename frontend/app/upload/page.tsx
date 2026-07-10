'use client'

import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  UploadCloud,
  FileText,
  X,
  Plus,
  Check,
  RefreshCw,
  Info,
  Loader2,
  FolderTree,
} from 'lucide-react'

// Supabase
import { createClient } from '@/utils/supabase/client'

// Components
import { DashboardNav } from '@/components/dashboard/dashboard-nav'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Status = { kind: 'idle' | 'success' | 'error' | 'info'; message: string }

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function UploadPage() {
  const router = useRouter()
  
  // Auth & Profile State
  const [userId, setUserId] = useState<string | null>(null)
  const [tenantName, setTenantName] = useState<string>('there')
  const [checkingUser, setCheckingUser] = useState(true)

  // Upload & UI State
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [datatypes, setDatatypes] = useState<string[]>(['policies', 'administration'])
  const [datatype, setDatatype] = useState('policies')
  const [newDatatype, setNewDatatype] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' })
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch true datatypes (folders) from Supabase Storage
  const refreshDatatypes = useCallback(async (uid: string, silent = false) => {
    if (!silent) setStatus({ kind: 'info', message: 'Refreshing datatypes from storage…' })
    
    try {
      const supabase = createClient()
      const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'customer-service-provider'
      
      const { data, error } = await supabase.storage.from(bucket).list(uid, {
        limit: 100,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' },
      })

      if (error) throw error

      if (data) {
        // Folders in Supabase Storage typically return without an ID
        const fetchedFolders = data
          .filter((item) => !item.id || item.id === null)
          .map((item) => item.name)

        if (fetchedFolders.length > 0) {
          setDatatypes(fetchedFolders)
          if (!fetchedFolders.includes(datatype)) {
            setDatatype(fetchedFolders[0])
          }
          if (!silent) setStatus({ kind: 'success', message: 'Datatypes synced with storage.' })
        } else if (!silent) {
          setStatus({ kind: 'info', message: 'No existing datatypes found in storage.' })
        }
      }
    } catch (error) {
      if (!silent) {
        setStatus({ kind: 'error', message: 'Failed to fetch datatypes from storage.' })
      }
    }
  }, [datatype])

  // Load user & tenant context on mount
  useEffect(() => {
    async function loadUser() {
      const supabase = createClient()
      const { data: { user }, error } = await supabase.auth.getUser()

      if (error || !user) {
        router.replace('/auth')
        return
      }

      setUserId(user.id)

      // 1. Fetch exact tenant_name matching the dashboard requirements
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_name')
        .eq('id', user.id)
        .single()
      
      if (profile?.tenant_name) {
        setTenantName(profile.tenant_name)
      }

      // 2. Reflect what's truly inside the supabase storage on load
      await refreshDatatypes(user.id, true)

      setCheckingUser(false)
    }

    loadUser()
  }, [router, refreshDatatypes])

  const pickFile = useCallback((f: File | null) => {
    if (!f) return
    if (f.type !== 'application/pdf') {
      setStatus({ kind: 'error', message: 'Only PDF files are supported right now.' })
      return
    }
    setFile(f)
    setStatus({ kind: 'idle', message: '' })
  }, [])

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    pickFile(e.dataTransfer.files?.[0] ?? null)
  }

  function addDatatype() {
    const normalized = newDatatype.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (!normalized) return
    if (!datatypes.includes(normalized)) setDatatypes((prev) => [...prev, normalized])
    setDatatype(normalized)
    setNewDatatype('')
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault()
    if (!file) {
      setStatus({ kind: 'error', message: 'Please choose a PDF file first.' })
      return
    }
    if (!datatype) {
      setStatus({ kind: 'error', message: 'Please select or add a datatype.' })
      return
    }
    setLoading(true)
    setStatus({ kind: 'info', message: 'Uploading to storage…' })

    try {
      const supabase = createClient()
      const { data: { user }, error: userError } = await supabase.auth.getUser()

      if (userError || !user) {
        setStatus({ kind: 'error', message: 'Please sign in before uploading.' })
        setLoading(false)
        return
      }

      const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'customer-service-provider'
      // Scoped exactly as original code requested: tenant/datatype/file.pdf
      const storagePath = `${user.id}/${datatype}/${file.name}`

      const { error } = await supabase.storage.from(bucket).upload(storagePath, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type || 'application/pdf',
      })

      if (error) throw error

      setStatus({ kind: 'success', message: `Upload complete. Stored at ${bucket}/${storagePath}` })
      setFile(null)
      
      // Refresh datatypes in case this is a brand new folder created
      await refreshDatatypes(user.id, true)
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Upload failed' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Dynamic Nav mimicking the Dashboard */}
      <DashboardNav tenantName={tenantName} />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Knowledge Base</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-balance">Upload knowledge</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Drop in documents and the agent ingests them automatically — no formatting or schema required. Files are
            organized by datatype so answers stay grounded in the right context.
          </p>
        </div>

        {checkingUser ? (
          <div className="mt-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Authenticating session...</p>
          </div>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardContent className="pt-6">
                <form onSubmit={handleUpload} className="space-y-6">
                  {/* Dropzone */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => inputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDragging(true)
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    className={cn(
                      'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors',
                      dragging
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-secondary/30 hover:border-primary/60 hover:bg-secondary/50',
                    )}
                  >
                    <span className="flex size-12 items-center justify-center rounded-full bg-primary/12 text-primary">
                      <UploadCloud className="size-6" />
                    </span>
                    <p className="mt-4 text-sm font-medium text-foreground">
                      Drag &amp; drop a PDF here, or <span className="text-primary">browse</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">PDF up to 50 MB</p>
                    <input
                      ref={inputRef}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                    />
                  </div>

                  {/* Selected file */}
                  {file && (
                    <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 p-3">
                      <span className="flex size-10 items-center justify-center rounded-lg bg-primary/12 text-primary">
                        <FileText className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFile(null)}
                        className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        aria-label="Remove file"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  )}

                  {/* Datatype selection */}
                  <div>
                    <label className="text-sm font-medium text-foreground">Datatype</label>
                    <p className="text-xs text-muted-foreground">Choose the folder this document belongs to.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {datatypes.map((dt) => {
                        const active = dt === datatype
                        return (
                          <button
                            key={dt}
                            type="button"
                            onClick={() => setDatatype(dt)}
                            className={cn(
                              'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                              active
                                ? 'border-primary bg-primary/12 text-primary'
                                : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground',
                            )}
                          >
                            {active && <Check className="size-3" />}
                            {dt}
                          </button>
                        )
                      })}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        value={newDatatype}
                        onChange={(e) => setNewDatatype(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault()
                            addDatatype()
                          }
                        }}
                        placeholder="Add a new datatype…"
                        className="h-9 flex-1 rounded-lg border border-input bg-card px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                      />
                      <Button type="button" variant="outline" size="lg" onClick={addDatatype}>
                        <Plus className="size-4" />
                        Add
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button
                      type="submit"
                      size="lg"
                      disabled={loading || !file || !userId}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {loading ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
                      {loading ? 'Uploading…' : 'Upload PDF'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="lg"
                      onClick={() => userId && refreshDatatypes(userId)}
                    >
                      <RefreshCw className="size-4" />
                      Refresh from storage
                    </Button>
                  </div>

                  {status.message && (
                    <div
                      className={cn(
                        'flex items-start gap-2 rounded-lg border p-3 text-sm',
                        status.kind === 'success' && 'border-primary/30 bg-primary/10 text-foreground',
                        status.kind === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
                        status.kind === 'info' && 'border-border bg-secondary/40 text-muted-foreground',
                      )}
                    >
                      {status.kind === 'success' ? (
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      ) : (
                        <Info className="mt-0.5 size-4 shrink-0" />
                      )}
                      <span className="break-all">{status.message}</span>
                    </div>
                  )}
                </form>
              </CardContent>
            </Card>

            {/* Sidebar */}
            <div className="space-y-6">
              <Card>
                <CardHeader className="flex-row items-center gap-2 space-y-0">
                  <FolderTree className="size-4 text-primary" />
                  <CardTitle>Your datatypes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {datatypes.length === 0 && (
                    <p className="text-xs text-muted-foreground">No folders found in storage.</p>
                  )}
                  {datatypes.map((dt) => (
                    <div
                      key={dt}
                      className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-3 py-2"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <FolderTree className="size-4 text-muted-foreground" />
                        {dt}
                      </span>
                      {dt === datatype && (
                        <span className="rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-primary">
                          selected
                        </span>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-primary/20 bg-primary/4">
                <CardContent className="space-y-3 pt-6">
                  <p className="text-sm font-semibold text-foreground">Upload destination</p>
                  <code className="block break-all rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
                    {userId || 'tenant-id'}/{datatype || 'datatype'}/{file?.name ?? 'your-file.pdf'}
                  </code>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Files are scoped to your tenant and grouped by datatype. The agent re-indexes new documents
                    automatically within a few seconds.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}