/**
 * Widget Registry — maps each WidgetType to its rendering metadata and
 * a lazily-loaded React component.
 */

import type { ComponentType } from 'react'
import dynamic from 'next/dynamic'
import type { DashboardWidget, WidgetDefinition } from './types'
import {
  BarChart3,
  CreditCard,
  Timer,
  AlertTriangle,
  FileText,
  Globe,
  ClipboardCheck,
  MessagesSquare,
  TrendingUp,} from 'lucide-react'

export interface WidgetRegistryEntry {
  definition: WidgetDefinition
  component: ComponentType<{ widget: DashboardWidget; data: unknown }>
}

// ─── Lazy-loaded widget components ─────────────────────────────────────────
const TokenConsumptionWidget = dynamic(() => import('./token-consumption-widget').then((m) => m.TokenConsumptionWidget), { ssr: false })
const CostPerSessionWidget = dynamic(() => import('./cost-per-session-widget').then((m) => m.CostPerSessionWidget), { ssr: false })
const LatencyWidget = dynamic(() => import('./latency-widget').then((m) => m.LatencyWidget), { ssr: false })
const ErrorRateWidget = dynamic(() => import('./error-rate-widget').then((m) => m.ErrorRateWidget), { ssr: false })
const TracesWidget = dynamic(() => import('./traces-widget').then((m) => m.TracesWidget), { ssr: false })
const PlatformUsageWidget = dynamic(() => import('./platform-usage-widget').then((m) => m.PlatformUsageWidget), { ssr: false })
const ResolutionRateWidget = dynamic(() => import('./resolution-rate-widget').then((m) => m.ResolutionRateWidget), { ssr: false })
const MessageVolumeWidget = dynamic(() => import('./message-volume-widget').then((m) => m.MessageVolumeWidget), { ssr: false })
const ConversationSourcesWidget = dynamic(() => import('./conversation-sources-widget').then((m) => m.ConversationSourcesWidget), { ssr: false })
const CustomMetricWidget = dynamic(() => import('./custom-metric-widget').then((m) => m.CustomMetricWidget), { ssr: false })

export {
  TokenConsumptionWidget,
  CostPerSessionWidget,
  LatencyWidget,
  ErrorRateWidget,
  TracesWidget,
  PlatformUsageWidget,
  ResolutionRateWidget,
  MessageVolumeWidget,
  ConversationSourcesWidget,
  CustomMetricWidget,
  }

export const WIDGET_DEFINITIONS: Record<string, WidgetDefinition> = {
  'token-consumption': {
    type: 'token-consumption', name: 'Token Consumption',
    description: 'Conversation volume and auto-resolved vs. escalated split over time.',
    icon: MessagesSquare, defaultWidth: 4, defaultHeight: 3,
    defaultDataSource: { nodeType: 'conversations' }, defaultRange: '30d', viewType: 'chart',
  },
  'cost-per-session': {
    type: 'cost-per-session', name: 'Cost Per Session',
    description: 'Estimated cost breakdown per connected channel.',
    icon: CreditCard, defaultWidth: 2, defaultHeight: 3,
    defaultDataSource: { nodeType: 'telemetry_metrics' }, defaultRange: '30d', viewType: 'chart',
  },
  latency: {
    type: 'latency', name: 'Latency',
    description: 'Average first-token response time trend.',
    icon: Timer, defaultWidth: 4, defaultHeight: 3,
    defaultDataSource: { nodeType: 'telemetry_metrics' }, defaultRange: '30d', viewType: 'chart',
  },
  'error-rate': {
    type: 'error-rate', name: 'Error Rate',
    description: 'Percentage of sessions with errors in the selected period.',
    icon: AlertTriangle, defaultWidth: 2, defaultHeight: 2,
    defaultDataSource: { nodeType: 'telemetry_metrics' }, defaultRange: '7d', viewType: 'metric',
  },
  traces: {
    type: 'traces', name: 'Recent Traces',
    description: 'Last 50 telemetry events for the selected tenant.',
    icon: FileText, defaultWidth: 4, defaultHeight: 3,
    defaultDataSource: { nodeType: 'telemetry_events' }, defaultRange: '7d', viewType: 'table',
  },
  'platform-usage': {
    type: 'platform-usage', name: 'Platform Usage',
    description: 'Conversation counts grouped by connected platform.',
    icon: Globe, defaultWidth: 2, defaultHeight: 3,
    defaultDataSource: { nodeType: 'conversations' }, defaultRange: '30d', viewType: 'chart',
  },
  'resolution-rate': {
    type: 'resolution-rate', name: 'Resolution Rate',
    description: 'Auto-resolved vs. escalated over time.',
    icon: ClipboardCheck, defaultWidth: 4, defaultHeight: 3,
    defaultDataSource: { nodeType: 'conversations' }, defaultRange: '30d', viewType: 'chart',
  },
  'message-volume': {
    type: 'message-volume', name: 'Message Volume',
    description: 'Total messages handled per channel.',
    icon: BarChart3, defaultWidth: 2, defaultHeight: 3,
    defaultDataSource: { nodeType: 'telemetry_metrics' }, defaultRange: '30d', viewType: 'chart',
  },
  'conversation-sources': {
    type: 'conversation-sources', name: 'Knowledge Sources',
    description: 'Where answers are grounded — pie chart of source types.',
    icon: BarChart3, defaultWidth: 2, defaultHeight: 3,
    defaultDataSource: { nodeType: 'telemetry_metrics' }, defaultRange: '30d', viewType: 'chart',
  },
  'custom-metric': {
    type: 'custom-metric', name: 'Custom Metric',
    description: 'Track any custom metric like deflection rate, tickets resolved, CSAT, etc.',
    icon: TrendingUp, defaultWidth: 2, defaultHeight: 2,
    defaultDataSource: { nodeType: 'telemetry_metrics' }, defaultRange: '30d', viewType: 'metric',
  },
}

export const WIDGET_REGISTRY: Record<string, WidgetRegistryEntry> = Object.fromEntries(
  Object.entries(WIDGET_DEFINITIONS).map(([key, def]) => {
    const componentMap: Record<string, ComponentType<{ widget: DashboardWidget; data: unknown }>> = {
      'token-consumption': TokenConsumptionWidget, 'cost-per-session': CostPerSessionWidget,
      latency: LatencyWidget, 'error-rate': ErrorRateWidget, traces: TracesWidget,
      'platform-usage': PlatformUsageWidget, 'resolution-rate': ResolutionRateWidget,
      'message-volume': MessageVolumeWidget, 'conversation-sources': ConversationSourcesWidget,
      'custom-metric': CustomMetricWidget as ComponentType<{ widget: DashboardWidget; data: unknown }>,    }
    return [key, { definition: def, component: componentMap[key] }]
  }),
) as Record<string, WidgetRegistryEntry>

export function getWidgetDefinition(type: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY[type]?.definition
}

export function createDefaultWidget(type: string): DashboardWidget {
  const def = WIDGET_REGISTRY[type]?.definition
  if (!def) throw new Error(`Unknown widget type: ${type}`)
  return {
    id: `w_${Math.random().toString(36).substring(2, 11)}`,
    type: def.type, x: 0, y: 0, w: def.defaultWidth, h: def.defaultHeight,
    config: { title: def.name, range: def.defaultRange },
    dataSource: def.defaultDataSource,
  }
}

export function getAvailableWidgets(): WidgetDefinition[] {
  return Object.values(WIDGET_REGISTRY).map((e) => e.definition)
}

export function getWidgetComponent(type: string): ComponentType<{ widget: DashboardWidget; data: unknown }> | undefined {
  return WIDGET_REGISTRY[type]?.component
}

