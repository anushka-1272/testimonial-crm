"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useRef, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity-logger";
import { getUserSafe } from "@/lib/supabase-auth";
import { SLACK_RIANKA_EMAIL } from "@/lib/slack-contacts";
import { voidSlackNotify } from "@/lib/slack-client";
import { sendWatiNotification } from "@/lib/wati-client";
import type { TestimonialInterviewType } from "@/lib/testimonial-interview-type";

import {
  type InterviewWithCandidate,
  type ProjectInterviewWithProjectCandidate,
  isProjectInterviewRow,
} from "./types";

const CATEGORIES = [
  "Salary Hike / Promotion",
  "Job Switch / Better Opportunity",
  "First Job / Early Career Win",
  "Career Gap Breaker",
  "Domain / Industry Switch",
  "Senior Professional (10-20 yrs exp)",
  "Leadership Role (Director / VP / CXO)",
  "Mid-career Revival (40+ / 50+)",
  "Productivity / Task Automation",
  "Business Growth via AI",
  "Non-tech Building Tech Skills",
  "Award / Achievement",
] as const;

const FUNNELS = [
  "AI Tools",
  "Python",
  "SQL",
  "Excel",
  "Power BI",
] as const;

const REWARD_AIRPODS = "AirPods";
const REWARD_JBL = "JBL Clip 5";
const REWARD_NO_DISPATCH = "No Dispatch";

const NO_DISPATCH_COMMENT_NOTE =
  "Eligible; no physical dispatch (reward item: No Dispatch).";

type RewardChoice = "airpods" | "jbl" | "other" | "no_dispatch";

function parseStoredCategories(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  const lines = raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = lines.filter((s) =>
    (CATEGORIES as readonly string[]).includes(s),
  );
  if (valid.length) return valid;
  const single = raw.trim();
  if ((CATEGORIES as readonly string[]).includes(single)) return [single];
  return [];
}

function serializeCategories(selected: string[]): string | null {
  if (!selected.length) return null;
  return selected.join("\n");
}

function hydrateRewardFromInterview(
  rewardItem: string | null | undefined,
  interviewType: TestimonialInterviewType,
): { choice: RewardChoice; otherText: string } {
  const r = rewardItem?.trim();
  if (r === REWARD_NO_DISPATCH) return { choice: "no_dispatch", otherText: "" };
  if (r === REWARD_AIRPODS) {
    return {
      choice: interviewType === "project" ? "jbl" : "airpods",
      otherText: "",
    };
  }
  if (r === REWARD_JBL) return { choice: "jbl", otherText: "" };
  if (r) return { choice: "other", otherText: r };
  return {
    choice: interviewType === "project" ? "jbl" : "airpods",
    otherText: "",
  };
}

function resolveRewardItemForDb(
  choice: RewardChoice,
  otherText: string,
): string | null {
  switch (choice) {
    case "airpods":
      return REWARD_AIRPODS;
    case "jbl":
      return REWARD_JBL;
    case "no_dispatch":
      return REWARD_NO_DISPATCH;
    case "other": {
      const t = otherText.trim();
      return t || null;
    }
    default:
      return null;
    }
}

function shippingRequired(choice: RewardChoice): boolean {
  return choice !== "no_dispatch";
}

function rewardFieldsValid(choice: RewardChoice, otherText: string): boolean {
  if (choice === "other") return otherText.trim().length > 0;
  return true;
}

function watiCandidatePhoneAndName(
  interview: InterviewWithCandidate | ProjectInterviewWithProjectCandidate,
): { phone: string | null; name: string } {
  if (isProjectInterviewRow(interview)) {
    const pc = interview.project_candidates;
    return {
      phone: pc?.whatsapp_number?.trim() || null,
      name:
        pc?.full_name?.trim() ||
        pc?.project_title?.trim() ||
        pc?.email ||
        "Candidate",
    };
  }
  const c = interview.candidates;
  return {
    phone: c?.whatsapp_number?.trim() || null,
    name: c?.full_name?.trim() || c?.email || "Candidate",
  };
}

function missingColumnError(
  message: string | undefined,
  table: "dispatch" | "project_dispatch",
  column: "dispatch_status" | "status",
): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes(`column '${column}'`) ||
    lower.includes(`column ${table}.${column}`) ||
    lower.includes(`column "${table}"."${column}"`) ||
    lower.includes(`column ${column}`)
  );
}

type DispatchRowPick = {
  id: string;
  shipping_address: string | null;
  reward_item?: string | null;
  created_at?: string | null;
};

function pickProjectDispatchRow(rows: DispatchRowPick[]): DispatchRowPick | null {
  if (!rows.length) return null;
  const withAddress = rows.find((r) => r.shipping_address?.trim());
  return withAddress ?? rows[0]!;
}

function isInterviewAlreadyCompleted(
  interview:
    | InterviewWithCandidate
    | ProjectInterviewWithProjectCandidate,
): boolean {
  if (interview.completed_at?.trim()) return true;
  return interview.interview_status === "completed";
}

type Props = {
  open: boolean;
  interview:
    | InterviewWithCandidate
    | ProjectInterviewWithProjectCandidate
    | null;
  supabase: SupabaseClient;
  onClose: () => void;
  onSaved: () => void;
  onToast?: (message: string) => void;
};

const rewardCardsAll: {
  id: RewardChoice;
  icon: string;
  label: string;
}[] = [
  { id: "airpods", icon: "🎧", label: REWARD_AIRPODS },
  { id: "jbl", icon: "🔊", label: REWARD_JBL },
  { id: "other", icon: "✏️", label: "Other" },
  { id: "no_dispatch", icon: "🚫", label: "No Dispatch" },
];

function rewardCardsForInterview(
  interview:
    | InterviewWithCandidate
    | ProjectInterviewWithProjectCandidate
    | null,
) {
  if (interview && isProjectInterviewRow(interview)) {
    return rewardCardsAll.filter((c) => c.id !== "airpods");
  }
  return rewardCardsAll;
}

function headerNameAndEmail(
  interview:
    | InterviewWithCandidate
    | ProjectInterviewWithProjectCandidate,
): { name: string | undefined; email: string | undefined } {
  if (isProjectInterviewRow(interview)) {
    const pc = interview.project_candidates;
    const email = pc?.email;
    const title = pc?.project_title?.trim();
    let name: string | undefined;
    if (title) name = title;
    else if (email) {
      const local = email.split("@")[0] ?? "";
      if (local)
        name = local.charAt(0).toUpperCase() + local.slice(1);
    }
    return { name, email: email ?? undefined };
  }
  return {
    name: interview.candidates?.full_name ?? undefined,
    email: interview.candidates?.email,
  };
}

export function PostInterviewDrawer({
  open,
  interview,
  supabase,
  onClose,
  onSaved,
  onToast,
}: Props) {
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [funnel, setFunnel] = useState("");
  const [comments, setComments] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [existingDispatchId, setExistingDispatchId] = useState<string | null>(
    null,
  );
  const [dispatchHydrated, setDispatchHydrated] = useState(false);
  const [rewardChoice, setRewardChoice] = useState<RewardChoice>("airpods");
  const [rewardOtherText, setRewardOtherText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const categoryRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !interview) return;
    setEligible(
      typeof interview.post_interview_eligible === "boolean"
        ? interview.post_interview_eligible
        : null,
    );
    setError(null);
    setSelectedCategories(
      isProjectInterviewRow(interview)
        ? []
        : parseStoredCategories(interview.category),
    );
    const f = interview.funnel?.trim() ?? "";
    setFunnel((FUNNELS as readonly string[]).includes(f) ? f : "");
    setComments(interview.comments ?? "");
    const hydrated = hydrateRewardFromInterview(
      interview.reward_item,
      interview.interview_type,
    );
    let choice = hydrated.choice;
    if (isProjectInterviewRow(interview) && choice === "airpods")
      choice = "jbl";
    setRewardChoice(choice);
    setRewardOtherText(hydrated.otherText);
    setCategoryMenuOpen(false);
    setCategorySearch("");
  }, [open, interview?.id]);

  useEffect(() => {
    if (!open || !interview) {
      setExistingDispatchId(null);
      setShippingAddress("");
      setDispatchHydrated(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      setDispatchHydrated(false);
      setExistingDispatchId(null);
      setShippingAddress("");

      try {
        if (isProjectInterviewRow(interview)) {
          const { data, error } = await supabase
            .from("project_dispatch")
            .select("id, shipping_address, reward_item, created_at")
            .eq("project_candidate_id", interview.project_candidate_id)
            .order("created_at", { ascending: false })
            .limit(10);

          if (error) throw error;
          const row = pickProjectDispatchRow(
            (data ?? []) as DispatchRowPick[],
          );
          if (!cancelled && row) {
            setExistingDispatchId(row.id);
            if (row.shipping_address?.trim()) {
              setShippingAddress(row.shipping_address.trim());
            }
          }
        } else {
          const { data, error } = await supabase
            .from("dispatch")
            .select("id, shipping_address, reward_item")
            .eq("candidate_id", interview.candidate_id)
            .maybeSingle();

          if (error) throw error;
          if (!cancelled && data) {
            setExistingDispatchId(data.id);
            if (data.shipping_address?.trim()) {
              setShippingAddress(data.shipping_address.trim());
            }
          }
        }
      } catch {
        if (!cancelled) {
          setError("Could not load existing shipping address.");
        }
      } finally {
        if (!cancelled) setDispatchHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, interview, supabase]);

  useEffect(() => {
    if (!categoryMenuOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const el = categoryRootRef.current;
      if (el && !el.contains(e.target as Node)) {
        setCategoryMenuOpen(false);
        setCategorySearch("");
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [categoryMenuOpen]);

  if (!open || !interview) return null;

  const isProject = isProjectInterviewRow(interview);
  const isEditMode = isInterviewAlreadyCompleted(interview);
  const { name, email } = headerNameAndEmail(interview);
  const rewardCards = rewardCardsForInterview(interview);

  const eligibleYesRequirementsMet =
    funnel.trim() !== "" &&
    rewardFieldsValid(rewardChoice, rewardOtherText) &&
    (!shippingRequired(rewardChoice) || shippingAddress.trim() !== "") &&
    (isProject || selectedCategories.length > 0);

  const submitDisabled =
    submitting ||
    !dispatchHydrated ||
    (eligible === true && !eligibleYesRequirementsMet);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (eligible === null) {
      setError("Please select whether the candidate is post-interview eligible.");
      return;
    }
    if (eligible === true) {
      if (!isProject && selectedCategories.length === 0) {
        setError("Select at least one category.");
        return;
      }
      if (!funnel.trim()) {
        setError("Select a funnel.");
        return;
      }
      if (!rewardFieldsValid(rewardChoice, rewardOtherText)) {
        setError("Specify the reward item for “Other”.");
        return;
      }
      if (shippingRequired(rewardChoice) && !shippingAddress.trim()) {
        setError("Shipping address is required for this reward selection.");
        return;
      }
    }

    const rewardItemForDb =
      eligible === true
        ? resolveRewardItemForDb(rewardChoice, rewardOtherText)
        : null;

    if (eligible === true && !rewardItemForDb) {
      setError("Select or specify a reward item.");
      return;
    }

    let commentsToSave = comments.trim() || null;
    if (eligible === true && rewardChoice === "no_dispatch") {
      commentsToSave = commentsToSave
        ? `${commentsToSave}\n\n${NO_DISPATCH_COMMENT_NOTE}`
        : NO_DISPATCH_COMMENT_NOTE;
    }

    setSubmitting(true);
    try {
      const completedAtIso =
        isEditMode && interview.completed_at?.trim()
          ? interview.completed_at.trim()
          : new Date().toISOString();
      const table = isProject ? "project_interviews" : "interviews";
      const { error: upErr } = await supabase
        .from(table)
        .update({
          interview_status: "completed",
          completed_at: completedAtIso,
          post_interview_eligible: eligible,
          reward_item: rewardItemForDb,
          category: isProject
            ? null
            : serializeCategories(selectedCategories),
          funnel: funnel.trim() || null,
          comments: commentsToSave,
        })
        .eq("id", interview.id);

      if (upErr) {
        setError(upErr.message);
        setSubmitting(false);
        return;
      }

      const candDisplay = isProject
        ? interview.project_candidates?.project_title?.trim() ||
          interview.project_candidates?.email ||
          "Candidate"
        : name?.trim() || interview.candidates?.email || "Candidate";
      const postLabel = eligible === true ? "Yes" : "No";
      let rewardLog: string;
      if (eligible !== true) rewardLog = "—";
      else if (rewardChoice === "no_dispatch") rewardLog = REWARD_NO_DISPATCH;
      else rewardLog = rewardItemForDb ?? "—";
      const authPi = await getUserSafe(supabase);
      if (authPi) {
        await logActivity({
          supabase,
          user: authPi,
          action_type: "interviews",
          entity_type: "interview",
          entity_id: interview.id,
          candidate_name: candDisplay,
          description: `Completed interview for ${candDisplay} — Post-eligible: ${postLabel}, Reward: ${rewardLog}`,
        });
      }

      if (!isEditMode) {
        const completedLabel = format(
          parseISO(completedAtIso),
          "MMMM d, yyyy h:mm a",
        );
        const riankaMsg =
          `🎬 Interview completed for *${candDisplay}*!\n` +
          `Please check for raw recordings and add to Post Production in the CRM.\n` +
          `*Interviewer:* ${interview.interviewer ?? "—"}\n` +
          `*Completed:* ${completedLabel}`;
        voidSlackNotify(supabase, SLACK_RIANKA_EMAIL, riankaMsg);

        const { phone: waPhone, name: waName } = watiCandidatePhoneAndName(interview);
        void (async () => {
          if (!waPhone) return;
          try {
            const ok = await sendWatiNotification(
              supabase,
              waPhone,
              "interview_completed",
              [{ name: "1", value: waName }],
            );
            if (!ok) onToast?.("WhatsApp notification failed to send");
          } catch (err) {
            console.error("WATI interview_completed:", err);
            onToast?.("WhatsApp notification failed to send");
          }
          if (eligible === false) {
            try {
              const ok2 = await sendWatiNotification(
                supabase,
                waPhone,
                "succcess_story_rejected",
                [{ name: "1", value: waName }],
              );
              if (!ok2) onToast?.("WhatsApp notification failed to send");
            } catch (err) {
              console.error("WATI succcess_story_rejected:", err);
              onToast?.("WhatsApp notification failed to send");
            }
          }
        })();
      }

      if (
        eligible === true &&
        rewardChoice !== "no_dispatch" &&
        shippingAddress.trim() &&
        rewardItemForDb
      ) {
        const dispatchFields = {
          shipping_address: shippingAddress.trim(),
          reward_item: rewardItemForDb,
        };

        if (isProject) {
          if (existingDispatchId) {
            const { error: dErr } = await supabase
              .from("project_dispatch")
              .update(dispatchFields)
              .eq("id", existingDispatchId);
            if (dErr) {
              setError(dErr.message);
              setSubmitting(false);
              return;
            }
          } else {
            const baseDispatch = {
              project_candidate_id: interview.project_candidate_id,
              ...dispatchFields,
            };
            let { error: dErr } = await supabase.from("project_dispatch").insert({
              ...baseDispatch,
              dispatch_status: "pending",
            });
            if (
              dErr &&
              missingColumnError(dErr.message, "project_dispatch", "dispatch_status")
            ) {
              const retryWithStatus = await supabase.from("project_dispatch").insert({
                ...baseDispatch,
                status: "pending",
              });
              dErr = retryWithStatus.error;
              if (
                dErr &&
                missingColumnError(dErr.message, "project_dispatch", "status")
              ) {
                const retryWithoutStatus = await supabase
                  .from("project_dispatch")
                  .insert(baseDispatch);
                dErr = retryWithoutStatus.error;
              }
            }
            if (dErr) {
              setError(dErr.message);
              setSubmitting(false);
              return;
            }
          }
        } else if (existingDispatchId) {
          const { error: dErr } = await supabase
            .from("dispatch")
            .update(dispatchFields)
            .eq("id", existingDispatchId);
          if (dErr) {
            setError(dErr.message);
            setSubmitting(false);
            return;
          }
        } else {
          const { error: dErr } = await supabase.from("dispatch").insert({
            candidate_id: interview.candidate_id,
            ...dispatchFields,
            dispatch_status: "pending",
          });
          if (dErr) {
            setError(dErr.message);
            setSubmitting(false);
            return;
          }
        }
      }

      if (!isEditMode && email) {
        await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "interview_thankyou",
            to: email,
            name,
          }),
        });
      }

      setEligible(null);
      setSelectedCategories([]);
      setFunnel("");
      setComments("");
      setShippingAddress("");
      setRewardChoice("airpods");
      setRewardOtherText("");
      onSaved();
      onClose();
    } catch {
      setError("Something went wrong.");
    }
    setSubmitting(false);
  };

  const inp =
    "mt-1 w-full rounded-xl border border-border px-3 py-2.5 text-sm text-foreground focus:border-[#3b82f6] focus:outline-none focus:ring-0";

  const categorySearchLower = categorySearch.trim().toLowerCase();
  const filteredCategories = CATEGORIES.filter(
    (c) =>
      !categorySearchLower || c.toLowerCase().includes(categorySearchLower),
  );

  const toggleCategory = (c: string) => {
    setSelectedCategories((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  };

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-foreground/25 backdrop-blur-[1px]"
        aria-label="Close"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-none flex-col border-l border-border-subtle bg-elevated shadow-card sm:max-w-md">
        <div className="flex items-start justify-between border-b border-[#f5f5f5] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {isEditMode ? "Edit post-interview details" : "Complete interview"}
            </h2>
            <p className="text-sm text-muted">
              {name ?? "Candidate"} · Post-interview details
            </p>
          </div>
          <button
            type="button"
            className="rounded-xl p-2 text-muted/80 transition-all hover:bg-background hover:text-foreground"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex flex-1 flex-col overflow-hidden text-sm text-foreground"
        >
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {error && (
              <p className="rounded-xl border border-border-subtle bg-background px-3 py-2 text-sm text-foreground">
                {error}
              </p>
            )}

            <fieldset>
              <legend className="text-xs font-medium uppercase tracking-widest text-muted/80">
                Post-interview eligible?
              </legend>
              <div className="mt-2 flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="eligible"
                    checked={eligible === true}
                    onChange={() => setEligible(true)}
                  />
                  Yes
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="eligible"
                    checked={eligible === false}
                    onChange={() => setEligible(false)}
                  />
                  No
                </label>
              </div>
            </fieldset>

            {!isProject ? (
              <div className="block text-sm" ref={categoryRootRef}>
                <span className="text-xs font-medium uppercase tracking-widest text-muted/80">
                  Category
                  {eligible === true ? (
                    <span className="ml-1 font-normal normal-case text-[#dc2626]">
                      *
                    </span>
                  ) : null}
                </span>
                <div className="relative mt-1">
                  <button
                    type="button"
                    className={`${inp} flex w-full items-center justify-between text-left`}
                    aria-expanded={categoryMenuOpen}
                    aria-haspopup="listbox"
                    onClick={() =>
                      setCategoryMenuOpen((o) => {
                        const next = !o;
                        if (!next) setCategorySearch("");
                        return next;
                      })
                    }
                  >
                    <span
                      className={
                        selectedCategories.length
                          ? "text-foreground"
                          : "text-muted/80"
                      }
                    >
                      {selectedCategories.length
                        ? `${selectedCategories.length} selected`
                        : "Search and select categories…"}
                    </span>
                    <span className="text-muted/80" aria-hidden>
                      ▾
                    </span>
                  </button>
                  {selectedCategories.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {selectedCategories.map((c) => (
                        <li
                          key={c}
                          className="inline-flex max-w-full items-center gap-1 rounded-lg bg-background px-2 py-1 text-xs text-foreground"
                        >
                          <span className="truncate" title={c}>
                            {c}
                          </span>
                          <button
                            type="button"
                            className="shrink-0 rounded p-0.5 text-muted hover:bg-border hover:text-foreground"
                            aria-label={`Remove ${c}`}
                            onClick={() =>
                              setSelectedCategories((prev) =>
                                prev.filter((x) => x !== c),
                              )
                            }
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {categoryMenuOpen ? (
                    <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-hidden rounded-xl border border-border bg-elevated shadow-[0_8px_24px_rgba(0,0,0,0.1)]">
                      <input
                        type="search"
                        className="w-full border-b border-border-subtle px-3 py-2.5 text-sm text-foreground placeholder:text-muted/80 focus:outline-none focus:ring-0"
                        placeholder="Search categories…"
                        value={categorySearch}
                        onChange={(e) => setCategorySearch(e.target.value)}
                        autoFocus
                      />
                      <ul
                        className="max-h-48 overflow-y-auto py-1"
                        role="listbox"
                        aria-multiselectable="true"
                      >
                        {filteredCategories.length === 0 ? (
                          <li className="px-3 py-2 text-sm text-muted">
                            No matches
                          </li>
                        ) : (
                          filteredCategories.map((c) => {
                            const checked = selectedCategories.includes(c);
                            return (
                              <li key={c} role="option" aria-selected={checked}>
                                <label className="flex cursor-pointer items-start gap-2 px-3 py-2 text-sm hover:bg-background">
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 shrink-0"
                                    checked={checked}
                                    onChange={() => toggleCategory(c)}
                                  />
                                  <span className="leading-snug">{c}</span>
                                </label>
                              </li>
                            );
                          })
                        )}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <label className="block text-sm">
              <span className="text-xs font-medium uppercase tracking-widest text-muted/80">
                Funnel
                {eligible === true ? (
                  <span className="ml-1 font-normal normal-case text-[#dc2626]">
                    *
                  </span>
                ) : null}
              </span>
              <select
                className={inp}
                value={funnel}
                onChange={(e) => setFunnel(e.target.value)}
              >
                <option value="">Select funnel...</option>
                {FUNNELS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="text-xs font-medium uppercase tracking-widest text-muted/80">
                Comments
              </span>
              <textarea
                rows={3}
                className={inp}
                value={comments}
                onChange={(e) => setComments(e.target.value)}
              />
            </label>

            <div>
              <span className="text-xs font-medium uppercase tracking-widest text-muted/80">
                Reward item
                {eligible === true ? (
                  <span className="ml-1 font-normal normal-case text-[#dc2626]">
                    *
                  </span>
                ) : null}
              </span>
              <div
                className={`mt-2 grid gap-2 ${isProject ? "grid-cols-3" : "grid-cols-4"} ${eligible === true ? "" : "opacity-60"}`}
              >
                {rewardCards.map(({ id, icon, label }) => {
                  const selected = rewardChoice === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={eligible !== true}
                      onClick={() => {
                        setRewardChoice(id);
                        if (id !== "other") setRewardOtherText("");
                      }}
                      className={`flex flex-col items-center justify-center rounded-xl border p-3 text-center transition-colors ${
                        selected
                          ? "border-black bg-black text-white"
                          : "border-border bg-elevated text-foreground/80 hover:border-gray-300"
                      } disabled:cursor-not-allowed disabled:border-border disabled:opacity-40 disabled:text-muted`}
                    >
                      <span className="text-lg leading-none" aria-hidden>
                        {icon}
                      </span>
                      <span className="mt-1 text-[11px] font-medium leading-tight">
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted">
                Auto-selected based on interview type. You can change this.
              </p>
              {rewardChoice === "other" && eligible === true ? (
                <input
                  type="text"
                  className={inp}
                  placeholder="Specify item..."
                  value={rewardOtherText}
                  onChange={(e) => setRewardOtherText(e.target.value)}
                />
              ) : null}
            </div>

            <label className="block text-sm">
              <span className="text-xs font-medium uppercase tracking-widest text-muted/80">
                Shipping address
                {eligible === true && shippingRequired(rewardChoice) ? (
                  <span className="ml-1 font-normal normal-case text-[#dc2626]">
                    *
                  </span>
                ) : null}
              </span>
              <textarea
                rows={3}
                placeholder={
                  eligible === true && shippingRequired(rewardChoice)
                    ? "Full mailing address for dispatch"
                    : "Set Post-interview Eligible = Yes and choose a dispatch reward"
                }
                className={inp}
                disabled={!(eligible === true && shippingRequired(rewardChoice))}
                value={shippingAddress}
                onChange={(e) => setShippingAddress(e.target.value)}
              />
            </label>
          </div>

          <div className="border-t border-[#f5f5f5] px-5 py-3">
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl border border-border-subtle bg-elevated py-2.5 text-sm font-medium text-foreground transition-all hover:bg-background/80"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitDisabled}
                className="flex-1 rounded-xl bg-foreground py-2.5 text-sm font-medium text-background transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Save & mark completed"}
              </button>
            </div>
          </div>
        </form>
      </aside>
    </div>
  );
}
