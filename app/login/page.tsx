"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { Eye, EyeOff, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";

import { LogoOnDark, LogoOnLight } from "@/components/brand-logo";
import {
  digitsOnly,
  resolveSupportStatus,
  type SupportDispatch,
  type SupportInterview,
  type SupportLookupPayload,
  type SupportCandidate,
} from "@/lib/support-lookup";

const inputClass =
  "w-full rounded-xl border border-[#e5e5e5] px-4 py-3 text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]";

const CANDIDATE_LOOKUP_SELECT =
  "id, full_name, email, whatsapp_number, eligibility_status, interview_type, poc_assigned";

const INTERVIEW_LOOKUP_SELECT =
  "interview_status, scheduled_date, interviewer, reschedule_reason, interview_type, reward_item";

const DISPATCH_LOOKUP_SELECT =
  "dispatch_status, tracking_id, expected_delivery_date, reward_item";

function CandidateLookupResultCard({
  payload,
}: {
  payload: SupportLookupPayload;
}) {
  const status = resolveSupportStatus(payload);
  const { candidate, interview, dispatch } = payload;
  const typeForBadge = interview?.interview_type ?? candidate.interview_type;
  const reward =
    dispatch?.reward_item?.trim() ||
    (interview?.interview_status === "completed"
      ? interview.reward_item?.trim()
      : null) ||
    null;

  return (
    <div className="mt-5 rounded-2xl border border-[#f0f0f0] bg-[#fafafa] p-5 text-left">
      <p className="text-xl font-bold text-[#1d1d1f]">
        {candidate.full_name?.trim() || "—"}
      </p>
      <div className="mt-3 space-y-1 text-sm text-[#6e6e73]">
        <p className="break-all">
          <span className="text-[#9ca3af]">Email </span>
          {candidate.email}
        </p>
        <p>
          <span className="text-[#9ca3af]">Phone </span>
          {candidate.whatsapp_number?.trim() ? (
            candidate.whatsapp_number
          ) : (
            <span className="text-[#d1d5db]">—</span>
          )}
        </p>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
          Interview type
        </p>
        {interviewTypeBadge(typeForBadge)}
      </div>
      <div className="mt-4 border-t border-[#e5e5e5] pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
          Current status
        </p>
        <span
          className={`inline-flex flex-wrap items-center gap-x-1 rounded-full px-3 py-1.5 text-xs font-semibold ${status.badgeClass}`}
        >
          {status.title}
        </span>
        {status.lines.length > 0 ? (
          <div className="mt-3 space-y-1.5 text-sm leading-snug text-[#6e6e73]">
            {status.lines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ) : null}
      </div>
      {candidate.poc_assigned?.trim() ? (
        <div className="mt-4 border-t border-[#e5e5e5] pt-4">
          <p className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
            POC assigned
          </p>
          <p className="mt-1 text-sm font-medium text-[#1d1d1f]">
            {candidate.poc_assigned}
          </p>
        </div>
      ) : null}
      {reward ? (
        <div className="mt-4 border-t border-[#e5e5e5] pt-4">
          <p className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]">
            Reward item
          </p>
          <p className="mt-1 text-sm text-[#1d1d1f]">{reward}</p>
        </div>
      ) : null}
    </div>
  );
}

function interviewTypeBadge(t: string | null | undefined) {
  if (t === "testimonial") {
    return (
      <span className="inline-flex rounded-full bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#16a34a]">
        Testimonial
      </span>
    );
  }
  if (t === "project") {
    return (
      <span className="inline-flex rounded-full bg-[#eff6ff] px-2.5 py-1 text-xs font-medium text-[#2563eb]">
        Project
      </span>
    );
  }
  return (
    <span className="text-xs font-medium text-[#6e6e73]">Not set</span>
  );
}

function authFormErrorMessage(message: string): string {
  if (message === "Invalid login credentials") {
    return "Invalid email or password";
  }
  return "Something went wrong, please try again";
}

export default function LoginPage() {
  const [authView, setAuthView] = useState<"sign_in" | "forgot_password">(
    "sign_in",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rightVisible, setRightVisible] = useState(false);
  const [lookupModalOpen, setLookupModalOpen] = useState(false);
  const [lookupModalQuery, setLookupModalQuery] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupPayload, setLookupPayload] = useState<SupportLookupPayload | null>(
    null,
  );
  const [lookupNotFound, setLookupNotFound] = useState(false);
  const [lookupMultiPhone, setLookupMultiPhone] = useState(false);
  const router = useRouter();
  const supabase = createClientComponentClient();

  const closeLookupModal = useCallback(() => {
    setLookupModalOpen(false);
    setLookupModalQuery("");
    setLookupPayload(null);
    setLookupNotFound(false);
    setLookupMultiPhone(false);
    setLookupLoading(false);
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => setRightVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!lookupModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLookupModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lookupModalOpen, closeLookupModal]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);

    console.log("Login attempt:", { email });
    console.log("Login error:", error);
    console.log("Login data:", data);

    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function handleResetPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResetError("");
    setResetSuccess("");
    const targetEmail = resetEmail.trim();
    if (!targetEmail) {
      setResetError("Please enter your email.");
      return;
    }
    setResetLoading(true);
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
      targetEmail,
      {
        redirectTo: `${window.location.origin}/login`,
      },
    );
    setResetLoading(false);
    if (resetErr) {
      setResetError(authFormErrorMessage(resetErr.message));
      return;
    }
    setResetSuccess("Check your email for a reset link");
  }

  const runSupportLookup = useCallback(async () => {
    const raw = lookupModalQuery.trim();
    setLookupPayload(null);
    setLookupNotFound(false);
    setLookupMultiPhone(false);
    if (!raw) return;

    setLookupLoading(true);
    try {
      let candidate: SupportCandidate | null = null;

      if (raw.includes("@")) {
        const { data, error } = await supabase
          .from("candidates")
          .select(CANDIDATE_LOOKUP_SELECT)
          .eq("is_deleted", false)
          .ilike("email", raw)
          .limit(2);
        if (error) {
          setLookupNotFound(true);
          return;
        }
        const rows = (data ?? []) as SupportCandidate[];
        if (rows.length === 1) candidate = rows[0];
        else setLookupNotFound(true);
      } else {
        const digits = digitsOnly(raw);
        if (digits.length < 8) {
          setLookupNotFound(true);
          return;
        }
        const { data, error } = await supabase
          .from("candidates")
          .select(CANDIDATE_LOOKUP_SELECT)
          .eq("is_deleted", false)
          .ilike("whatsapp_number", `%${digits}%`)
          .limit(15);
        if (error) {
          setLookupNotFound(true);
          return;
        }
        const rows = (data ?? []) as SupportCandidate[];
        const normalized = rows.filter((r) => {
          const w = digitsOnly(r.whatsapp_number ?? "");
          if (!w) return false;
          return (
            w === digits ||
            w.endsWith(digits) ||
            digits.endsWith(w) ||
            w.includes(digits)
          );
        });
        if (normalized.length === 1) candidate = normalized[0];
        else if (normalized.length === 0) setLookupNotFound(true);
        else setLookupMultiPhone(true);
      }

      if (!candidate) return;

      const { data: intRows } = await supabase
        .from("interviews")
        .select(INTERVIEW_LOOKUP_SELECT)
        .eq("candidate_id", candidate.id)
        .order("created_at", { ascending: false })
        .limit(1);

      const interview = (intRows?.[0] ?? null) as SupportInterview | null;

      const { data: dispRows } = await supabase
        .from("dispatch")
        .select(DISPATCH_LOOKUP_SELECT)
        .eq("candidate_id", candidate.id)
        .order("created_at", { ascending: false })
        .limit(1);

      const dispatch = (dispRows?.[0] ?? null) as SupportDispatch | null;

      setLookupPayload({ candidate, interview, dispatch });
    } finally {
      setLookupLoading(false);
    }
  }, [lookupModalQuery, supabase]);

  return (
    <div className="flex min-h-screen flex-col font-sans lg:flex-row">
      {/* Left — 60% */}
      <div className="relative flex min-h-[320px] flex-col items-center justify-center overflow-hidden bg-[#0f1729] px-8 py-14 lg:min-h-screen lg:w-3/5 lg:py-0">
        <div
          className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-[#3b82f6]/10 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-16 bottom-1/4 h-56 w-56 rounded-full bg-[#6366f1]/10 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
          aria-hidden
        />

        <div className="relative z-10 flex max-w-lg flex-col items-center text-center">
          <LogoOnDark className="mb-6 h-16 w-16 rounded-lg" />
          <p className="mb-4 text-xs tracking-widest text-[#94a3b8]">
            HOUSE OF ED-TECH
          </p>
          <h1 className="text-5xl font-bold leading-tight text-white">
            Testimonial CRM
          </h1>
          <p className="mt-4 max-w-sm text-base text-[#94a3b8]">
            Manage your testimonial pipeline from entry to publication
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
            {["AI Powered", "Real-time", "End-to-end"].map((label) => (
              <span
                key={label}
                className="rounded-full bg-[#1a2540] px-3 py-1.5 text-xs text-[#94a3b8]"
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        <p className="absolute bottom-6 left-0 right-0 z-10 px-8 text-center text-xs text-[#4b5563] lg:bottom-8">
          Built for House of Ed-Tech Operations
        </p>
      </div>

      {/* Right — 40% */}
      <div
        className={`flex flex-1 flex-col bg-white transition-opacity duration-500 ease-out lg:w-2/5 lg:flex-none ${
          rightVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="flex flex-1 flex-col justify-center px-8 py-12 sm:px-12 lg:px-14">
          <div className="mx-auto w-full max-w-[360px]">
            <div className="flex justify-center">
              <LogoOnLight className="h-10 w-10" />
            </div>
            {authView === "sign_in" ? (
              <>
                <h2 className="mt-4 text-center text-2xl font-semibold text-[#1d1d1f]">
                  Welcome back
                </h2>
                <p className="mt-1 text-center text-sm text-[#6e6e73]">
                  Sign in to your account
                </p>

                <form onSubmit={handleSubmit} className="mt-8">
                  <div>
                    <label
                      htmlFor="login-email"
                      className="mb-1.5 block text-xs font-medium text-[#1d1d1f]"
                    >
                      Email address
                    </label>
                    <input
                      id="login-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className={inputClass}
                    />
                  </div>

                  <div className="mt-5">
                    <label
                      htmlFor="login-password"
                      className="mb-1.5 block text-xs font-medium text-[#1d1d1f]"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="login-password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className={`${inputClass} pr-11`}
                      />
                      <button
                        type="button"
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[#6e6e73] hover:text-[#1d1d1f]"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden />
                        )}
                      </button>
                    </div>
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setAuthView("forgot_password");
                          setResetEmail(email.trim());
                          setResetError("");
                          setResetSuccess("");
                        }}
                        className="text-xs text-[#8e8e93] hover:text-[#6e6e73]"
                      >
                        Forgot password?
                      </button>
                    </div>
                  </div>

                  {error ? (
                    <p className="mt-3 text-sm text-[#dc2626]" role="alert">
                      {error}
                    </p>
                  ) : null}

                  <button
                    type="submit"
                    disabled={loading}
                    className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1d1d1f] py-3 text-sm font-medium text-white transition-all duration-200 hover:bg-[#2d2d2f] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {loading ? (
                      <>
                        <Loader2
                          className="h-4 w-4 shrink-0 animate-spin"
                          aria-hidden
                        />
                        Signing in...
                      </>
                    ) : (
                      "Sign in"
                    )}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => {
                    setLookupModalOpen(true);
                    setLookupPayload(null);
                    setLookupNotFound(false);
                    setLookupMultiPhone(false);
                  }}
                  className="mt-3 flex w-full items-center justify-center rounded-xl border-2 border-[#1d1d1f] bg-white py-3 text-sm font-medium text-[#1d1d1f] transition-colors hover:bg-[#fafafa]"
                >
                  🔍 Candidate Lookup
                </button>
              </>
            ) : (
              <>
                <h2 className="mt-4 text-center text-2xl font-semibold text-[#1d1d1f]">
                  Reset your password
                </h2>
                <p className="mt-1 text-center text-sm text-[#6e6e73]">
                  Enter your email and we&apos;ll send you a reset link
                </p>

                <form onSubmit={handleResetPassword} className="mt-8">
                  <label
                    htmlFor="reset-email"
                    className="mb-1.5 block text-xs font-medium text-[#1d1d1f]"
                  >
                    Email address
                  </label>
                  <input
                    id="reset-email"
                    name="reset-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="you@company.com"
                    className={inputClass}
                  />

                  {resetError ? (
                    <p
                      className="mt-3 rounded-lg bg-[#fef2f2] px-3 py-2 text-xs text-[#ef4444]"
                      role="alert"
                    >
                      {resetError}
                    </p>
                  ) : null}
                  {resetSuccess ? (
                    <p className="mt-3 rounded-lg bg-[#f0fdf4] px-3 py-2 text-xs text-[#15803d]">
                      {resetSuccess}
                    </p>
                  ) : null}

                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1d1d1f] py-3 text-sm font-medium text-white transition-all duration-200 hover:bg-[#2d2d2f] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {resetLoading ? (
                      <>
                        <Loader2
                          className="h-4 w-4 shrink-0 animate-spin"
                          aria-hidden
                        />
                        Sending...
                      </>
                    ) : (
                      "Send reset link"
                    )}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => {
                    setAuthView("sign_in");
                    setResetError("");
                    setResetSuccess("");
                  }}
                  className="mt-4 text-sm text-[#6e6e73] hover:text-[#1d1d1f]"
                >
                  ← Back to sign in
                </button>
              </>
            )}

            <p className="mt-8 text-center text-xs text-[#aeaeb2]">
              © 2026 House of Ed-Tech. All rights reserved.
            </p>
          </div>
        </div>
      </div>

      {lookupModalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          role="presentation"
        >
          <button
            type="button"
            className="absolute inset-0 bg-[#0f1729]/65 backdrop-blur-[2px]"
            aria-label="Close dialog"
            onClick={closeLookupModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="candidate-lookup-title"
            className="relative z-10 flex max-h-[min(90vh,720px)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#f0f0f0] px-6 pb-4 pt-5">
              <div className="min-w-0 pr-2">
                <h2
                  id="candidate-lookup-title"
                  className="text-lg font-semibold text-[#1d1d1f]"
                >
                  Candidate Lookup
                </h2>
                <p className="mt-1 text-sm text-[#6e6e73]">
                  Enter mobile number or email to check status
                </p>
              </div>
              <button
                type="button"
                onClick={closeLookupModal}
                className="shrink-0 rounded-lg p-2 text-[#6e6e73] transition-colors hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
                aria-label="Close"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5">
              <input
                type="text"
                value={lookupModalQuery}
                onChange={(e) => setLookupModalQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runSupportLookup();
                  }
                }}
                placeholder="Mobile number or email…"
                autoComplete="off"
                className={inputClass}
                aria-label="Mobile number or email"
              />
              <button
                type="button"
                disabled={lookupLoading}
                onClick={() => void runSupportLookup()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1d1d1f] py-3 text-sm font-medium text-white transition-colors hover:bg-[#2d2d2f] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {lookupLoading ? (
                  <>
                    <Loader2
                      className="h-4 w-4 shrink-0 animate-spin"
                      aria-hidden
                    />
                    Searching…
                  </>
                ) : (
                  "Search"
                )}
              </button>

              <div className="mt-6 min-h-[120px]">
                {lookupLoading ? (
                  <div className="flex flex-col items-center justify-center py-10">
                    <Loader2
                      className="h-8 w-8 animate-spin text-[#1d1d1f]"
                      aria-hidden
                    />
                    <p className="mt-3 text-sm text-[#6e6e73]">Searching…</p>
                  </div>
                ) : lookupMultiPhone ? (
                  <p className="py-8 text-center text-sm text-[#6e6e73]">
                    Several records match this number. Please search using the
                    email on your application.
                  </p>
                ) : lookupNotFound && !lookupPayload ? (
                  <p className="py-8 text-center text-sm text-[#6e6e73]">
                    No candidate found
                  </p>
                ) : lookupPayload ? (
                  <CandidateLookupResultCard payload={lookupPayload} />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
