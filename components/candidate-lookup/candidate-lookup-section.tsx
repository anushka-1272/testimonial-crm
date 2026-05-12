"use client";

import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type {
  CandidateLookupApiResponse,
  CandidateLookupCardData,
} from "@/lib/candidate-lookup/types";

const inputClass =
  "w-full rounded-xl border border-[#e5e5e5] px-4 py-3 text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]";

function InterviewTypeBadge({ type }: { type: CandidateLookupCardData["interviewType"] }) {
  if (type === "testimonial") {
    return (
      <span className="inline-flex rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#16a34a]">
        Testimonial
      </span>
    );
  }
  if (type === "project") {
    return (
      <span className="inline-flex rounded-full bg-[#eff6ff] px-2.5 py-1 text-xs font-medium text-[#2563eb]">
        Project
      </span>
    );
  }
  return <span className="text-xs font-medium text-[#6e6e73]">Not set</span>;
}

function LookupResultCard({ card }: { card: CandidateLookupCardData }) {
  return (
    <div className="mt-5 rounded-2xl border border-[#f0f0f0] bg-[#fafafa] p-5 text-left">
      <p className="text-xl font-bold text-[#1d1d1f]">{card.fullName}</p>
      <div className="mt-3 space-y-1 text-sm text-[#6e6e73]">
        <p className="break-all">
          <span className="text-[#9ca3af]">Email </span>
          {card.email}
        </p>
        <p>
          <span className="text-[#9ca3af]">Phone </span>
          {card.phone ? (
            card.phone
          ) : (
            <span className="text-[#d1d5db]">—</span>
          )}
        </p>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
          Interview type
        </p>
        <InterviewTypeBadge type={card.interviewType} />
      </div>
      <div className="mt-4 border-t border-[#e5e5e5] pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
          Current status
        </p>
        <span
          className={`inline-flex flex-wrap items-center gap-x-1 rounded-full px-3 py-1.5 text-xs font-semibold ${card.statusBadgeClass}`}
        >
          {card.statusTitle}
        </span>
        {card.statusDetailLines.length > 0 ? (
          <div className="mt-3 space-y-1.5 text-sm leading-snug text-[#6e6e73]">
            {card.statusDetailLines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ) : null}
      </div>
      {card.followup ? (
        <div className="mt-4 border-t border-[#e5e5e5] pt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
            Follow-up status
          </p>
          <p className="text-sm font-medium text-[#1d1d1f]">{card.followup.title}</p>
          {card.followup.subtitle ? (
            <p className="mt-1 text-sm leading-snug text-[#6e6e73]">
              {card.followup.subtitle}
            </p>
          ) : null}
        </div>
      ) : null}
      {card.poc ? (
        <div className="mt-4 border-t border-[#e5e5e5] pt-4">
          <p className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
            POC assigned
          </p>
          <p className="mt-1 text-sm font-medium text-[#1d1d1f]">{card.poc}</p>
        </div>
      ) : null}
      {card.rewardItem ? (
        <div className="mt-4 border-t border-[#e5e5e5] pt-4">
          <p className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
            Reward item
          </p>
          <p className="mt-1 text-sm text-[#1d1d1f]">{card.rewardItem}</p>
        </div>
      ) : null}
    </div>
  );
}

export function CandidateLookupSection() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [card, setCard] = useState<CandidateLookupCardData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [multiPhone, setMultiPhone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetResults = useCallback(() => {
    setCard(null);
    setNotFound(false);
    setMultiPhone(false);
    setError(null);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    resetResults();
    setLoading(false);
  }, [resetResults]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const search = useCallback(async () => {
    const raw = query.trim();
    resetResults();
    if (!raw) return;

    setLoading(true);
    try {
      const res = await fetch("/api/public/candidate-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: raw }),
        cache: "no-store",
      });
      let json: CandidateLookupApiResponse;
      try {
        json = (await res.json()) as CandidateLookupApiResponse;
      } catch {
        setError("Could not read response");
        return;
      }
      if (!json.ok) {
        if (json.reason === "multi_phone") setMultiPhone(true);
        else if (json.reason === "not_found") setNotFound(true);
        else if (json.reason === "error") setError(json.message);
        else setNotFound(true);
        return;
      }
      setCard(json.card);
    } finally {
      setLoading(false);
    }
  }, [query, resetResults]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          resetResults();
          setQuery("");
        }}
        className="mt-3 flex w-full items-center justify-center rounded-xl border-2 border-[#1d1d1f] bg-white py-3 text-sm font-medium text-[#1d1d1f] transition-colors hover:bg-[#fafafa]"
      >
        🔍 Candidate lookup
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-stretch justify-center p-0 sm:items-center sm:p-4"
          role="presentation"
        >
          <button
            type="button"
            className="absolute inset-0 bg-[#0f1729]/65 backdrop-blur-[2px] sm:bg-[#0f1729]/65"
            aria-label="Close dialog"
            onClick={close}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="candidate-lookup-title"
            className="relative z-10 flex h-full min-h-[100dvh] w-full max-w-none flex-col overflow-hidden rounded-none bg-white shadow-xl sm:h-auto sm:min-h-0 sm:max-h-[min(90vh,720px)] sm:max-w-md sm:rounded-2xl"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#f0f0f0] px-6 pb-4 pt-5">
              <div className="min-w-0 pr-2">
                <h2
                  id="candidate-lookup-title"
                  className="text-lg font-semibold text-[#1d1d1f]"
                >
                  Candidate lookup
                </h2>
                <p className="mt-1 text-sm text-[#6e6e73]">
                  Enter mobile number or email to check status
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="shrink-0 rounded-lg p-2 text-[#6e6e73] transition-colors hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
                aria-label="Close"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void search();
                  }
                }}
                placeholder="Mobile number or email…"
                autoComplete="off"
                className={inputClass}
                aria-label="Mobile number or email"
              />
              <button
                type="button"
                disabled={loading}
                onClick={() => void search()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1d1d1f] py-3 text-sm font-medium text-white transition-colors hover:bg-[#2d2d2f] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                    Searching…
                  </>
                ) : (
                  "Search"
                )}
              </button>

              <div className="mt-6 min-h-[120px]">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-10">
                    <Loader2 className="h-8 w-8 animate-spin text-[#1d1d1f]" aria-hidden />
                    <p className="mt-3 text-sm text-[#6e6e73]">Searching…</p>
                  </div>
                ) : multiPhone ? (
                  <p className="py-8 text-center text-sm text-[#6e6e73]">
                    Several records match this number. Please search using the email on your
                    application.
                  </p>
                ) : error ? (
                  <p className="py-8 text-center text-sm text-[#dc2626]">{error}</p>
                ) : notFound && !card ? (
                  <p className="py-8 text-center text-sm text-[#6e6e73]">No candidate found</p>
                ) : card ? (
                  <LookupResultCard card={card} />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
