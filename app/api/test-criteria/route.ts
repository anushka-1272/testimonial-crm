import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { assessEligibility, eligibilityCandidateFromDbRow } from '@/lib/claude'

export async function POST(req: NextRequest) {
  const { achievement } = await req.json()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: criteria } = await supabase
    .from('eligibility_criteria')
    .select('*')
    .eq('is_active', true)

  const mockCandidate = {
    full_name: 'Test User',
    achievement_type: 'Test',
    achievement_title: achievement,
    quantified_result: '',
    primary_goal: '',
    skills_modules_helped: '',
    how_program_helped: achievement,
    proof_document_url: '',
    role_before_program: '',
    linkedin_url: '',
  }

  const result = await assessEligibility(mockCandidate as any, criteria || [])
  return NextResponse.json(result)
}