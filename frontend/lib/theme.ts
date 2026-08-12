/**
 * Tenant theming & appearance system.
 *
 * The whole UI is driven by a set of CSS custom properties (--background,
 * --primary, --accent, --radius, etc.). This module centralises:
 *   - the default appearance (exactly the pre-installed look, so nothing
 *     changes until an admin customises it),
 *   - preset themes and background palettes,
 *   - a helper that turns an `Appearance` into CSS variables, applied at
 *     runtime on the document root by `<AppearanceProvider/>`.
 */

export type ThemeMode = 'dark' | 'light'

/** A named dark background palette (light tie-ins would also work later). */
export interface BackgroundPalette {
  name: string
  background: string
  card: string
  popover: string
  secondary: string
  muted: string
  sidebar: string
  sidebarAccent: string
}

/** The visual brand identity of a workspace. */
export interface BrandTheme {
  /** Human-readable product / company name shown in navigation. */
  brandName: string
  /** Optional image URL for a custom logo. When set it replaces the mark. */
  logoSrc: string | null
  /** A single character/emoji shown inside the fallback logo tile. */
  mark: string
  /** Brand (primary) color as a CSS color value. */
  primary: string
  primaryForeground: string
  /** Secondary/accent color as a CSS color value. */
  accent: string
  accentForeground: string
    /** Corner radius in px (0 = sharp, 24 = very rounded). */
  radius: number
  mode: ThemeMode
  /** Key into BACKGROUND_PRESETS. */
  paletteKey: string
  /** Optional granular overrides on top of the preset palette/theme. Keeping
   * this optional means stored appearances created before this field exists
   * still render exactly as before (the defaults below apply). */
  custom?: Customization
}

/** Granular, opt-in customizations that extend (not replace) the preset theme. */
export interface Customization {
  /** Explicit color-token overrides. When omitted, colors are derived from the
   * selected background `paletteKey` (the pre-installed look). */
  colors?: Partial<PaletteColors>
  /** Typography tweaks. */
  typography?: Partial<TypographyCustomization>
  /** Layout & density tweaks. */
  layout?: Partial<LayoutCustomization>
}

/** The full set of semantic color tokens emitted to `:root`. */
export interface PaletteColors {
  background: string
  foreground: string
  card: string
  cardForeground: string
  popover: string
  popoverForeground: string
  secondary: string
  secondaryForeground: string
  muted: string
  mutedForeground: string
  border: string
  input: string
  destructive: string
  ring: string
}

/** Typography customizations. Fonts use raw CSS font-family strings so any
 * web font (loaded via next/font or a <link>) can be referenced. */
export interface TypographyCustomization {
  font: string
  headingFont: string
  fontSize: number
  letterSpacing: number
  lineHeight: number
}

/** Layout / density customizations. */
export interface LayoutCustomization {
  density: 'compact' | 'default' | 'comfortable'
  maxWidth: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '7xl' | 'full'
  shadow: 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  animation: 'none' | 'smooth' | 'performance'
}

/** Default color tokens for the pre-installed "Default Slate" palette. Kept in
 * sync with the values `themeToCssVars` derived historically so the default
 * appearance never changes. */
export const DEFAULT_PALETTE_COLORS: PaletteColors = {
  background: '#22242e',
  foreground: '#f4f1ea',
  card: '#2a2d3a',
  cardForeground: '#f4f1ea',
  popover: '#2a2d3a',
  popoverForeground: '#f4f1ea',
  secondary: '#343748',
  secondaryForeground: '#f4f1ea',
  muted: '#313447',
  mutedForeground: '#a9a9b5',
  border: 'rgba(255, 255, 255, 0.10)',
  input: 'rgba(255, 255, 255, 0.14)',
  destructive: '#f87171',
  ring: '#e8c15a',
}

/** Default typography — exactly the current installed look (Inter body,
 * Space Grotesk headings, 16px base). */
export const DEFAULT_TYPOGRAPHY: TypographyCustomization = {
  font: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
  headingFont: 'var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif',
  fontSize: 16,
  letterSpacing: 0,
  lineHeight: 1.5,
}

/** Default layout/density — exactly the current installed look. */
export const DEFAULT_LAYOUT: LayoutCustomization = {
  density: 'default',
  maxWidth: '7xl',
  shadow: 'md',
  animation: 'smooth',
}

/** The pre-installed, un-customised theme. Every field here mirrors the values
 * the UI shipped with, so a workspace that never customises still looks the same. */
export const DEFAULT_CUSTOMIZATION: Customization = {
  colors: { ...DEFAULT_PALETTE_COLORS },
  typography: { ...DEFAULT_TYPOGRAPHY },
  layout: { ...DEFAULT_LAYOUT },
}

/** Dashboard-level layout settings (shared with the whole workspace). */
export interface CanvasSettings {
  /** Number of columns in the dashboard grid. */
  columns: number
  /** Pixel height of one grid row. */
  rowHeight: number
  /** When true, the dashboard highlights AI-managed arrangement. */
  aiManaged: boolean
}

/** The full persisted appearance object for a workspace. */
export interface Appearance {
  theme: BrandTheme
  canvas: CanvasSettings
}

/** A named, one-click theme template used in the Settings picker. */
export interface ThemePreset extends Partial<BrandTheme> {
  id: string
  name: string
}

/** The current, pre-installed theme — this is the DEFAULT so nothing breaks. */
export const DEFAULT_THEME: BrandTheme = {
  brandName: 'Relay',
    logoSrc: null,
  mark: 'R',
  primary: '#e8c15a',
  primaryForeground: '#221a05',
  accent: '#e8c15a',
  accentForeground: '#221a05',
  radius: 12,
  mode: 'dark',
  paletteKey: 'default',
  custom: { ...DEFAULT_CUSTOMIZATION },
}

export const DEFAULT_CANVAS: CanvasSettings = {
  columns: 12,
  rowHeight: 112,
  aiManaged: false,
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: DEFAULT_THEME,
  canvas: DEFAULT_CANVAS,
}

/** Dark background palettes — all keep light foreground so text stays legible. */
export const BACKGROUND_PRESETS: Record<string, BackgroundPalette> = {
  default: {
    name: 'Default Slate',
    background: '#22242e',
    card: '#2a2d3a',
    popover: '#2a2d3a',
    secondary: '#343748',
    muted: '#313447',
    sidebar: '#262935',
    sidebarAccent: '#343748',
  },
  midnight: {
    name: 'Midnight Blue',
    background: '#101827',
    card: '#182231',
    popover: '#182231',
    secondary: '#223043',
    muted: '#1d293c',
    sidebar: '#131c2b',
    sidebarAccent: '#223043',
  },
  graphite: {
    name: 'Graphite',
    background: '#1c1d22',
    card: '#26272e',
    popover: '#26272e',
    secondary: '#33343c',
    muted: '#2c2d34',
    sidebar: '#212227',
    sidebarAccent: '#33343c',
  },
  forest: {
    name: 'Forest',
    background: '#141d1a',
    card: '#1c2824',
    popover: '#1c2824',
    secondary: '#283832',
    muted: '#22302b',
    sidebar: '#182320',
    sidebarAccent: '#283832',
  },
}


/** One-click themes shown in the Settings picker. */
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'default',
    name: 'Default Gold',
    primary: '#e8c15a',
    primaryForeground: '#221a05',
    accent: '#e8c15a',
    accentForeground: '#221a05',
    radius: 12,
    paletteKey: 'default',
  },
  {
    id: 'ocean',
    name: 'Ocean Blue',
    primary: '#38bdf8',
    primaryForeground: '#06202e',
    accent: '#818cf8',
    accentForeground: '#131228',
    radius: 12,
    paletteKey: 'midnight',
  },
  {
    id: 'emerald',
    name: 'Emerald',
    primary: '#34d399',
    primaryForeground: '#04301f',
    accent: '#2dd4bf',
    accentForeground: '#04302c',
    radius: 12,
    paletteKey: 'forest',
  },
  {
    id: 'violet',
    name: 'Violet Pulse',
    primary: '#a78bfa',
    primaryForeground: '#1e1240',
    accent: '#f472b6',
    accentForeground: '#3d0b22',
    radius: 14,
    paletteKey: 'default',
  },
  {
    id: 'crimson',
    name: 'Crimson',
    primary: '#f87171',
    primaryForeground: '#3d0a0a',
    accent: '#fb923c',
    accentForeground: '#3d1a04',
    radius: 10,
    paletteKey: 'graphite',
  },
  {
    id: 'indigo',
    name: 'Indigo Night',
    primary: '#818cf8',
    primaryForeground: '#131228',
    accent: '#22d3ee',
    accentForeground: '#06303a',
    radius: 16,
    paletteKey: 'midnight',
  },
]

/** Apply a preset — brand name, mark and logo are preserved unless provided. */
export function applyThemePreset(
  preset: ThemePreset,
  current: BrandTheme,
): BrandTheme {
  return {
    ...current,
    ...preset,
    // A preset re-themes color/radius/palette but must NOT erase the brand
    // name, mark or logo the admin already configured.
        brandName: preset.brandName ?? current.brandName,
    mark: preset.mark ?? current.mark,
    logoSrc: current.logoSrc,
    custom: { ...DEFAULT_CUSTOMIZATION },
  } as BrandTheme
}

/** Pre-computed shadow swatches keyed by intensity. */
export const SHADOW_MAP: Record<NonNullable<LayoutCustomization['shadow']>, string> = {
  none: 'none',
  sm: '0 1px 2px 0 rgba(0,0,0,0.06),0 1px 3px 0 rgba(0,0,0,0.10)',
  md: '0 1px 3px 0 rgba(0,0,0,0.10),0 2px 8px 0 rgba(0,0,0,0.15)',
  lg: '0 4px 6px -1px rgba(0,0,0,0.10),0 2px 16px 0 rgba(0,0,0,0.15)',
  xl: '0 4px 12px 0 rgba(0,0,0,0.10),0 8px 24px 0 rgba(0,0,0,0.20)',
  '2xl': '0 8px 20px 0 rgba(0,0,0,0.12),0 16px 40px 0 rgba(0,0,0,0.22)',
}

export const MAX_WIDTH_MAP: Record<NonNullable<LayoutCustomization['maxWidth']>, string> = {
  sm: '640px',
  md: '720px',
  lg: '64rem',
  xl: '72rem',
  '2xl': '80rem',
  '7xl': '88rem',
  full: 'none',
}

export const ANIMATION_MAP: Record<NonNullable<LayoutCustomization['animation']>, string> = {
  none: '0s',
  smooth: '200ms ease',
  performance: '0s',
}

/** Light-mode palette used when `theme.mode === 'light'` and no explicit colour
 * overrides are provided. */
export const LIGHT_PALETTE_COLORS: PaletteColors = {
  background: '#f8fafc',
  foreground: '#0f172a',
  card: '#ffffff',
  cardForeground: '#0f172a',
  popover: '#ffffff',
  popoverForeground: '#0f172a',
  secondary: '#f1f5f9',
  secondaryForeground: '#0f172a',
  muted: '#f8fafc',
  mutedForeground: '#64748b',
  border: '#e2e8f0',
  input: '#cbd5e1',
  destructive: '#ef4444',
  ring: '#e8c15a',
}

/** Pull the palette-derived tokens (not brand colours) out of a BackgroundPalette. */
function paletteFrom(bg: BackgroundPalette): PaletteColors {
  return {
    background: bg.background,
    foreground: '#f4f1ea',
    card: bg.card,
    cardForeground: '#f4f1ea',
    popover: bg.popover,
    popoverForeground: '#f4f1ea',
    secondary: bg.secondary,
    secondaryForeground: '#f4f1ea',
    muted: bg.muted,
    mutedForeground: '#a9a9b5',
    border: 'rgba(255, 255, 255, 0.10)',
    input: 'rgba(255, 255, 255, 0.14)',
    destructive: '#f87171',
    ring: '#e8c15a',
  }
}

/** Resolve the semantic palette to emit, honoring custom overrides. */
export function resolvePalette(theme: BrandTheme): PaletteColors {
  const custom = theme.custom ?? DEFAULT_CUSTOMIZATION
  const overrides = custom.colors ?? {}
  const darkBase = {
    ...DEFAULT_PALETTE_COLORS,
    ...paletteFrom(BACKGROUND_PRESETS[theme.paletteKey] ?? BACKGROUND_PRESETS.default),
  }
  const isLight = theme.mode === 'light'
  const base = isLight ? LIGHT_PALETTE_COLORS : darkBase
  const fg = isLight ? '#0f172a' : '#f4f1ea'
  const mutedFg = isLight ? '#64748b' : '#a9a9b5'
  return {
    background: overrides.background ?? base.background,
    foreground: overrides.foreground ?? fg,
    card: overrides.card ?? base.card,
    cardForeground: overrides.cardForeground ?? fg,
    popover: overrides.popover ?? base.popover,
    popoverForeground: overrides.popoverForeground ?? fg,
    secondary: overrides.secondary ?? base.secondary,
    secondaryForeground: overrides.secondaryForeground ?? fg,
    muted: overrides.muted ?? base.muted,
    mutedForeground: overrides.mutedForeground ?? mutedFg,
    border: overrides.border ?? base.border,
    input: overrides.input ?? base.input,
    destructive: overrides.destructive ?? base.destructive,
    ring: overrides.ring ?? theme.primary,
  }
}

/** Convert an Appearance into CSS custom-property overrides for `:root`. */
export function themeToCssVars(appearance: Appearance): Record<string, string> {
  const theme = appearance.theme
  const palette = resolvePalette(theme)
  const custom = theme.custom ?? DEFAULT_CUSTOMIZATION
  const typography = { ...DEFAULT_TYPOGRAPHY, ...(custom.typography ?? {}) }
  const layout = { ...DEFAULT_LAYOUT, ...(custom.layout ?? {}) }
  const darkPalette = BACKGROUND_PRESETS[theme.paletteKey] ?? BACKGROUND_PRESETS.default

  return {
    'color-scheme': theme.mode === 'light' ? 'light' : 'dark',
    '--background': palette.background,
    '--foreground': palette.foreground,
    '--card': palette.card,
    '--card-foreground': palette.cardForeground,
    '--popover': palette.popover,
    '--popover-foreground': palette.popoverForeground,
    '--primary': theme.primary,
    '--primary-foreground': theme.primaryForeground,
    '--accent': theme.accent,
    '--accent-foreground': theme.accentForeground,
    '--secondary': palette.secondary,
    '--secondary-foreground': palette.secondaryForeground,
    '--muted': palette.muted,
    '--muted-foreground': palette.mutedForeground,
    '--border': palette.border,
    '--input': palette.input,
    '--ring': palette.ring,
    '--sidebar': darkPalette.sidebar,
    '--sidebar-foreground': palette.foreground,
    '--sidebar-primary': theme.primary,
    '--sidebar-primary-foreground': theme.primaryForeground,
    '--sidebar-accent': darkPalette.sidebarAccent,
    '--sidebar-accent-foreground': palette.secondaryForeground,
    '--sidebar-border': palette.border,
    '--sidebar-ring': palette.ring,
    '--chart-1': theme.primary,
    '--chart-2': theme.accent,
    '--chart-3': '#6b7280',
    '--chart-4': '#8b5cf6',
    '--chart-5': '#14b8a6',
    '--radius': `${theme.radius}px`,
    '--radius-sm': `calc(var(--radius) * 0.6)`,
    '--radius-md': `calc(var(--radius) * 0.8)`,
    '--radius-lg': `var(--radius)`,
    '--radius-xl': `calc(var(--radius) * 1.4)`,
    '--radius-2xl': `calc(var(--radius) * 1.8)`,
    '--radius-3xl': `calc(var(--radius) * 2.2)`,
    '--radius-4xl': `calc(var(--radius) * 2.6)`,
    '--destructive': palette.destructive,
    // Typography (driven live via CSS in globals.css)
    '--app-font-family': typography.font,
    '--app-heading-family': typography.headingFont,
    '--app-font-size': `${typography.fontSize}px`,
    '--app-letter-spacing': `${typography.letterSpacing}em`,
    '--app-line-height': String(typography.lineHeight),
    // Layout / density
    '--app-density': layout.density,
    '--app-max-width': MAX_WIDTH_MAP[layout.maxWidth],
    '--app-shadow': SHADOW_MAP[layout.shadow],
    '--app-animation': ANIMATION_MAP[layout.animation],
  }
}

