import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'
    
    const response = await fetch(`${API_BASE}/activepieces/pieces`, {
      next: { revalidate: 300 } // Cache for 5 minutes
    })
    
    if (!response.ok) {
      throw new Error(`Failed to fetch pieces: ${response.statusText}`)
    }
    
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching Activepieces pieces:', error)
    return NextResponse.json(
      { error: 'Failed to fetch pieces' },
      { status: 500 }
    )
  }
}