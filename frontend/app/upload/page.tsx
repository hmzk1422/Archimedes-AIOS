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
  Trash2,
  FileIcon,
  Link2,
  ExternalLink,
} from 'lucide-react'

// Supabase
import { createClient } from '@/utils/supabase/client'

// Components
import { DashboardNav } from '@/components/dashboard/dashboard-nav'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PageBackground } from '@/components/page-background'

type Status = { kind: 'idle' | 'success' | 'error' | 'info'; message: string }

// NEW: the n8n webhook that ingests a link (see n8n-ingest-new-link.json)
const N8N_INGEST_WEBHOOK_URL = process.env.NEXT_PUBLIC_N8N_INGEST_WEBHOOK_URL || ''

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// NEW: light client-side guard before we ever call the webhook
function isValidUrl(value: string) {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
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
  const [datatypes, setDatatypes] = useState<string[]>([])
  const [datatype, setDatatype] = useState('')
  const [newDatatype, setNewDatatype] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' })
  const [customInstruction, setCustomInstruction] = useState('')
  const [savingInstruction, setSavingInstruction] = useState(false)
  const [instructionStatus, setInstructionStatus] = useState<Status>({ kind: 'idle', message: '' })
  const inputRef = useRef<HTMLInputElement>(null)

  // File Management State
  const [currentFiles, setCurrentFiles] = useState<any[]>([])
  const [fetchingFiles, setFetchingFiles] = useState(false)

  // NEW: ingestion mode toggle
  const [mode, setMode] = useState<'file' | 'link'>('file')

  // NEW: link-based ingestion state (separate from the static upload state above)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkFilename, setLinkFilename] = useState('')
  const [linkSubmitting, setLinkSubmitting] = useState(false)
  const [linkStatus, setLinkStatus] = useState<Status>({ kind: 'idle', message: '' })
  const [linkedFiles, setLinkedFiles] = useState<any[]>([])
  const [fetchingLinkedFiles, setFetchingLinkedFiles] = useState(false)

  // Fetch datatypes from the customer-service-provider table
  const refreshDatatypes = useCallback(async (uid: string, silent = false) => {
  if (!silent) setStatus({ kind: 'info', message: 'Refreshing datatypes from database…' })

  try {
    const supabase = createClient()

    const { data, error } = await supabase
      .from('customer-service-provider')
      .select('datatype')
      .eq('tenant_id', uid)
      .neq('datatype', 'tasks')

    if (error) throw error

    if (data) {
      const fetchedFolders = Array.from(
        new Set(data.map((item) => item.datatype).filter(Boolean))
      ).sort()

      // CRITICAL: Always update the available datatypes list with what came from the DB
      setDatatypes(fetchedFolders)

      if (fetchedFolders.length > 0) {
        setDatatype((currentDatatype) => {
          // If the current datatype is still valid, keep it; otherwise use the first available one
          return fetchedFolders.includes(currentDatatype) ? currentDatatype : fetchedFolders[0]
        })

        if (!silent) setStatus({ kind: 'success', message: 'Datatypes synced with database.' })
      } else {
        // CRITICAL: Explicitly clear the active datatype if the account is completely empty
        setDatatype('')
        if (!silent) {
          setStatus({ kind: 'info', message: 'No existing datatypes found in database.' })
        }
      }
    }
  } catch (error) {
    if (!silent) {
      setStatus({ kind: 'error', message: 'Failed to fetch datatypes from database.' })
    }
  }
}, [])
  // Fetch actual files inside the currently selected datatype (static uploads)
  const refreshFiles = useCallback(async (uid: string, currentDatatype: string) => {
    setFetchingFiles(true)
    try {
      const supabase = createClient()
      const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'customer-service-provider'

      const { data, error } = await supabase.storage.from(bucket).list(`${uid}/${currentDatatype}`, {
        limit: 100,
        sortBy: { column: 'name', order: 'asc' },
      })

      if (error) throw error

      if (data) {
        // Files actually have IDs (unlike empty folder placeholders)
        const actualFiles = data.filter((item) => item.id)
        setCurrentFiles(actualFiles)
      } else {
        setCurrentFiles([])
      }
    } catch (error) {
      console.error('Failed to fetch files inside datatype:', error)
    } finally {
      setFetchingFiles(false)
    }
  }, [])

  // NEW: fetch rows from the `customer-service-provider` table for the current datatype
  // (these are the URL-based sources n8n has ingested — a different resource than the
  // storage bucket used by refreshFiles above)
  const refreshLinkedFiles = useCallback(async (uid: string, currentDatatype: string) => {
    setFetchingLinkedFiles(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('customer-service-provider')
        .select('id, filename, source_url, datatype, tenant_id, updated_at')
        .eq('tenant_id', uid)
        .eq('datatype', currentDatatype)
        .not('source_url', 'is', null) // <-- ADD THIS LINE to filter out static files
        .order('filename', { ascending: true })

      if (error) throw error
      setLinkedFiles(data ?? [])
    } catch (error) {
      console.error('Failed to fetch linked files:', error)
    } finally {
      setFetchingLinkedFiles(false)
    }
  }, [])

  // Load user & tenant context on mount
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
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('tenant_name, custom_instruction')
        .eq('id', user.id)
        .maybeSingle()

      // Log any silent database/RLS errors to the browser console
      if (profileError) {
        console.error('Error fetching profile:', profileError.message)
      }

      // Safely apply the data if the profile exists
      if (profile) {
        if (profile.tenant_name) {
          setTenantName(profile.tenant_name)
        }
        if (profile.custom_instruction !== null && profile.custom_instruction !== undefined) {
          setCustomInstruction(profile.custom_instruction)
        }
      }

      // 2. Reflect what's truly inside the supabase storage on load
      await refreshDatatypes(user.id, true)
      setCheckingUser(false)
    }

    loadUser()
  }, [router, refreshDatatypes])

  // When datatype or userId changes, fetch both the static files and the linked sources
  useEffect(() => {
    if (userId && datatype) {
      refreshFiles(userId, datatype)
      refreshLinkedFiles(userId, datatype) // NEW
    }
  }, [userId, datatype, refreshFiles, refreshLinkedFiles])

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

  async function handleSaveCustomInstruction() {
    if (!userId) {
      setInstructionStatus({ kind: 'error', message: 'Please sign in before saving instructions.' })
      return
    }

    setSavingInstruction(true)
    setInstructionStatus({ kind: 'info', message: 'Saving custom instructions…' })

    try {
      const supabase = createClient()
      
      // Append .select() to verify a row was actually found and modified
      const { data, error } = await supabase
        .from('profiles')
        .update({ custom_instruction: customInstruction })
        .eq('id', userId)
        .select() 

      if (error) throw error

      // CRITICAL CHECK: If data is empty, the update silently failed
      if (!data || data.length === 0) {
        throw new Error("Profile not found. You may need to create a profile row for this user first, or check your database RLS policies.")
      }

      setInstructionStatus({ kind: 'success', message: 'Custom instructions saved for your account.' })
    } catch (error) {
      setInstructionStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to save custom instructions',
      })
    } finally {
      setSavingInstruction(false)
    }
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
      // Scoped exactly as requested: tenant/datatype/file.pdf
      const storagePath = `${user.id}/${datatype}/${file.name}`

      const { error } = await supabase.storage.from(bucket).upload(storagePath, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type || 'application/pdf',
      })

      if (error) throw error

      setStatus({ kind: 'success', message: `Upload complete. Stored at ${bucket}/${storagePath}` })
      setFile(null)

      // Refresh datatypes and the current files view
      await refreshDatatypes(user.id, true)
      await refreshFiles(user.id, datatype)
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Upload failed' })
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteFile(fileName: string) {
    if (!userId || !datatype) return
    if (!confirm(`Are you sure you want to delete "${fileName}"? This action cannot be undone.`)) return

    setStatus({ kind: 'info', message: `Deleting ${fileName}...` })

    try {
      const supabase = createClient()
      const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'customer-service-provider'
      const storagePath = `${userId}/${datatype}/${fileName}`
      console.log("Attempting to delete:", storagePath) // Add this line!

      // Capture 'data' from the remove call
      const { data, error } = await supabase.storage.from(bucket).remove([storagePath])

      if (error) throw error

      // CRITICAL CHECK: If data is empty, the file wasn't actually touched
      if (!data || data.length === 0) {
        throw new Error(
          "File not deleted. This usually means the file path is incorrect, or your Supabase Storage RLS policies are missing a 'DELETE' rule for this user."
        )
      }

      try {
        const cleanupResponse = await fetch('http://localhost:8000/knowledge/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenant_id: userId,
            datatype,
            file_name: fileName,
          }),
        })

        if (!cleanupResponse.ok) {
          console.error('Knowledge cleanup failed', await cleanupResponse.text())
        }
      } catch (cleanupError) {
        console.error('Knowledge cleanup error', cleanupError)
      }

      setStatus({ kind: 'success', message: `Deleted ${fileName} successfully.` })

      // Refresh files list after deletion
      await refreshFiles(userId, datatype)
      // Refresh datatypes in case the folder was left entirely empty and removed
      await refreshDatatypes(userId, true)
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to delete file' })
    }
  }

  // NEW: hand a URL off to the n8n ingestion webhook (n8n-ingest-new-link.json).
  // Next.js never downloads or parses the file itself — it just triggers the workflow
  // and reports back whatever n8n responds with.
  async function handleAddLink(e: FormEvent) {
    e.preventDefault()

    if (!isValidUrl(linkUrl)) {
      setLinkStatus({ kind: 'error', message: 'Enter a valid http(s) URL.' })
      return
    }
    if (!datatype) {
      setLinkStatus({ kind: 'error', message: 'Please select or add a datatype.' })
      return
    }
    if (!N8N_INGEST_WEBHOOK_URL) {
      setLinkStatus({ kind: 'error', message: 'NEXT_PUBLIC_N8N_INGEST_WEBHOOK_URL is not configured.' })
      return
    }

    setLinkSubmitting(true)
    setLinkStatus({ kind: 'info', message: 'Sending link to the ingestion workflow…' })

    try {
      const supabase = createClient()
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()

      if (sessionError || !session) {
        setLinkStatus({ kind: 'error', message: 'Please sign in before adding a link.' })
        setLinkSubmitting(false)
        return
      }

      const res = await fetch(N8N_INGEST_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // From your handleAddLink function:
        body: JSON.stringify({
          url: linkUrl,
          datatype, // <-- This passes the actively selected folder ('policies')
          filename: linkFilename.trim() || undefined,
          access_token: session.access_token,
        }),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok || json?.success === false) {
        throw new Error(json?.error || `Ingestion failed (${res.status})`)
      }

      setLinkStatus({ kind: 'success', message: 'Link received — n8n is downloading and indexing it now.' })
      setLinkUrl('')
      setLinkFilename('')

      // The webhook only responds after the row is written, so this should
      // already show the new entry.
      if (userId) await refreshLinkedFiles(userId, datatype)
    } catch (error) {
      setLinkStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to add link' })
    } finally {
      setLinkSubmitting(false)
    }
  }

  // NEW: remove a linked (URL-based) source. This only deletes the indexed row —
  // it does not touch the original file at its source URL.
  async function handleDeleteLinkedFile(row: any) {
    if (!userId) return
    if (!confirm(`Remove "${row.filename}" from the knowledge base? This only removes the indexed copy — the source link is untouched.`)) return

    try {
      const supabase = createClient()
      const { error } = await supabase.from('customer-service-provider').delete().eq('id', row.id)
      if (error) throw error

      setLinkStatus({ kind: 'success', message: `Removed ${row.filename}.` })
      await refreshLinkedFiles(userId, datatype)
    } catch (error) {
      setLinkStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to remove link' })
    }
  }

  const activeStatus = mode === 'file' ? status : linkStatus

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <PageBackground />
      {/* Dynamic Nav mimicking the Dashboard */}
      <DashboardNav tenantName={tenantName} />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Knowledge Base</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-balance">Upload knowledge</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Drop in documents — or point us at a link — and the agent ingests them automatically. Files are
            organized by datatype so answers stay grounded in the right context. You can also manage existing
            files here.
          </p>
        </div>

        {checkingUser ? (
          <div className="mt-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Authenticating session...</p>
          </div>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <div className="space-y-6">
              <Card>
                <CardContent className="pt-6">
                  <form onSubmit={mode === 'file' ? handleUpload : handleAddLink} className="space-y-6">
                  {/* NEW: mode toggle */}
                  <div className="inline-flex rounded-lg border border-border bg-secondary/30 p-1">
                    <button
                      type="button"
                      onClick={() => setMode('file')}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        mode === 'file'
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <UploadCloud className="size-3.5" />
                      Upload a file
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('link')}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        mode === 'link'
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Link2 className="size-3.5" />
                      Add via link
                    </button>
                  </div>

                  {mode === 'file' ? (
                    <>
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
                    </>
                  ) : (
                    // NEW: link-based ingestion form
                    <div className="space-y-4 rounded-xl border border-border bg-secondary/30 p-5">
                      <div>
                        <label className="text-sm font-medium text-foreground">Source URL</label>
                        <input
                          type="url"
                          value={linkUrl}
                          onChange={(e) => setLinkUrl(e.target.value)}
                          placeholder="https://example.com/employee-handbook.pdf"
                          className="mt-2 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                          required
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground">Filename (optional)</label>
                        <input
                          value={linkFilename}
                          onChange={(e) => setLinkFilename(e.target.value)}
                          placeholder="Leave blank to use the name from the URL"
                          className="mt-2 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                        />
                      </div>
                      <p className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Info className="mt-0.5 size-3.5 shrink-0" />
                        n8n downloads this file, extracts its text, and keeps it in sync automatically —
                        it periodically re-checks the source and updates the indexed copy if it changes.
                      </p>
                    </div>
                  )}

                  {/* Datatype selection — shared between both modes */}
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
                    {mode === 'file' ? (
                      <Button
                        type="submit"
                        size="lg"
                        disabled={loading || !file || !userId}
                        className="bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        {loading ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
                        {loading ? 'Uploading…' : 'Upload PDF'}
                      </Button>
                    ) : (
                      <Button
                        type="submit"
                        size="lg"
                        disabled={linkSubmitting || !linkUrl || !userId}
                        className="bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        {linkSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                        {linkSubmitting ? 'Sending…' : 'Add link'}
                      </Button>
                    )}
                  </div>

                  {activeStatus.message && (
                    <div
                      className={cn(
                        'flex items-start gap-2 rounded-lg border p-3 text-sm',
                        activeStatus.kind === 'success' && 'border-primary/30 bg-primary/10 text-foreground',
                        activeStatus.kind === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
                        activeStatus.kind === 'info' && 'border-border bg-secondary/40 text-muted-foreground',
                      )}
                    >
                      {activeStatus.kind === 'success' ? (
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      ) : (
                        <Info className="mt-0.5 size-4 shrink-0" />
                      )}
                      <span className="break-all">{activeStatus.message}</span>
                    </div>
                  )}
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="space-y-0">
                  <CardTitle>Custom instructions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    These instructions are stored in your profile and are used by the agent when answering questions.
                  </p>
                  <textarea
                    value={customInstruction}
                    onChange={(e) => setCustomInstruction(e.target.value)}
                    placeholder="Tell the agent how to respond for your business, tone, or edge cases..."
                    className="min-h-35 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">Saved only to your account profile.</p>
                    <Button type="button" size="sm" onClick={handleSaveCustomInstruction} disabled={savingInstruction || !userId}>
                      {savingInstruction ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                      {savingInstruction ? 'Saving…' : 'Save instructions'}
                    </Button>
                  </div>
                  {instructionStatus.message && (
                    <div
                      className={cn(
                        'rounded-lg border p-3 text-sm',
                        instructionStatus.kind === 'success' && 'border-primary/30 bg-primary/10 text-foreground',
                        instructionStatus.kind === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
                        instructionStatus.kind === 'info' && 'border-border bg-secondary/40 text-muted-foreground',
                      )}
                    >
                      {instructionStatus.message}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">

              {/* Existing Folders/Datatypes Card */}
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

              {/* Files within current Datatype Card (static uploads) */}
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div className="flex items-center gap-2">
                    <FileIcon className="size-4 text-primary" />
                    <CardTitle>Files in '{datatype}'</CardTitle>
                  </div>
                  {fetchingFiles && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                </CardHeader>
                <CardContent className="space-y-2">
                  {!fetchingFiles && currentFiles.length === 0 && (
                    <p className="text-xs text-muted-foreground">No files uploaded to this datatype yet.</p>
                  )}

                  <div className="max-h-75 space-y-2 overflow-y-auto pr-2">
                    {currentFiles.map((f) => (
                      <div
                        key={f.id}
                        className="group flex items-center justify-between rounded-lg border border-border/60 bg-card px-3 py-2 transition-colors hover:bg-secondary/30"
                      >
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium" title={f.name}>
                            {f.name}
                          </span>
                          {f.metadata?.size && (
                            <span className="text-xs text-muted-foreground">
                              {formatSize(f.metadata.size)}
                            </span>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                          onClick={() => handleDeleteFile(f.name)}
                          title="Delete file"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* NEW: Linked sources Card (URL-based ingestion, via n8n) */}
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div className="flex items-center gap-2">
                    <Link2 className="size-4 text-primary" />
                    <CardTitle>Linked sources in '{datatype}'</CardTitle>
                  </div>
                  {fetchingLinkedFiles && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                </CardHeader>
                <CardContent className="space-y-2">
                  {!fetchingLinkedFiles && linkedFiles.length === 0 && (
                    <p className="text-xs text-muted-foreground">No links added to this datatype yet.</p>
                  )}

                  <div className="max-h-75 space-y-2 overflow-y-auto pr-2">
                    {linkedFiles.map((row) => (
                      <div
                        key={row.id}
                        className="group flex items-start justify-between gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 transition-colors hover:bg-secondary/30"
                      >
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium" title={row.filename}>
                            {row.filename}
                          </span>
                          {row.source_url && (
                            <a
                              href={row.source_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 flex min-w-0 items-start gap-1 break-all text-xs text-muted-foreground hover:text-primary"
                              title={row.source_url}
                            >
                              <ExternalLink className="mt-0.5 size-3 shrink-0" />
                              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-normal">
                                {row.source_url}
                              </span>
                            </a>
                          )}
                          {row.updated_at && (
                            <span className="text-xs text-muted-foreground">
                              Updated {new Date(row.updated_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                          onClick={() => handleDeleteLinkedFile(row)}
                          title="Remove linked source"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-primary/20 bg-primary/4">
                <CardContent className="space-y-3 pt-6">
                  <p className="text-sm font-semibold text-foreground">
                    {mode === 'file' ? 'Upload destination' : 'Ingestion target'}
                  </p>
                  <code className="block break-all rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
                    {mode === 'file'
                      ? `${userId || 'tenant-id'}/${datatype || 'datatype'}/${file?.name ?? 'your-file.pdf'}`
                      : `customer-service-provider row: tenant_id=${userId || 'tenant-id'}, datatype=${datatype || 'datatype'}, filename=${linkFilename || '(from URL)'}`}
                  </code>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {mode === 'file'
                      ? 'Files are scoped to your tenant and grouped by datatype. The agent re-indexes new documents automatically within a few seconds.'
                      : 'Linked sources are scoped to your tenant and grouped by datatype in the customer-service-provider table. n8n re-checks each link and refreshes the indexed text whenever the source changes.'}
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