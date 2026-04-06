import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { assessEligibility } from '@/lib/claude'

export async function POST(req: NextRequest) {
  try {
    const { achievement } = await req.json()

    if (!achievement) {
      return NextResponse.json({ error: 'Achievement text is required' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: criteria } = await supabase
      .from('eligibility_criteria')
      .select('criteria_name, criteria_description')
      .eq('is_active', true)

    if (!criteria || criteria.length === 0) {
      return NextResponse.json({ 
        error: 'No active criteria found. Please add criteria first.' 
      }, { status: 400 })
    }

    const mockCandidate = {
      name: 'Test User',
      achievement_summary: achievement,
      proof_link: 'https://example.com/proof',
      industry: 'Professional',
      linkedin_url: 'https://linkedin.com/in/test',
    }

    const result = await assessEligibility(mockCandidate, criteria)
    return NextResponse.json(result)

  } catch (error: any) {
    console.error('Test criteria error:', error)
    return NextResponse.json({ 
      error: error.message || 'Failed to test criteria' 
    }, { status: 500 })
  }
}