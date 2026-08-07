'use client'

import { useState, useEffect, useCallback } from 'react'
import { NODE_DEFINITIONS } from '@/components/nodes/definitions'
import type { NodeField, NodePort } from '@/components/nodes/types'

export interface ActivepiecesPiece {
  name: string
  type: string
  category: string
  icon: string
  color: string
}

export interface NodeDefinition {
  typeId: string
  category: 'input' | 'processing' | 'output'
  name: string
  description: string
  color: string
  icon: string
  fields: NodeField[]
  ports: NodePort[]
  defaultConfig?: Record<string, unknown>
}

const CATEGORY_MAP: Record<string, 'input' | 'processing' | 'output'> = {
  'trigger': 'input',
  'ai': 'processing',
  'logic': 'processing',
  'action': 'output',
}

const FALLBACK_PIECES: ActivepiecesPiece[] = [
  // Triggers
  { name: 'Telegram Trigger', type: 'telegram', category: 'trigger', icon: '✈️', color: '#229ED9' },
  { name: 'WhatsApp Trigger', type: 'whatsapp', category: 'trigger', icon: '💬', color: '#25D366' },
  { name: 'Webhook Trigger', type: 'webhook', category: 'trigger', icon: '🔗', color: '#8B5CF6' },
  { name: 'Email Trigger', type: 'email_trigger', category: 'trigger', icon: '📧', color: '#EA580C' },
  { name: 'Schedule Trigger', type: 'schedule', category: 'trigger', icon: '⏰', color: '#F59E0B' },
  { name: 'HTTP Request Trigger', type: 'http_trigger', category: 'trigger', icon: '🌐', color: '#3B82F6' },
  { name: 'Slack Trigger', type: 'slack_trigger', category: 'trigger', icon: '💼', color: '#4A154B' },
  { name: 'Discord Trigger', type: 'discord_trigger', category: 'trigger', icon: '🎮', color: '#5865F2' },
  { name: 'GitHub Trigger', type: 'github_trigger', category: 'trigger', icon: '🐙', color: '#181717' },
  { name: 'Stripe Trigger', type: 'stripe_trigger', category: 'trigger', icon: '💳', color: '#635BFF' },
  
  // AI & Logic
  { name: 'AI Agent', type: 'ai_agent', category: 'ai', icon: '🤖', color: '#EAB308' },
  { name: 'HITL Gate', type: 'hitl_gate', category: 'ai', icon: '👤', color: '#EF4444' },
  { name: 'Metrics', type: 'metrics', category: 'ai', icon: '📊', color: '#3B82F6' },
  { name: 'Transform', type: 'transform', category: 'logic', icon: '🔄', color: '#A855F7' },
  { name: 'Condition', type: 'condition', category: 'logic', icon: '🔀', color: '#06B6D4' },
  { name: 'Code', type: 'code', category: 'logic', icon: '💻', color: '#6366F1' },
  { name: 'Loop', type: 'loop', category: 'logic', icon: '🔁', color: '#EC4899' },
  { name: 'Delay', type: 'delay', category: 'logic', icon: '⏱️', color: '#6B7280' },
  { name: 'Router', type: 'router', category: 'logic', icon: '🔀', color: '#F97316' },
  
  // Actions
  { name: 'Send Email', type: 'send_email', category: 'action', icon: '📧', color: '#EA580C' },
  { name: 'HTTP Request', type: 'http_request', category: 'action', icon: '📡', color: '#6366F1' },
  { name: 'Database', type: 'database', category: 'action', icon: '🗄️', color: '#3ECF8E' },
  { name: 'Slack Send', type: 'slack_send', category: 'action', icon: '💼', color: '#4A154B' },
  { name: 'Telegram Send', type: 'telegram_send', category: 'action', icon: '✈️', color: '#229ED9' },
  { name: 'WhatsApp Send', type: 'whatsapp_send', category: 'action', icon: '💬', color: '#25D366' },
  { name: 'Discord Send', type: 'discord_send', category: 'action', icon: '🎮', color: '#5865F2' },
  { name: 'GitHub Action', type: 'github_action', category: 'action', icon: '🐙', color: '#181717' },
  { name: 'Stripe Action', type: 'stripe_action', category: 'action', icon: '💳', color: '#635BFF' },
  { name: 'Google Sheets', type: 'google_sheets', category: 'action', icon: '📊', color: '#34A853' },
  { name: 'Notion', type: 'notion', category: 'action', icon: '📝', color: '#000000' },
  { name: 'Airtable', type: 'airtable', category: 'action', icon: '📋', color: '#18BFFF' },
  { name: 'Supabase', type: 'supabase', category: 'action', icon: '🗄️', color: '#3ECF8E' },
  { name: 'PostgreSQL', type: 'postgresql', category: 'action', icon: '🐘', color: '#4169E1' },
  { name: 'MySQL', type: 'mysql', category: 'action', icon: '🐬', color: '#4479A7' },
  { name: 'Redis', type: 'redis', category: 'action', icon: '🔴', color: '#DC382D' },
  { name: 'AWS S3', type: 'aws_s3', category: 'action', icon: '☁️', color: '#FF9900' },
  { name: 'Twilio', type: 'twilio', category: 'action', icon: '📞', color: '#F22F46' },
  { name: 'SendGrid', type: 'sendgrid', category: 'action', icon: '📧', color: '#1A82F2' },
  { name: 'Mailgun', type: 'mailgun', category: 'action', icon: '📮', color: '#FF6B35' },
  { name: 'Zendesk', type: 'zendesk', category: 'action', icon: '🏢', color: '#03363D' },
  { name: 'Intercom', type: 'intercom', category: 'action', icon: '💬', color: '#1F8DED' },
  { name: 'HubSpot', type: 'hubspot', category: 'action', icon: '🎯', color: '#FF7A59' },
  { name: 'Salesforce', type: 'salesforce', category: 'action', icon: '☁️', color: '#00A1E0' },
  { name: 'Shopify', type: 'shopify', category: 'action', icon: '🛍️', color: '#96BF48' },
  { name: 'WordPress', type: 'wordpress', category: 'action', icon: '📝', color: '#21759B' },
  { name: 'FTP', type: 'ftp', category: 'action', icon: '📁', color: '#FF6B35' },
  { name: 'SFTP', type: 'sftp', category: 'action', icon: '🔒', color: '#00D4AA' },
  { name: 'Google Drive', type: 'google_drive', category: 'action', icon: '📁', color: '#4285F4' },
  { name: 'Dropbox', type: 'dropbox', category: 'action', icon: '📦', color: '#0061FF' },
  { name: 'OneDrive', type: 'onedrive', category: 'action', icon: '☁️', color: '#0078D4' },
]

export function useActivepiecesNodes() {
  const [pieces, setPieces] = useState<ActivepiecesPiece[]>(FALLBACK_PIECES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPieces = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch('/api/activepieces/pieces')
      
      if (!response.ok) {
        throw new Error('Failed to fetch Activepieces pieces')
      }
      
      const data = await response.json()
      
      if (data.pieces && Array.isArray(data.pieces)) {
        setPieces(data.pieces)
      } else {
        throw new Error('Invalid response format')
      }
    } catch (err) {
      console.error('Error fetching Activepieces pieces:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
      // Use fallback pieces so nodes still show up
      setPieces(FALLBACK_PIECES)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPieces()
  }, [fetchPieces])

  // Convert Activepieces pieces to node definitions
  const getNodeDefinitions = useCallback((): Record<string, NodeDefinition> => {
    const definitions: Record<string, NodeDefinition> = { ...NODE_DEFINITIONS }

    // Add dynamic pieces from Activepieces
    pieces.forEach((piece) => {
      const typeId = piece.type
      
      // Skip if already defined
      if (definitions[typeId]) return

      const category = CATEGORY_MAP[piece.category] || 'processing'
      
      // Determine ports based on category
      let ports: NodePort[] = []
      if (category === 'input') {
        ports = [{ id: 'out', label: 'Output', type: 'output' }]
      } else if (category === 'output') {
        ports = [{ id: 'in', label: 'Input', type: 'input' }]
      } else {
        ports = [
          { id: 'in', label: 'Input', type: 'input' },
          { id: 'out', label: 'Output', type: 'output' },
        ]
      }

      definitions[typeId] = {
        typeId,
        category,
        name: piece.name,
        description: `${piece.name} node`,
        color: piece.color,
        icon: piece.icon,
        fields: [],
        ports,
        defaultConfig: {},
      }
    })

    return definitions
  }, [pieces])

  const nodeDefinitions = getNodeDefinitions()

  return { nodeDefinitions, loading, error }
}
