'use client'

import { useState } from 'react'
import {
  Palette,
  Type,
  ImageIcon,
  LayoutGrid,
  Sparkles,
  RotateCcw,
  Check,
  Loader2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useAppearance } from '@/components/appearance/appearance-provider'
import {
  DEFAULT_APPEARANCE,
  THEME_PRESETS,
  BACKGROUND_PRESETS,
  applyThemePreset,
  type Appearance,
  type BrandTheme,
  type CanvasSettings,
} from '@/lib/theme'

/**
 * Admin-only "Appearance" panel. Lets the workspace owner customise the logo,
 * color scheme, corner radius, background palette and dashboard canvas — all
 * optional so the default (pre-installed) theme stays until changed.
 */
export function AppearanceSettings() {
  const { appearance, canEdit, update } = useAppearance()
  // Local draft so edits are tuned here but only persisted on "Save".
  const [draft, setDraft] = useState<Appearance>(appearance)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved'>('idle')

  // Sync the draft when the saved appearance arrives (the provider loads it
  // asynchronously after mount). Use the "adjust state during render" pattern so
  // in-progress edits are never clobbered and the linter stays happy.
  const [prevAppearance, setPrevAppearance] = useState(appearance)
  if (prevAppearance !== appearance) {
    setPrevAppearance(appearance)
    setDraft(appearance)
  }

  const save = async () => {
    setSaving(true)
    await update(draft)
    setSaving(false)
    setStatus('saved')
    window.setTimeout(() => setStatus('idle'), 2000)
  }

  const setTheme = (patch: Partial<BrandTheme>) =>
    setDraft((d) => ({ ...d, theme: { ...d.theme, ...patch } }))
  const setCanvas = (patch: Partial<CanvasSettings>) =>
    setDraft((d) => ({ ...d, canvas: { ...d.canvas, ...patch } }))

  if (!canEdit) {
    return (
      <Card className="border-border/60">
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            Only the workspace admin can change the site appearance.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {/* Theme presets */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="size-5 text-primary" />
            Theme presets
          </CardTitle>
          <CardDescription>
            Pick a starting theme — it stays fully editable below. Your brand
            name, mark and logo are preserved when you switch presets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {THEME_PRESETS.map((preset) => {
              const active =
                draft.theme.primary === preset.primary &&
                draft.theme.paletteKey === preset.paletteKey
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    setTheme(applyThemePreset(preset, draft.theme))
                  }
                  className={cn(
                    'group flex flex-col items-center gap-2 rounded-xl border p-3 transition-colors',
                    active
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-foreground/20 hover:bg-secondary/40',
                  )}
                >
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
                    style={{
                      backgroundColor: preset.primary,
                      color: preset.primaryForeground,
                    }}
                  >
                    {preset.name.charAt(0)}
                  </span>
                  <span className="text-xs font-medium text-foreground">
                    {preset.name}
                  </span>
                  {active && <Check className="size-3 text-primary" />}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Brand */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Type className="size-5 text-primary" />
            Brand &amp; logo
          </CardTitle>
          <CardDescription>
            Shown in the top navigation for everyone in the workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {draft.theme.logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={draft.theme.logoSrc}
                alt=""
                className="h-12 w-12 rounded-xl border border-border object-contain"
              />
            ) : (
              <span
                className="flex h-12 w-12 items-center justify-center rounded-xl text-xl font-bold"
                style={{
                  backgroundColor: draft.theme.primary,
                  color: draft.theme.primaryForeground,
                }}
              >
                {draft.theme.mark || draft.theme.brandName.charAt(0)}
              </span>
            )}
            <div className="flex-1 space-y-2">
              <div className="space-y-1.5">
                <Label htmlFor="brand-name">Brand name</Label>
                <Input
                  id="brand-name"
                  value={draft.theme.brandName}
                  onChange={(e) => setTheme({ brandName: e.target.value })}
                  placeholder="e.g. Acme Corp"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="logo-mark">
                  Logo mark (letter shown when no image is set)
                </Label>
                <Input
                  id="logo-mark"
                  value={draft.theme.mark}
                  maxLength={2}
                  onChange={(e) => setTheme({ mark: e.target.value })}
                  placeholder="A"
                  className="max-w-[12rem]"
                />
              </div>
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="logo-src">
                <ImageIcon className="mr-1 inline size-3.5" />
                Custom logo image URL (optional)
              </Label>
              <Input
                id="logo-src"
                value={draft.theme.logoSrc || ''}
                onChange={(e) =>
                  setTheme({ logoSrc: e.target.value || null })
                }
                placeholder="https://.../logo.png"
              />
            </div>
            {draft.theme.logoSrc && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTheme({ logoSrc: null })}
              >
                Remove
              </Button>
            )}
          </div>
        </CardContent>
      </Card>


      {/* Colors */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="size-5 text-primary" />
            Colors &amp; shape
          </CardTitle>
          <CardDescription>
            Brand (primary) color, accent color and corner radius.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorRow
              label="Brand (primary) color"
              value={draft.theme.primary}
              onForegroundChange={(fg) => setTheme({ primaryForeground: fg })}
              foregroundValue={draft.theme.primaryForeground}
              onChange={(v) => setTheme({ primary: v })}
            />
            <ColorRow
              label="Accent color"
              value={draft.theme.accent}
              onForegroundChange={(fg) => setTheme({ accentForeground: fg })}
              foregroundValue={draft.theme.accentForeground}
              onChange={(v) => setTheme({ accent: v })}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="radius">
                Corner radius — {draft.theme.radius}px
              </Label>
            </div>
            <input
              id="radius"
              type="range"
              min={0}
              max={24}
              step={1}
              value={draft.theme.radius}
              onChange={(e) => setTheme({ radius: Number(e.target.value) })}
              className="w-full accent-[var(--primary)]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="palette">Background palette</Label>
            <select
              id="palette"
              value={draft.theme.paletteKey}
              onChange={(e) => setTheme({ paletteKey: e.target.value })}
              className="w-full rounded-lg border border-border bg-background p-2.5 text-sm"
            >
              {Object.entries(BACKGROUND_PRESETS).map(([key, p]) => (
                <option key={key} value={key}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>


      {/* Dashboard canvas settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LayoutGrid className="size-5 text-primary" />
            Dashboard canvas
          </CardTitle>
          <CardDescription>
            Grid density and AI-managed arrangement for the whole team.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="columns">Grid columns</Label>
              <select
                id="columns"
                value={draft.canvas.columns}
                onChange={(e) =>
                  setCanvas({ columns: Number(e.target.value) })
                }
                className="w-full rounded-lg border border-border bg-background p-2.5 text-sm"
              >
                {[8, 10, 12, 16].map((c) => (
                  <option key={c} value={c}>
                    {c} columns
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="rowHeight">
                  Row height — {draft.canvas.rowHeight}px
                </Label>
              </div>
              <input
                id="rowHeight"
                type="range"
                min={80}
                max={160}
                step={8}
                value={draft.canvas.rowHeight}
                onChange={(e) =>
                  setCanvas({ rowHeight: Number(e.target.value) })
                }
                className="w-full accent-[var(--primary)]"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/20 px-3 py-2.5">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="size-4 text-primary" />
                AI-managed dashboard
              </p>
              <p className="text-xs text-muted-foreground">
                Highlights and supports AI-assisted layout for the whole team.
              </p>
            </div>
            <Switch
              checked={draft.canvas.aiManaged}
              onCheckedChange={(v) => setCanvas({ aiManaged: v })}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft(DEFAULT_APPEARANCE)}
            >
              <RotateCcw className="size-3.5" />
              Reset to default
            </Button>
            <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Save changes
            </Button>
            {status === 'saved' && (
              <span className="text-xs font-medium text-primary">Saved</span>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  )
}

function ColorRow({
  label,
  value,
  foregroundValue,
  onChange,
  onForegroundChange,
}: {
  label: string
  value: string
  foregroundValue: string
  onChange: (v: string) => void
  onForegroundChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="size-9 cursor-pointer rounded-md border border-border bg-transparent"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground"
        />
      </div>
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">On-color text</Label>
        <input
          type="color"
          value={foregroundValue}
          onChange={(e) => onForegroundChange(e.target.value)}
          className="size-7 cursor-pointer rounded border border-border bg-transparent"
        />
      </div>
    </div>
  )
}

