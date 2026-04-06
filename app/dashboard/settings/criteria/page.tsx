"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

const cardChrome =
  "rounded-2xl bg-white p-6 shadow-[0_4px_16px_rgba(0,0,0,0.08)] border border-[#f0f0f0]";

type Criteria = {
  id: string;
  criteria_name: string;
  criteria_description: string;
  is_active: boolean;
  created_at: string;
};

export default function CriteriaPage() {
  const supabase = createBrowserSupabaseClient();
  const [criteriaList, setCriteriaList] = useState<Criteria[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(
    null,
  );
  const [testLoading, setTestLoading] = useState(false);

  async function fetchCriteria() {
    const { data } = await supabase
      .from("eligibility_criteria")
      .select("*")
      .order("created_at", { ascending: true });
    setCriteriaList(data || []);
    setLoading(false);
  }

  useEffect(() => {
    void fetchCriteria();
  }, []);

  async function saveCriteria() {
    if (!formName || !formDesc) return alert("Please fill in all fields");
    if (editingId) {
      await supabase
        .from("eligibility_criteria")
        .update({
          criteria_name: formName,
          criteria_description: formDesc,
          is_active: formActive,
        })
        .eq("id", editingId);
    } else {
      await supabase.from("eligibility_criteria").insert({
        criteria_name: formName,
        criteria_description: formDesc,
        is_active: formActive,
      });
    }
    setShowForm(false);
    setEditingId(null);
    setFormName("");
    setFormDesc("");
    setFormActive(true);
    void fetchCriteria();
  }

  async function deleteCriteria(id: string) {
    if (!confirm("Delete this criteria?")) return;
    await supabase.from("eligibility_criteria").delete().eq("id", id);
    void fetchCriteria();
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase
      .from("eligibility_criteria")
      .update({ is_active: !current })
      .eq("id", id);
    void fetchCriteria();
  }

  function startEdit(c: Criteria) {
    setEditingId(c.id);
    setFormName(c.criteria_name);
    setFormDesc(c.criteria_description);
    setFormActive(c.is_active);
    setShowForm(true);
  }

  async function testCriteria() {
    if (!testInput) return alert("Please enter a sample achievement");
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/test-criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ achievement: testInput }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      setTestResult(data);
    } catch {
      setTestResult({ error: "Failed to test" });
    }
    setTestLoading(false);
  }

  const activeCriteria = criteriaList.filter((c) => c.is_active);
  const compiledPrompt =
    activeCriteria.length > 0
      ? activeCriteria
          .map(
            (c, i) =>
              `${i + 1}. ${c.criteria_name}: ${c.criteria_description}`,
          )
          .join("\n")
      : "No active criteria yet.";

  const inputClass =
    "w-full rounded-xl border border-[#e5e5e5] px-3 py-2.5 text-sm text-[#1d1d1f] focus:border-[#3b82f6] focus:outline-none focus:ring-0";

  return (
    <>
      <header className="sticky top-0 z-30 bg-[#f5f5f7]/90 px-8 py-6 backdrop-blur-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
              Eligibility criteria
            </h1>
            <p className="mt-1 text-sm text-[#6e6e73]">
              Manage AI evaluation rules for candidates
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard/eligibility"
              className="text-sm font-medium text-[#3b82f6] transition-all hover:text-[#2563eb]"
            >
              ← Eligibility
            </Link>
            <button
              type="button"
              onClick={() => {
                setShowForm(true);
                setEditingId(null);
                setFormName("");
                setFormDesc("");
                setFormActive(true);
              }}
              className="rounded-xl bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#2d2d2f]"
            >
              Add criteria
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-8 pb-12 pt-2 text-sm text-[#1d1d1f]">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div>
            <h2 className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
              Active & inactive criteria
            </h2>
            {loading ? (
              <p className="mt-4 text-sm text-[#6e6e73]">Loading…</p>
            ) : criteriaList.length === 0 ? (
              <p className="mt-4 text-sm text-[#6e6e73]">
                No criteria added yet.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {criteriaList.map((c) => (
                  <div
                    key={c.id}
                    className={`${cardChrome} ${!c.is_active ? "opacity-70" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-[#1d1d1f]">
                          {c.criteria_name}
                        </h3>
                        <p className="mt-1 text-sm text-[#6e6e73]">
                          {c.criteria_description}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[#6e6e73]">
                            {c.is_active ? "Active" : "Inactive"}
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={c.is_active}
                            onClick={() => toggleActive(c.id, c.is_active)}
                            className={`relative h-7 w-11 shrink-0 rounded-full transition-colors ${
                              c.is_active ? "bg-[#1d1d1f]" : "bg-[#e5e5e5]"
                            }`}
                          >
                            <span
                              className={`pointer-events-none absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-all duration-200 ${
                                c.is_active
                                  ? "left-[calc(100%-1.625rem)]"
                                  : "left-0.5"
                              }`}
                            />
                          </button>
                        </div>
                        <div className="flex gap-4">
                          <button
                            type="button"
                            onClick={() => startEdit(c)}
                            className="text-xs font-medium text-[#3b82f6] transition-all hover:text-[#2563eb]"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteCriteria(c.id)}
                            className="text-xs font-medium text-[#ef4444] transition-all hover:text-[#dc2626]"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-6">
            <section className={cardChrome}>
              <h2 className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                Compiled prompt preview
              </h2>
              <p className="mt-1 text-sm text-[#6e6e73]">
                Text sent to the model for evaluation:
              </p>
              <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-[#f5f5f7] p-4 font-mono text-sm text-[#1d1d1f]">
                {compiledPrompt}
              </pre>
            </section>

            <section className={cardChrome}>
              <h2 className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                Test criteria
              </h2>
              <p className="mt-1 text-sm text-[#6e6e73]">
                Paste a sample achievement to preview scoring:
              </p>
              <textarea
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="e.g. I got a job at Google as a software engineer…"
                className={`mt-4 h-28 resize-none ${inputClass}`}
              />
              <button
                type="button"
                onClick={() => void testCriteria()}
                disabled={testLoading}
                className="mt-3 w-full rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#2d2d2f] disabled:opacity-50"
              >
                {testLoading ? "Testing…" : "Run test"}
              </button>
              {testResult && !testResult.error && (
                <div className="mt-4 rounded-xl border border-[#f0f0f0] bg-[#f5f5f7] p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                        testResult.recommendation === "eligible"
                          ? "bg-[#f0fdf4] text-[#16a34a]"
                          : "bg-[#fef2f2] text-[#dc2626]"
                      }`}
                    >
                      {testResult.recommendation === "eligible"
                        ? "Eligible"
                        : "Not eligible"}
                    </span>
                    <span className="text-lg font-bold tabular-nums text-[#1d1d1f]">
                      {String(testResult.score ?? "—")}/100
                    </span>
                  </div>
                  <p className="text-sm text-[#6e6e73]">
                    {String(testResult.reason ?? "")}
                  </p>
                </div>
              )}
              {testResult?.error ? (
                <p className="mt-4 text-sm text-[#6e6e73]">
                  {String(testResult.error)}
                </p>
              ) : null}
            </section>
          </div>
        </div>

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1d1d1f]/25 p-4 backdrop-blur-[1px]">
            <div className="w-full max-w-lg rounded-2xl border border-[#f0f0f0] bg-white p-6 shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
              <h2 className="text-lg font-semibold text-[#1d1d1f]">
                {editingId ? "Edit criteria" : "Add criteria"}
              </h2>
              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Name
                  </span>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Minimum achievement quality"
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                    Description
                  </span>
                  <textarea
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    placeholder="What the model should check…"
                    className={`mt-1 h-32 resize-none ${inputClass}`}
                  />
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={formActive}
                    onClick={() => setFormActive((a) => !a)}
                    className={`relative h-7 w-11 shrink-0 rounded-full transition-colors ${
                      formActive ? "bg-[#1d1d1f]" : "bg-[#e5e5e5]"
                    }`}
                  >
                    <span
                      className={`pointer-events-none absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-all duration-200 ${
                        formActive
                          ? "left-[calc(100%-1.625rem)]"
                          : "left-0.5"
                      }`}
                    />
                  </button>
                  <span className="text-sm text-[#6e6e73]">
                    Active (include in live evaluation)
                  </span>
                </div>
              </div>
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => void saveCriteria()}
                  className="flex-1 rounded-xl bg-[#1d1d1f] py-2.5 text-sm font-medium text-white transition-all hover:bg-[#2d2d2f]"
                >
                  {editingId ? "Save" : "Add"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 rounded-xl border border-[#f0f0f0] bg-white py-2.5 text-sm font-medium text-[#1d1d1f] transition-all hover:bg-[#fafafa]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
