'use client'

import { useState } from 'react'
import {
  Play,
  GitBranch,
  Brain,
  Zap,
  MessageSquare,
  Shield,
  BarChart3,
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// Activepieces basic nodes
export const activepiecesNodes = [
  {
    category: 'Triggers',
    nodes: [
      { type: 'webhook', label: 'Webhook', icon: Zap, description: 'Trigger on HTTP request' },
      { type: 'schedule', label: 'Schedule', icon: Play, description: 'Run on a schedule' },
      { type: 'event', label: 'Event', icon: Zap, description: 'Trigger on event' },
    ],
  },
  {
    category: 'Logic',
    nodes: [
      { type: 'condition', label: 'Condition', icon: GitBranch, description: 'If/else branching' },
      { type: 'loop', label: 'Loop', icon: GitBranch, description: 'Iterate over items' },
      { type: 'delay', label: 'Delay', icon: Play, description: 'Wait for duration' },
    ],
  },
  {
    category: 'AI',
    nodes: [
      { type: 'ai-agent', label: 'AI Agent', icon: Brain, description: 'Run AI model' },
      { type: 'ai-chat', label: 'AI Chat', icon: MessageSquare, description: 'Conversational AI' },
      { type: 'ai-classify', label: 'AI Classify', icon: Brain, description: 'Classify data' },
    ],
  },
]

// Platform-specific proprietary nodes
export const platformNodes = [
  {
    category: 'Human-in-the-Loop',
    nodes: [
      { type: 'hitl-approval', label: 'Approval Request', icon: Shield, description: 'Request human approval' },
      { type: 'hitl-input', label: 'User Input', icon: MessageSquare, description: 'Collect user input' },
      { type: 'hitl-review', label: 'Review Step', icon: Shield, description: 'Human review gate' },
    ],
  },
  {
    category: 'Metrics & Monitoring',
    nodes: [
      { type: 'metric-track', label: 'Track Metric', icon: BarChart3, description: 'Record custom metric' },
      { type: 'metric-alert', label: 'Alert', icon: BarChart3, description: 'Send alert on threshold' },
      { type: 'metric-dashboard', label: 'Dashboard Widget', icon: BarChart3, description: 'Add to dashboard' },
    ],
  },
]

interface NodePaletteProps {
  onSelectNode?: (nodeType: string) => void
}

export function NodePalette({ onSelectNode }: NodePaletteProps) {
  const [activeTab, setActiveTab] = useState<'activepieces' | 'platform'>('activepieces')
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)

  const currentNodes = activeTab === 'activepieces' ? activepiecesNodes : platformNodes

  return (
    <div className="w-full max-w-md space-y-4">
      {/* Tab Switcher */}
      <div className="flex rounded-lg border border-border bg-muted/50 p-1">
        <Button
          variant={activeTab === 'activepieces' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('activepieces')}
          className="flex-1"
        >
          Activepieces Nodes
        </Button>
        <Button
          variant={activeTab === 'platform' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('platform')}
          className="flex-1"
        >
          Platform Nodes
        </Button>
      </div>

      {/* Node List */}
      <div className="space-y-2">
        {currentNodes.map((category) => (
          <div key={category.category} className="rounded-lg border border-border">
            <Button
              variant="ghost"
              onClick={() => setExpandedCategory(expandedCategory === category.category ? null : category.category)}
              className="w-full justify-between p-3 h-auto"
            >
              <span className="font-medium text-sm">{category.category}</span>
              <ChevronDown
                className={cn(
                  'size-4 transition-transform',
                  expandedCategory === category.category && 'rotate-180'
                )}
              />
            </Button>

            {expandedCategory === category.category && (
              <div className="border-t border-border p-2 space-y-1">
                {category.nodes.map((node) => {
                  const Icon = node.icon
                  return (
                    <button
                      key={node.type}
                      onClick={() => onSelectNode?.(node.type)}
                      className="w-full flex items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-secondary/60"
                    >
                      <div className="mt-0.5 rounded-md bg-primary/12 p-1.5 text-primary">
                        <Icon className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{node.label}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {node.description}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
