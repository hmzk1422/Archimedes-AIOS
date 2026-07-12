'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Building2, Loader2, MessageCircle, Save, Send, Settings } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

type PlatformKey = 'telegram' | 'whatsapp' | 'zendesk'

type PlatformConfig = {
  enabled: boolean
  config: Record<string, string>
}

type ExtensionConfig = {
  'connection-extension': {
    enabled: boolean
    platforms: Record<PlatformKey, PlatformConfig>
  }
}

type Status = { kind: 'idle' | 'success' | 'error' | 'info'; message: string }

type PlatformField = {
  key: string
  label: string
  placeholder: string
  type?: string
}

type PlatformDefinition = {
  key: PlatformKey
  name: string
  description: string
  icon: typeof Send
  fields: PlatformField[]
}

const PLATFORM_DEFINITIONS: PlatformDefinition[] = [
  {
    key: 'telegram',
    name: 'Telegram',
    description: 'Connect a Telegram bot through the n8n gateway.',
    icon: Send,
    fields: [
      {
        key: 'telegram_token',
        label: 'Bot API Token',
        placeholder: '1234567890:AA...',
        type: 'password',
      },
    ],
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    description: 'Use the WhatsApp Cloud API token and phone number id.',
    icon: MessageCircle,
    fields: [
      {
        key: 'whatsapp_token',
        label: 'Access Token',
        placeholder: 'EAA...',
        type: 'password',
      },
      {
        key: 'whatsapp_phone_id',
        label: 'Phone Number ID',
        placeholder: '123456789012345',
      },
    ],
  },
  {
    key: 'zendesk',
    name: 'Zendesk',
    description: 'Route Zendesk ticket messages through the same agent gateway.',
    icon: Building2,
    fields: [
      {
        key: 'zendesk_email',
        label: 'Zendesk Email',
        placeholder: 'agent@example.com',
        type: 'email',
      },
      {
        key: 'zendesk_token',
        label: 'API Token',
        placeholder: 'Zendesk API token',
        type: 'password',
      },
      {
        key: 'zendesk_subdomain',
        label: 'Subdomain',
        placeholder: 'your-company',
      },
    ],
  },
]

const DEFAULT_EXTENSION_CONFIG: ExtensionConfig = {
  'connection-extension': {
    enabled: false,
    platforms: {
      telegram: {
        enabled: false,
        config: {
          telegram_token: '',
        },
      },
      whatsapp: {
        enabled: false,
        config: {
          whatsapp_token: '',
          whatsapp_phone_id: '',
        },
      },
      zendesk: {
        enabled: false,
        config: {
          zendesk_email: '',
          zendesk_token: '',
          zendesk_subdomain: '',
        },
      },
    },
  },
}

function cloneDefaultConfig(): ExtensionConfig {
  return JSON.parse(JSON.stringify(DEFAULT_EXTENSION_CONFIG)) as ExtensionConfig
}

function normalizeExtensionConfig(value: unknown): ExtensionConfig {
  let parsed = value

  if (typeof parsed === 'string' && parsed.trim()) {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      parsed = {}
    }
  }

  const next = cloneDefaultConfig()
  const source = parsed && typeof parsed === 'object' ? parsed as Partial<ExtensionConfig> : {}
  const connection = source['connection-extension']
  const sourcePlatforms = (connection?.platforms ?? {}) as Partial<Record<PlatformKey, PlatformConfig>>

  PLATFORM_DEFINITIONS.forEach((platform) => {
    const incoming = sourcePlatforms[platform.key]
    next['connection-extension'].platforms[platform.key] = {
      enabled: Boolean(incoming?.enabled),
      config: {
        ...next['connection-extension'].platforms[platform.key].config,
        ...(incoming?.config ?? {}),
      },
    }
  })

  next['connection-extension'].enabled =
    Boolean(connection?.enabled) ||
    PLATFORM_DEFINITIONS.some(({ key }) => next['connection-extension'].platforms[key].enabled)

  return next
}

export default function ExtensionPage() {
  const [extensionConfig, setExtensionConfig] = useState<ExtensionConfig>(cloneDefaultConfig)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [isDirty, setIsDirty] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' })

  const enabledCount = useMemo(
    () => PLATFORM_DEFINITIONS.filter(({ key }) => extensionConfig['connection-extension'].platforms[key].enabled).length,
    [extensionConfig]
  )

  useEffect(() => {
    let cancelled = false

    async function loadExtensionSettings() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        if (!cancelled) setChecking(false)
        return
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('extension')
        .eq('id', user.id)
        .maybeSingle()

      if (cancelled) return

      if (error) {
        setStatus({ kind: 'error', message: 'Failed to load extension settings.' })
      } else {
        setExtensionConfig(normalizeExtensionConfig(data?.extension))
        setIsDirty(false)
      }

      setChecking(false)
    }

    void loadExtensionSettings()

    return () => {
      cancelled = true
    }
  }, [])

  function updatePlatformEnabled(platform: PlatformKey, enabled: boolean) {
    setExtensionConfig((current) => {
      const next = structuredClone(current)
      next['connection-extension'].platforms[platform].enabled = enabled
      next['connection-extension'].enabled = PLATFORM_DEFINITIONS.some(
        ({ key }) => next['connection-extension'].platforms[key].enabled
      )
      return next
    })
    setIsDirty(true)
  }

  function updatePlatformField(platform: PlatformKey, field: string, value: string) {
    setExtensionConfig((current) => {
      const next = structuredClone(current)
      next['connection-extension'].platforms[platform].config[field] = value
      return next
    })
    setIsDirty(true)
  }

  async function handleSave() {
    setLoading(true)
    setStatus({ kind: 'info', message: 'Saving extension settings...' })
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      setStatus({ kind: 'error', message: 'You must be logged in to save extension settings.' })
      setLoading(false)
      return
    }

    try {
      const normalized = normalizeExtensionConfig(extensionConfig)
      const { error } = await supabase
        .from('profiles')
        .update({ extension: normalized })
        .eq('id', user.id)

      if (error) throw error

      setExtensionConfig(normalized)
      setIsDirty(false)
      setStatus({ kind: 'success', message: 'Extension settings saved to your profile.' })
    } catch (err) {
      console.error(err)
      setStatus({ kind: 'error', message: 'Failed to save extension settings.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Connections</p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight">Agent Extensions</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Turn on external channels and store their gateway credentials in your profile.
          </p>
        </div>
        <Button onClick={handleSave} disabled={loading || checking || !isDirty}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          <span>Save Changes</span>
        </Button>
      </div>

      {status.message && (
        <div className={cn(
          'rounded-lg border p-3 text-sm flex items-center gap-2',
          status.kind === 'success' && 'border-primary/20 bg-primary/10 text-primary',
          status.kind === 'error' && 'border-destructive/20 bg-destructive/10 text-destructive',
          status.kind === 'info' && 'border-border bg-muted text-muted-foreground'
        )}>
          <AlertCircle className="size-4" />
          <p>{status.message}</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="size-5" /> Connection Extension
          </CardTitle>
          <CardDescription>
            {checking ? 'Loading profile settings...' : `${enabledCount} platform${enabledCount === 1 ? '' : 's'} enabled.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {checking ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading extensions
            </div>
          ) : (
            PLATFORM_DEFINITIONS.map((platform) => {
              const Icon = platform.icon
              const state = extensionConfig['connection-extension'].platforms[platform.key]

              return (
                <div key={platform.key} className="rounded-lg border bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5 rounded-md border bg-background p-2 text-muted-foreground">
                        <Icon className="size-4" />
                      </div>
                      <div>
                        <p className="font-semibold">{platform.name}</p>
                        <p className="text-sm text-muted-foreground">{platform.description}</p>
                      </div>
                    </div>
                    <Switch
                      aria-label={`Enable ${platform.name}`}
                      checked={state.enabled}
                      onCheckedChange={(enabled) => updatePlatformEnabled(platform.key, enabled)}
                    />
                  </div>

                  {state.enabled && (
                    <div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2">
                      {platform.fields.map((field) => (
                        <div key={field.key} className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            {field.label}
                          </label>
                          <Input
                            type={field.type ?? 'text'}
                            value={state.config[field.key] ?? ''}
                            onChange={(event) => updatePlatformField(platform.key, field.key, event.target.value)}
                            placeholder={field.placeholder}
                            autoComplete="off"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </section>
  )
}
