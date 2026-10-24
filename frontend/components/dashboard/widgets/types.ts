/**
 * Dashboard widget type definitions.
 *
 * A widget is a pluggable panel that renders a chart, metric, or table
 * and optionally pulls real data from a backend metric node or Supabase.
 */

import type { LucideIcon } from 'lucide-react'

/** Unique widget type identifiers — used to look up the rendering component. */
export type WidgetType =
  | 'token-consumption'
  | 'cost-per-session'
  | 'latency'
  | 'error-rate'
  | 'traces'
  | 'platform-usage'
  | 'resolution-rate'
  | 'message-volume'
  | 'conversation-sources'
    | 'custom-metric'
  | 'dynamic-metric'
  | 'ai-coder'

/** The data source a widget reads from — mirrors the backend metric nodes. */
export interface DataSourceRef {
  /** The node type identifier (e.g. "conversations", "telemetry_metrics", "telemetry_events") */
  nodeType: string
  /** Optional filter expression applied server-side */
  filter?: Record<string, unknown>
}

/**
 * Per-widget configuration — what to display, time range, etc.
 * Stored as JSON in Supabase alongside the layout position.
 */
export interface WidgetConfig {
  /** Human-readable title shown in the widget header */
  title?: string
  /** Optional one-line description rendered under the title */
  description?: string
  /** Time range key: '7d' | '14d' | '30d' | '90d' */
  range?: string
  /** Optional accent color (CSS value) drawn as a widget highlight bar */
  accent?: string
  /** When true the AI is allowed to auto-tune this widget's range/layout */
  aiManaged?: boolean
  /** Extra options specific to the widget type */
  [key: string]: unknown
}

/** Describes an editable field for the generic widget config panel. */
export interface WidgetConfigField {
  /** Config key this field edits (e.g. 'metricField') */
  key: string
  label: string
  type: 'text' | 'color' | 'range' | 'toggle' | 'select'
  /** For select fields, the allowed values */
  options?: { value: string; label: string }[]
  placeholder?: string
  min?: number
  max?: number
}

/** A single widget on the dashboard canvas. */
export interface DashboardWidget {
  /** Stable UUID for this widget instance on the canvas */
  id: string
  /** Widget type — used to look up the rendering component in the registry */
  type: WidgetType
  /** Canvas position (grid units, 1-unit = 100px) */
  x: number
  y: number
  /** Grid size in columns/rows (w = width, h = height) */
  w: number
  h: number
  /** Widget-specific configuration */
  config: WidgetConfig
  /** Which backend data source(s) this widget reads from */
  dataSource?: DataSourceRef
}

/** The full persisted dashboard layout for one tenant. */
export interface DashboardLayout {
  /** Tenant / workspace id the layout belongs to */
  tenantId: string
  /** Ordered list of widgets on the canvas */
  widgets: DashboardWidget[]
  /** Layout version for future migrations */
  version: number
}

/** Registry metadata for a widget type — describes how to render it. */
export interface WidgetDefinition {
  type: WidgetType
  name: string
  description: string
  icon: LucideIcon
  defaultWidth: number
  defaultHeight: number
  defaultDataSource: DataSourceRef
  defaultRange: string
  /** Whether this widget is a chart vs. a metric card vs. a table */
  viewType: 'chart' | 'metric' | 'table'
  /** Extra configurable fields shown in the generic widget config panel */
  configSchema?: WidgetConfigField[]
}
