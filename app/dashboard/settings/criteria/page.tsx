"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAccessControl } from "@/components/access-control-context";
import { logActivity } from "@/lib/activity-logger";
import { getUserSafe } from "@/lib/supabase-auth";
import { modalOverlayClass, modalPanelClass } from "@/lib/modal-responsive";
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
  const { canEditCurrentPage, showViewOnlyBadge } = useAccessControl();
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
      const authEd = await getUserSafe(supabase);
      if (authEd) {
        await logActivity({
          supabase,
          user: authEd,
          action_type: "settings",
          entity_type: "eligibility_criteria",
          entity_id: editingId,
          description: `Updated eligibility criteria: ${formName}`,
        });
      }
    } else {
      const { data: ins } = await supabase
        .from("eligibility_criteria")
        .insert({
          criteria_name: formName,
          criteria_description: formDesc,
          is_active: formActive,
        })
        .select("id")
        .single();
      const authAdd = await getUserSafe(supabase);
      if (authAdd && ins?.id) {
        await logActivity({
          supabase,
          user: authAdd,
          action_type: "settings",
          entity_type: "eligibility_criteria",
          entity_id: ins.id,
          description: `Added eligibility criteria: ${formName}`,
        });
      }
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
    const c = criteriaList.find((x) => x.id === id);
    await supabase.from("eligibility_criteria").delete().eq("id", id);
    const authDel = await getUserSafe(supabase);
    if (authDel && c) {
      await logActivity({
        supabase,
        user: authDel,
        action_type: "settings",
        entity_type: "eligibility_criteria",
        entity_id: id,
        description: `Deleted eligibility criteria: ${c.criteria_name}`,
      });
    }
    void fetchCriteria();
  }

  async function toggleActive(id: string, current: boolean) {
    const c = criteriaList.find((x) => x.id === id);
    await supabase
      .from("eligibility_criteria")
      .update({ is_active: !current })
      .eq("id", id);
    const authTog = await getUserSafe(supabase);
    if (authTog && c) {
      await logActivity({
        supabase,
        user: authTog,
        action_type: "settings",
        entity_type: "eligibility_criteria",
        entity_id: id,
        description: `Updated eligibility criteria: ${c.criteria_name}`,
        metadata: { is_active: !current },
      });
    }
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
      <header className="sticky top-14 z-30 bg-[#f5f5f7]/90 px-4 py-4 backdrop-blur-md sm:px-6 sm:py-5 lg:top-0 lg:px-8 lg:py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
              Eligibility criteria
            </h1>
            <p className="mt-1 text-sm text-[#6e6e73]">
              Manage AI evaluation rules for candidates
            </p>
          </div>
          <div className="-mx-1 flex flex-nowrap items-center gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
            <Link
              href="/dashboard/settings/team"
              className="shrink-0 text-sm font-medium text-[#6e6e73] transition-all hover:text-[#1d1d1f]"
            >
              Team
            </Link>
            <Link
              href="/dashboard/settings/criteria"
              className="shrink-0 text-sm font-medium text-[#1d1d1f]"
            >
              Criteria
            </Link>
            <Link
              href="/dashboard/settings/roster"
              className="shrink-0 text-sm font-medium text-[#6e6e73] transition-all hover:text-[#1d1d1f]"
            >
              Roster
            </Link>
            <Link
              href="/dashboard/settings/deleted-entries"
              className="shrink-0 text-sm font-medium text-[#6e6e73] transition-all hover:text-[#1d1d1f]"
            >
              Deleted Entries
            </Link>
            {showViewOnlyBadge ? (
              <span className="rounded-full bg-[#f3f4f6] px-3 py-1 text-xs font-medium text-[#6b7280]">
                View only
              </span>
            ) : null}
            {canEditCurrentPage ? (
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
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-10 pt-2 text-sm text-[#1d1d1f] sm:px-6 lg:px-8 lg:pb-12">
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
                          {canEditCurrentPage ? (
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
                          ) : null}
                        </div>
                        <div className="flex gap-4">
                          {canEditCurrentPage ? (
                            <>
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
                            </>
                          ) : null}
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
              {canEditCurrentPage ? (
                <button
                  type="button"
                  onClick={() => void testCriteria()}
                  disabled={testLoading}
                  className="mt-3 w-full rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#2d2d2f] disabled:opacity-50"
                >
                  {testLoading ? "Testing…" : "Run test"}
                </button>
              ) : null}
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

        {showForm && canEditCurrentPage && (
          <div className={modalOverlayClass}>
            <button
              type="button"
              className="absolute inset-0"
              aria-label="Close form"
              onClick={() => setShowForm(false)}
            />
            <div
              className={`${modalPanelClass} p-6 shadow-[0_4px_16px_rgba(0,0,0,0.08)]`}
            >
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
