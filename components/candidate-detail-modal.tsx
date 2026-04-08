"use client";

import { useEffect, useState } from "react";

import type { SupabaseClient } from "@supabase/supabase-js";

export type CandidateDetailRecord = {
  full_name: string | null;
  email: string;
  whatsapp_number: string | null;
  role_before_program: string | null;
  salary_before_program: string | null;
  achievement_type: string | null;
  achievement_title: string | null;
  quantified_result: string | null;
  how_program_helped: string | null;
  proof_document_url: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  ai_eligibility_score: number | null;
  ai_eligibility_reason: string | null;
};

const SELECT = [
  "full_name",
  "email",
  "whatsapp_number",
  "role_before_program",
  "salary_before_program",
  "achievement_type",
  "achievement_title",
  "quantified_result",
  "how_program_helped",
  "proof_document_url",
  "linkedin_url",
  "instagram_url",
  "ai_eligibility_score",
  "ai_eligibility_reason",
].join(", ");

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
        {label}
      </p>
      <div className="mt-1 text-sm text-[#1d1d1f]">{children}</div>
    </div>
  );
}

function textOrDash(value: string | null | undefined) {
  const t = value?.trim();
  return t ? (
    <span className="whitespace-pre-wrap break-words">{t}</span>
  ) : (
    <span className="text-[#6e6e73]">—</span>
  );
}

type Props = {
  open: boolean;
  candidateId: string | null;
  supabase: SupabaseClient | null;
  onClose: () => void;
};

export function CandidateDetailModal({
  open,
  candidateId,
  supabase,
  onClose,
}: Props) {
  const [data, setData] = useState<CandidateDetailRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !candidateId || !supabase) {
      setData(null);
      setFetchError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      setLoading(true);
      setFetchError(null);
      const { data: row, error } = await supabase
        .from("candidates")
        .select(SELECT)
        .eq("id", candidateId)
        .maybeSingle();

      if (cancelled) return;
      setLoading(false);
      if (error) {
        setFetchError(error.message);
        setData(null);
        return;
      }
      setData(row as CandidateDetailRecord | null);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, candidateId, supabase]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-[#1d1d1f]/25 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#f0f0f0] bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="candidate-detail-title"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#f5f5f5] bg-white px-6 py-4">
          <h2
            id="candidate-detail-title"
            className="pr-8 text-lg font-semibold text-[#1d1d1f]"
          >
            Candidate details
          </h2>
          <button
            type="button"
            className="rounded-xl p-2 text-[#aeaeb2] transition-all hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="space-y-6 px-6 py-5 text-sm">
          {loading && (
            <p className="text-center text-[#6e6e73]">Loading…</p>
          )}
          {fetchError && (
            <p className="rounded-xl border border-[#f0f0f0] bg-[#f5f5f7] px-3 py-2 text-sm text-[#1d1d1f]">
              {fetchError}
            </p>
          )}
          {!loading && !fetchError && data && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">{textOrDash(data.full_name)}</Field>
                <Field label="Phone">{textOrDash(data.whatsapp_number)}</Field>
                <Field label="Email">{textOrDash(data.email)}</Field>
                <Field label="Role">{textOrDash(data.role_before_program)}</Field>
                <Field
                  label="Salary"
                  className="sm:col-span-2"
                >
                  {textOrDash(data.salary_before_program)}
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Achievement type">
                  {textOrDash(data.achievement_type)}
                </Field>
                <Field label="Achievement title">
                  {textOrDash(data.achievement_title)}
                </Field>
              </div>

              <Field label="Quantified result">
                {textOrDash(data.quantified_result)}
              </Field>
              <Field label="How program helped">
                {textOrDash(data.how_program_helped)}
              </Field>

              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
                  Proof
                </p>
                <div className="mt-2">
                  {data.proof_document_url?.trim() ? (
                    <a
                      href={data.proof_document_url.trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex rounded-xl bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2d2d2f]"
                    >
                      View Proof
                    </a>
                  ) : (
                    <span className="text-[#6e6e73]">—</span>
                  )}
                </div>
              </div>

              {(data.linkedin_url?.trim() || data.instagram_url?.trim()) && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {data.linkedin_url?.trim() ? (
                    <Field label="LinkedIn">
                      <a
                        href={data.linkedin_url.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[#3b82f6] hover:underline"
                      >
                        Open profile
                      </a>
                    </Field>
                  ) : null}
                  {data.instagram_url?.trim() ? (
                    <Field label="Instagram">
                      <a
                        href={data.instagram_url.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[#3b82f6] hover:underline"
                      >
                        Open profile
                      </a>
                    </Field>
                  ) : null}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="AI score">
                  {data.ai_eligibility_score != null ? (
                    <span className="tabular-nums">
                      {data.ai_eligibility_score}
                    </span>
                  ) : (
                    <span className="text-[#6e6e73]">—</span>
                  )}
                </Field>
                <Field
                  label="AI reason"
                  className="sm:col-span-2"
                >
                  {textOrDash(data.ai_eligibility_reason)}
                </Field>
              </div>
            </>
          )}
          {!loading && !fetchError && !data && candidateId && (
            <p className="text-center text-[#6e6e73]">Candidate not found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
