'use client'

import { useEffect, useState } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'
import Link from 'next/link'

type Period = 'total' | 'monthly' | 'weekly'
const INTERVIEWERS = ['Harika', 'Gargi', 'Mudit', 'Anushka']

function getDateRange(period: Period) {
  const now = new Date()
  if (period === 'weekly') {
    const day = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
    monday.setHours(0, 0, 0, 0)
    return monday.toISOString()
  }
  if (period === 'monthly') {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  }
  return null
}

export default function DashboardPage() {
  const supabase = createBrowserSupabaseClient()
  const [period, setPeriod] = useState<Period>('total')
  const [stats, setStats] = useState({ testimonials: 0, projects: 0, dispatches: 0, entries: 0, calls: 0 })
  const [interviewer, setInterviewer] = useState<Record<string, number>>({})
  const [funnel, setFunnel] = useState({ entries: 0, eligible: 0, scheduled: 0, completed: 0, dispatched: 0 })
  const [activity, setActivity] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  async function fetchStats() {
    setLoading(true)
    const from = getDateRange(period)

    let entriesQ = supabase.from('candidates').select('*', { count: 'exact', head: true })
    if (from) entriesQ = entriesQ.gte('created_at', from)
    const { count: entries } = await entriesQ

    let callsQ = supabase.from('candidates').select('*', { count: 'exact', head: true }).eq('eligibility_status', 'eligible')
    if (from) callsQ = callsQ.gte('created_at', from)
    const { count: calls } = await callsQ

    let testQ = supabase.from('interviews').select('*', { count: 'exact', head: true }).eq('interview_status', 'completed').eq('interview_type', 'testimonial')
    if (from) testQ = testQ.gte('created_at', from)
    const { count: testimonials } = await testQ

    let projQ = supabase.from('interviews').select('*', { count: 'exact', head: true }).eq('interview_status', 'completed').eq('interview_type', 'project')
    if (from) projQ = projQ.gte('created_at', from)
    const { count: projects } = await projQ

    let dispQ = supabase.from('dispatch').select('*', { count: 'exact', head: true })
    if (from) dispQ = dispQ.gte('created_at', from)
    const { count: dispatches } = await dispQ

    setStats({
      testimonials: testimonials || 0,
      projects: projects || 0,
      dispatches: dispatches || 0,
      entries: entries || 0,
      calls: calls || 0,
    })

    const ivStats: Record<string, number> = {}
    for (const iv of INTERVIEWERS) {
      let q = supabase.from('interviews').select('*', { count: 'exact', head: true }).eq('interviewer', iv).eq('interview_status', 'completed')
      if (from) q = q.gte('created_at', from)
      const { count } = await q
      ivStats[iv] = count || 0
    }
    setInterviewer(ivStats)

    const { count: fEntries } = await supabase.from('candidates').select('*', { count: 'exact', head: true })
    const { count: fEligible } = await supabase.from('candidates').select('*', { count: 'exact', head: true }).eq('eligibility_status', 'eligible')
    const { count: fScheduled } = await supabase.from('interviews').select('*', { count: 'exact', head: true })
    const { count: fCompleted } = await supabase.from('interviews').select('*', { count: 'exact', head: true }).eq('interview_status', 'completed')
    const { count: fDispatched } = await supabase.from('dispatch').select('*', { count: 'exact', head: true })
    setFunnel({ entries: fEntries || 0, eligible: fEligible || 0, scheduled: fScheduled || 0, completed: fCompleted || 0, dispatched: fDispatched || 0 })

    const { data: recentCandidates } = await supabase.from('candidates').select('full_name, eligibility_status, created_at').order('created_at', { ascending: false }).limit(5)
    const { data: recentInterviews } = await supabase.from('interviews').select('interview_status, created_at, interviewer').order('created_at', { ascending: false }).limit(5)
    const combined = [
      ...(recentCandidates || []).map(c => ({ type: 'candidate', label: `${c.full_name} — ${c.eligibility_status}`, time: c.created_at })),
      ...(recentInterviews || []).map(i => ({ type: 'interview', label: `Interview ${i.interview_status} — ${i.interviewer}`, time: i.created_at })),
    ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 10)
    setActivity(combined)
    setLoading(false)
  }

  useEffect(() => { fetchStats() }, [period])

  const funnelSteps = [
    { label: 'Entries', value: funnel.entries },
    { label: 'Eligible', value: funnel.eligible },
    { label: 'Scheduled', value: funnel.scheduled },
    { label: 'Completed', value: funnel.completed },
    { label: 'Dispatched', value: funnel.dispatched },
  ]
  const maxFunnel = Math.max(...funnelSteps.map(s => s.value), 1)

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Testimonial CRM</h1>
            <p className="text-sm text-gray-500">Dashboard Overview</p>
          </div>
          <nav className="flex gap-4 text-sm">
            <Link href="/dashboard/eligibility" className="text-gray-600 hover:text-black">Eligibility</Link>
            <Link href="/dashboard/interviews" className="text-gray-600 hover:text-black">Interviews</Link>
            <Link href="/dashboard/dispatch" className="text-gray-600 hover:text-black">Dispatch</Link>
            <Link href="/dashboard/settings/criteria" className="text-gray-600 hover:text-black">Settings</Link>
          </nav>
        </div>

        <div className="flex gap-2 mb-6">
          {(['total', 'monthly', 'weekly'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${period === p ? 'bg-black text-white' : 'bg-white border text-gray-600 hover:bg-gray-50'}`}>
              {p}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { label: 'Testimonial Interviews', value: stats.testimonials, color: 'bg-blue-50 text-blue-700' },
                { label: 'Project Interviews', value: stats.projects, color: 'bg-purple-50 text-purple-700' },
                { label: 'Dispatches', value: stats.dispatches, color: 'bg-yellow-50 text-yellow-700' },
                { label: 'Form Entries', value: stats.entries, color: 'bg-gray-50 text-gray-700' },
                { label: 'Calls Done', value: stats.calls, color: 'bg-green-50 text-green-700' },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-xl border p-5">
                  <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                  <p className="text-3xl font-bold text-gray-900">{loading ? '—' : s.value}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-2 inline-block ${s.color}`}>{period}</span>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl border p-5">
              <h2 className="text-sm font-semibold text-gray-600 uppercase mb-4">Interviewer Performance</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b">
                    <th className="pb-2 font-medium">Interviewer</th>
                    <th className="pb-2 font-medium text-right">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {INTERVIEWERS.map(iv => (
                    <tr key={iv} className="border-b last:border-0">
                      <td className="py-3 font-medium text-gray-800">{iv}</td>
                      <td className="py-3 text-right text-gray-600">{loading ? '—' : interviewer[iv] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-xl border p-5">
              <h2 className="text-sm font-semibold text-gray-600 uppercase mb-4">Conversion Funnel (All Time)</h2>
              <div className="space-y-3">
                {funnelSteps.map((step, i) => {
                  const pct = Math.round((step.value / maxFunnel) * 100)
                  const conv = i > 0 && funnelSteps[i - 1].value > 0 ? Math.round((step.value / funnelSteps[i - 1].value) * 100) : null
                  return (
                    <div key={step.label}>
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>{step.label}</span>
                        <span>{step.value}{conv !== null ? ` (${conv}% from prev)` : ''}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-3">
                        <div className="bg-black h-3 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border p-5 h-fit">
            <h2 className="text-sm font-semibold text-gray-600 uppercase mb-4">Recent Activity</h2>
            {loading ? (
              <p className="text-gray-400 text-sm">Loading...</p>
            ) : activity.length === 0 ? (
              <p className="text-gray-400 text-sm">No activity yet.</p>
            ) : (
              <div className="space-y-3">
                {activity.map((a, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${a.type === 'candidate' ? 'bg-blue-400' : 'bg-green-400'}`} />
                    <div>
                      <p className="text-sm text-gray-800">{a.label}</p>
                      <p className="text-xs text-gray-400">{new Date(a.time).toLocaleDateString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}