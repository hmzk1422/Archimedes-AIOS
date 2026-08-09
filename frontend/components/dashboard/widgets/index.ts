/**
 * Barrel export for the dashboard widget system.
 */
export type {
  WidgetType,
  DataSourceRef,
  WidgetConfig,
  DashboardWidget,
  DashboardLayout,
  WidgetDefinition,
} from './types'

export {
  WIDGET_REGISTRY,
  WIDGET_DEFINITIONS,
  getWidgetDefinition,
  createDefaultWidget,
  getAvailableWidgets,
  getWidgetComponent,
} from './widget-registry'

export type { WidgetRegistryEntry } from './widget-registry'
