/**
 * Shared data-processing utilities for dashboard widgets.
 *
 * The backend `/dashboard/widget-data/{tenant_id}` endpoint returns a flat
 * object with arrays of raw records keyed by data source type
 * (conversations, telemetry_metrics, telemetry_events, telemetry_evaluations).
 *
 * These utilities parse that raw data into chart-ready series, handling
 * both real data and graceful fallback when the data shape is incomplete.
 */

/** Raw widget-data payload returned by the backend. */
export interface WidgetDataPayload {
  status: string
  tenant_id: string
  conversations?: Record<string, unknown>[]
  telemetry_metrics?: Record<string, unknown>[]
  telemetry_events?: Record<string, unknown>[]
  telemetry_evaluations?: Record<string, unknown>[]
}

export interface TimeSeriesPoint {
  date: string
  [key: string]: unknown
}

export interface ChartSeries {
  key: string
  label: string
  color: string
  data: TimeSeriesPoint[]
}

/** Safe accessor — handles both string keys and nested objects. */
function getField(obj: Record<string, unknown> | unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined
  const o = obj as Record<string, unknown>
  return o[key]
}

/** Try multiple date field names. */
function extractDate(obj: Record<string, unknown>): Date | null {
  for (const k of ['timestamp', 'created_at', 'date', 'time', 'ts']) {
    const v = getField(obj, k)
    if (v) {
      const d = new Date(v as string)
      if (!isNaN(d.getTime())) return d
    }
  }
  return null
}

/** Try multiple numeric value fields. */
function extractNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = getField(obj, k)
    if (typeof v === 'number') return v
    if (typeof v === 'string') {
      const n = parseFloat(v)
      if (!isNaN(n)) return n
    }
  }
  return null
}

/**
 * Extract time-series data from a list of records.
 * Groups records by day and applies the value extractor.
 */
export function buildTimeSeries(
  records: Record<string, unknown>[] | undefined,
  valueKeys: string[],
  label: string,
  color: string,
  rangePoints: number = 30,
): TimeSeriesPoint[] {
  if (!records || records.length === 0) {
    return generateFallbackSeries(rangePoints, label)
  }

  const daily = new Map<string, { total: number; count: number }>()

  for (const rec of records) {
    const d = extractDate(rec as Record<string, unknown>)
    const v = extractNumber(rec as Record<string, unknown>, valueKeys)
    if (!d || v === null) continue

    const dayKey = d.toISOString().slice(0, 10)
    const existing = daily.get(dayKey)
    if (existing) {
      existing.total += v
      existing.count += 1
    } else {
      daily.set(dayKey, { total: v, count: 1 })
    }
  }

  // Sort by date and take the last `rangePoints` days
  const sortedKeys = Array.from(daily.keys()).sort()
  const recent = sortedKeys.slice(-rangePoints)

  return recent.map((day) => {
    const agg = daily.get(day)!
    return {
      date: day,
      [label]: Math.round(agg.total / agg.count),
    }
  })
}

/**
 * Extract bar-chart data from records grouped by a categorical field.
 */
export function buildBarData(
  records: Record<string, unknown>[] | undefined,
  categoryKey: string,
  valueKey: string,
  fallback: { name: string; value: number }[] = [],
): { name: string; value: number }[] {
  if (!records || records.length === 0) return fallback

  const grouped = new Map<string, number>()

  for (const rec of records) {
    const cat = String(getField(rec, categoryKey) || 'Unknown')
    const val = extractNumber(rec as Record<string, unknown>, [valueKey])
    if (val !== null) {
      grouped.set(cat, (grouped.get(cat) || 0) + val)
    }
  }

  if (grouped.size === 0) return fallback

  return Array.from(grouped.entries()).map(([name, value]) => ({ name, value }))
}

/**
 * Extract a single aggregated metric value from records.
 */
export function aggregateMetric(
  records: Record<string, unknown>[] | undefined,
  valueKey: string,
  type: 'avg' | 'sum' | 'max' | 'count' = 'avg',
): number | null {
  if (!records || records.length === 0) return null

  const values = records
    .map((r) => extractNumber(r as Record<string, unknown>, [valueKey]))
    .filter((v): v is number => v !== null)

  if (values.length === 0) return null

  switch (type) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'max':
      return Math.max(...values)
    case 'count':
      return values.length
    case 'avg':
    default:
      return values.reduce((a, b) => a + b, 0) / values.length
  }
}

/** Generate deterministic fallback time-series data (for preview/no-data state). */
function generateFallbackSeries(points: number, label: string): TimeSeriesPoint[] {
  const items: TimeSeriesPoint[] = []
  const today = new Date()
  for (let i = 0; i < points; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - (points - 1 - i))
    const base = 220 + Math.sin(i / 4) * 60 + (i * 37 % 90)
    items.push({
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      [label]: Math.round(base),
    })
  }
  return items
}

/** Get the range selector points. */
export function rangeToPoints(range: string): number {
  switch (range) {
    case '7d': return 7
    case '14d': return 14
    case '30d': return 30
    case '90d': return 90
    default: return 30
  }
}

export const RANGE_OPTIONS = [
  { key: '7d', label: '7 days' },
  { key: '14d', label: '14 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
] as const
