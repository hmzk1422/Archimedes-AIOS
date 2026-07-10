'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

export default function UploadPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [status, setStatus] = useState('')
  const [datatype, setDatatype] = useState('policies')
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
    }

    loadUser()
  }, [router])

  async function handleUpload(event: FormEvent) {
    event.preventDefault()

    if (!selectedFile) {
      setStatus('Please choose a PDF file first.')
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
      // Upload into tenant-scoped datatype subfolder, e.g. <userId>/policies/file.pdf
      const storagePath = `${user.id}/${datatype}/${selectedFile.name}`

      const { error } = await supabase.storage.from(bucket).upload(storagePath, selectedFile, {
        cacheControl: '3600',
        upsert: true,
        contentType: selectedFile.type || 'application/pdf',
      })

      if (error) throw error

      setStatus(`Upload complete. File stored at ${bucket}/${storagePath}`)
      setSelectedFile(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setLoading(false)
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
              <select
                value={datatype}
                onChange={(e) => setDatatype(e.target.value)}
                className="mt-2 mb-3 block w-48 rounded border border-border bg-card px-3 py-2 text-sm"
              >
                <option value="policies">Policies</option>
                <option value="administration">Administration</option>
              </select>
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
              disabled={loading}
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

        {userId ? (
          <div className="mt-4 text-sm text-muted-foreground">
            Upload destination: <span className="font-medium text-foreground">{userId}/{datatype}/your-file.pdf</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
