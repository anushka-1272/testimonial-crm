'use client'

import { useEffect, useState } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'

type Criteria = {
  id: string
  criteria_name: string
  criteria_description: string
  is_active: boolean
  created_at: string
}

export default function CriteriaPage() {
    const supabase = createBrowserSupabaseClient()
  const [criteriaList, setCriteriaList] = useState<Criteria[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formActive, setFormActive] = useState(true)
  const [testInput, setTestInput] = useState('')
  const [testResult, setTestResult] = useState<any>(null)
  const [testLoading, setTestLoading] = useState(false)

  async function fetchCriteria() {
    const { data } = await supabase
      .from('eligibility_criteria')
      .select('*')
      .order('created_at', { ascending: true })
    setCriteriaList(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchCriteria() }, [])

  async function saveCriteria() {
    if (!formName || !formDesc) return alert('Please fill in all fields')
    if (editingId) {
      await supabase.from('eligibility_criteria').update({
        criteria_name: formName,
        criteria_description: formDesc,
        is_active: formActive,
      }).eq('id', editingId)
    } else {
      await supabase.from('eligibility_criteria').insert({
        criteria_name: formName,
        criteria_description: formDesc,
        is_active: formActive,
      })
    }
    setShowForm(false)
    setEditingId(null)
    setFormName('')
    setFormDesc('')
    setFormActive(true)
    fetchCriteria()
  }

  async function deleteCriteria(id: string) {
    if (!confirm('Delete this criteria?')) return
    await supabase.from('eligibility_criteria').delete().eq('id', id)
    fetchCriteria()
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('eligibility_criteria').update({ is_active: !current }).eq('id', id)
    fetchCriteria()
  }

  function startEdit(c: Criteria) {
    setEditingId(c.id)
    setFormName(c.criteria_name)
    setFormDesc(c.criteria_description)
    setFormActive(c.is_active)
    setShowForm(true)
  }

  async function testCriteria() {
    if (!testInput) return alert('Please enter a sample achievement')
    setTestLoading(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/test-criteria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ achievement: testInput }),
      })
      const data = await res.json()
      setTestResult(data)
    } catch (e) {
      setTestResult({ error: 'Failed to test' })
    }
    setTestLoading(false)
  }

  const activeCriteria = criteriaList.filter(c => c.is_active)
  const compiledPrompt = activeCriteria.length > 0
    ? activeCriteria.map((c, i) => `${i + 1}. ${c.criteria_name}: ${c.criteria_description}`).join('\n')
    : 'No active criteria yet.'

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-sm text-gray-500 uppercase tracking-wide">Settings</p>
            <h1 className="text-2xl font-bold text-gray-900">Eligibility Criteria</h1>
          </div>
          <div className="flex gap-3">
            <a href="/dashboard/eligibility" className="text-sm text-gray-600 hover:underline">← Eligibility</a>
            <button
              onClick={() => { setShowForm(true); setEditingId(null); setFormName(''); setFormDesc(''); setFormActive(true) }}
              className="bg-black text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
            >
              + Add Criteria
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left — Criteria Cards */}
          <div>
            <h2 className="text-sm font-semibold text-gray-600 uppercase mb-4">Active & Inactive Criteria</h2>
            {loading ? (
              <p className="text-gray-400">Loading...</p>
            ) : criteriaList.length === 0 ? (
              <p className="text-gray-400">No criteria added yet.</p>
            ) : (
              <div className="space-y-4">
                {criteriaList.map(c => (
                  <div key={c.id} className={`bg-white rounded-xl border p-5 ${!c.is_active ? 'opacity-50' : ''}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">{c.criteria_name}</h3>
                        <p className="text-sm text-gray-600 mt-1">{c.criteria_description}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <button
                          onClick={() => toggleActive(c.id, c.is_active)}
                          className={`text-xs px-3 py-1 rounded-full font-medium ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                        >
                          {c.is_active ? 'Active' : 'Inactive'}
                        </button>
                        <div className="flex gap-2">
                          <button onClick={() => startEdit(c)} className="text-xs text-blue-600 hover:underline">Edit</button>
                          <button onClick={() => deleteCriteria(c.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right — Compiled Prompt + Test */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl border p-5">
              <h2 className="text-sm font-semibold text-gray-600 uppercase mb-3">Compiled Claude Prompt Preview</h2>
              <p className="text-xs text-gray-400 mb-3">This is exactly what Claude evaluates candidates against:</p>
              <pre className="bg-gray-50 rounded-lg p-4 text-xs text-gray-700 whitespace-pre-wrap font-mono">{compiledPrompt}</pre>
            </div>

            <div className="bg-white rounded-xl border p-5">
              <h2 className="text-sm font-semibold text-gray-600 uppercase mb-3">Test Criteria</h2>
              <p className="text-xs text-gray-400 mb-3">Paste a sample achievement to see what score Claude gives:</p>
              <textarea
                value={testInput}
                onChange={e => setTestInput(e.target.value)}
                placeholder="e.g. I got a job at Google as a software engineer with 40% salary hike after completing the program..."
                className="w-full border rounded-lg p-3 text-sm h-28 resize-none focus:outline-none focus:ring-2 focus:ring-black"
              />
              <button
                onClick={testCriteria}
                disabled={testLoading}
                className="mt-3 bg-black text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 w-full"
              >
                {testLoading ? 'Testing...' : 'Test with Claude AI'}
              </button>
              {testResult && (
                <div className={`mt-4 p-4 rounded-lg ${testResult.recommendation === 'eligible' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">{testResult.recommendation === 'eligible' ? '✅ Eligible' : '❌ Not Eligible'}</span>
                    <span className="text-lg font-bold">{testResult.score}/100</span>
                  </div>
                  <p className="text-sm text-gray-700">{testResult.reason}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Add/Edit Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-lg">
              <h2 className="text-lg font-bold mb-4">{editingId ? 'Edit Criteria' : 'Add New Criteria'}</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Criteria Name</label>
                  <input
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="e.g. Minimum Achievement Quality"
                    className="w-full border rounded-lg p-3 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Criteria Description</label>
                  <textarea
                    value={formDesc}
                    onChange={e => setFormDesc(e.target.value)}
                    placeholder="Describe in detail what Claude should look for..."
                    className="w-full border rounded-lg p-3 text-sm mt-1 h-32 resize-none focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={formActive} onChange={e => setFormActive(e.target.checked)} id="active" />
                  <label htmlFor="active" className="text-sm text-gray-700">Active (Claude will use this criteria)</label>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={saveCriteria} className="flex-1 bg-black text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-800">
                  {editingId ? 'Save Changes' : 'Add Criteria'}
                </button>
                <button onClick={() => setShowForm(false)} className="flex-1 border py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}