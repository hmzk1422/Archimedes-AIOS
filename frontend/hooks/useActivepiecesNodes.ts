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

export function useActivepiecesNodes() {
  const [pieces, setPieces] = useState<ActivepiecesPiece[]>([])
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
      // Remote pieces unavailable: the palette is backed solely by the
      // canonical NODE_DEFINITIONS catalog. Previously a separate 50-entry
      // fallback list was merged on top using fields: [] and defaultConfig: {},
      // which created empty duplicate nodes (ai_agent vs ai-agent, send_email
      // vs email, hitl_gate vs hitl-gate, delay/router/loop with no args).
      // A single source of truth ensures every node has real arguments.
      setPieces([])
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

    // Index canonical nodes by normalized name & normalized type id so that
    // hyphen vs underscore conventions (ai-agent vs ai_agent, email vs
    // send_email, hitl-gate vs hitl_gate, http-response vs http_request) and
    // differing type ids (delay) are treated as the SAME node and never
    // produce empty-field duplicates on the palette.
    const normalize = (s: string) =>
      (s || '').toLowerCase().replace(/[\s\-_]+/g, '')
    const existingNames = new Set<string>()
    const existingTypes = new Set<string>()
    Object.values(definitions).forEach((def) => {
      existingNames.add(normalize(def.name))
      existingTypes.add(normalize(def.typeId))
    })

    // Add dynamic pieces from Activepieces
    pieces.forEach((piece) => {
      const typeId = piece.type

      // Skip if already defined (by type id or by normalized type id)
      if (definitions[typeId]) return
      if (existingTypes.has(normalize(typeId))) return

      // Skip if this would duplicate a canonical node by NAME. This prevents
      // "AI Agent" (type ai-agent) vs "AI Agent" (type ai_agent) etc.
      if (piece.name && existingNames.has(normalize(piece.name))) return

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
      existingNames.add(normalize(piece.name))
      existingTypes.add(normalize(typeId))
    })

    return definitions
  }, [pieces])

  const nodeDefinitions = getNodeDefinitions()

  return { nodeDefinitions, loading, error }
}
