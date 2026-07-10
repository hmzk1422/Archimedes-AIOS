'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

export default function UploadPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [status, setStatus] = useState('')
  const [datatype, setDatatype] = useState('')
  const [datatypes, setDatatypes] = useState<string[]>([])
  const [newDatatype, setNewDatatype] = useState('')
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [checkingUser, setCheckingUser] = useState(true)
  const router = useRouter()

  useEffect(() => {
    async function loadUser() {
      const supabase = createClient()
      const { data: { user }, error } = await supabase.auth.getUser()

      if (error || !user) {
        router.replace('/auth')
        return
      }

      setUserId(user.id)
      setCheckingUser(false)
      // Strictly fetch datatypes from the server based on user UUID
      try {
        await refreshFromServer(user.id)
      } catch (e) {
        setStatus('Failed to load datatypes.')
      }
    }

    loadUser()
  }, [router])

  function addDatatype() {
    const candidate = (newDatatype || '').trim()
    if (!candidate) return
    const normalized = candidate.toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (!normalized) return
    
    // Replace current selection with newly added datatype
    setDatatypes([normalized])
    setDatatype(normalized)
    setNewDatatype('')
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault()

    if (!selectedFile) {
      setStatus('Please choose a PDF file first.')
      return
    }

    if (!datatype) {
      setStatus('Please select or add a datatype.')
      return
    }

    const supabase = createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      setStatus('Please sign in before uploading.')
      return
    }

    setLoading(true)
    setStatus('Uploading PDF to Supabase Storage...')

    try {
      const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'customer-service-provider'
      // Strictly scope path to UUID
      const storagePath = `${user.id}/${datatype}/${selectedFile.name}`

      const { error } = await supabase.storage.from(bucket).upload(storagePath, selectedFile, {
        cacheControl: '3600',
        upsert: true,
        contentType: selectedFile.type || 'application/pdf',
      })

      if (error) throw error

      setStatus(`Upload complete. File stored at ${bucket}/${storagePath}`)
      setSelectedFile(null)
      // Refresh to ensure the new folder structure maps instantly
      await refreshFromServer(user.id)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  async function refreshFromServer(userIdOverride?: string) {
    const targetUser = userIdOverride || userId
    if (!targetUser) {
      setStatus('Sign in to refresh datatypes from storage')
      return
    }
    setStatus('Refreshing datatypes from storage...')
    try {
      const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const res = await fetch(`${api}/storage-list?tenant_id=${encodeURIComponent(targetUser)}`)
      const data = await res.json()
      
      if (data?.status === 'ok' && Array.isArray(data.items)) {
        const discovered = new Set<string>()
        for (const name of data.items) {
          if (!name) continue
          const n = String(name)
          
          // --- FIX APPLIED RIGHT HERE ---
          if (n.endsWith('/')) {
            const seg = n.replace(/\/+$/, '').split('/').pop()
            if (seg) discovered.add(seg.toLowerCase())
          } else if (n.includes('/')) {
            discovered.add(n.split('/')[0].toLowerCase())
          } else {
            // Supabase returns folder names at this nested level without slashes. 
            // We capture them here, ignoring root files with extensions (e.g. .pdf)
            if (!n.includes('.')) {
              discovered.add(n.toLowerCase())
            }
          }
          // ------------------------------
        }
        const cleaned = Array.from(discovered).map(s => s.replace(/[^a-z0-9_-]/g, '')).filter(Boolean)
        
        if (cleaned.length === 0) {
          setStatus('No datatypes discovered in storage for this user')
          setDatatypes([])
          setDatatype('')
        } else {
          setDatatypes(cleaned)
          setDatatype(cleaned[0])
          setStatus('Datatypes refreshed from storage')
        }
      } else {
        setStatus(data?.message || 'Failed to fetch storage list')
      }
    } catch (e) {
      setStatus(String(e))
    }
  }

  return (
    <div className="min-h-screen bg-background p-8 lg:p-12">
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Knowledge Upload</p>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Upload a PDF</h1>
          </div>
          <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">
            Back to dashboard
          </Link>
        </div>

        {checkingUser ? (
          <div className="rounded-lg border border-border bg-background/70 p-4 text-sm text-muted-foreground">
            Checking your Supabase session...
          </div>
        ) : (
          <form onSubmit={handleUpload} className="space-y-5">
            <div className="rounded-xl border border-dashed border-border bg-background/70 p-6">
              <label className="block text-sm font-medium text-foreground">Choose PDF file</label>
              <label className="block mt-3 text-sm font-medium text-foreground">Datatype</label>
              <div className="flex items-center gap-3">
                <select
                  value={datatype}
                  onChange={(e) => setDatatype(e.target.value)}
                  className="mt-2 mb-3 block w-48 rounded border border-border bg-card px-3 py-2 text-sm"
                  disabled={datatypes.length === 0}
                >
                  {datatypes.length === 0 && <option value="">No datatypes...</option>}
                  {datatypes.map((dt) => (
                    <option key={dt} value={dt}>{dt}</option>
                  ))}
                </select>

                <div className="flex items-center gap-2">
                  <input
                    value={newDatatype}
                    onChange={(e) => setNewDatatype(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDatatype() } }}
                    placeholder="Add type"
                    className="mt-2 block w-36 rounded border border-border bg-card px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={addDatatype}
                    className="mt-2 rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
                  >
                    Add
                  </button>
                </div>
              </div>
              <input
                type="file"
                accept="application/pdf"
                onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                className="mt-3 block w-full text-sm text-muted-foreground file:mr-4 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary-foreground hover:file:opacity-90"
              />
              <p className="mt-3 text-sm text-muted-foreground">
                This will upload the PDF into Supabase Storage under your user id and datatype folder.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || (!datatype && !newDatatype)}
              className="rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Uploading...' : 'Upload PDF'}
            </button>
          </form>
        )}

        {status ? (
          <div className="mt-6 rounded-lg border border-border bg-background/70 p-4 text-sm text-foreground">
            {status}
          </div>
        ) : null}

        <div className="mt-4 text-sm text-muted-foreground">
          Current datatypes: {datatypes.length ? datatypes.map((d) => (
            <span key={d} className="inline-block mr-2 rounded bg-muted px-2 py-1 text-xs font-medium text-foreground">{d}</span>
          )) : <span className="text-sm text-red-400">No datatypes found for your account</span>}
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={() => refreshFromServer()} className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Refresh from storage</button>
          </div>
        </div>

        {userId && (datatype || newDatatype) ? (
          <div className="mt-4 text-sm text-muted-foreground">
            Upload destination: <span className="font-medium text-foreground">{userId}/{datatype || newDatatype}/your-file.pdf</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}