"use client";

import { createBrowserClient } from "@supabase/ssr";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { LogoOnDark, LogoOnLight } from "@/components/brand-logo";

const inputClass =
  "w-full rounded-xl border border-[#e5e5e5] px-4 py-3 text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]";

const LINK_EXPIRED_MESSAGE =
  "This link has expired or was already used. Please request a new password reset.";

/**
 * Handles Supabase email links (forgot password + team invite) via:
 * - PKCE: ?code=... → exchangeCodeForSession (use @supabase/ssr browser client for verifier storage)
 * - Implicit: #access_token=...&refresh_token=... → setSession
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const [initializing, setInitializing] = useState(true);
  const [sessionOk, setSessionOk] = useState(false);
  const [initError, setInitError] = useState("");
  const [offerRequestNewLink, setOfferRequestNewLink] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rightVisible, setRightVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setRightVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const markReady = () => {
      if (!cancelled) {
        setSessionOk(true);
        setInitError("");
        setOfferRequestNewLink(false);
      }
    };

    const markInitError = (msg: string, opts?: { offerNewLink?: boolean }) => {
      if (!cancelled) {
        setSessionOk(false);
        setInitError(msg);
        setOfferRequestNewLink(opts?.offerNewLink ?? false);
      }
    };

    void (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (cancelled) return;
          if (error) {
            markInitError(LINK_EXPIRED_MESSAGE, { offerNewLink: true });
          } else {
            markReady();
          }
          window.history.replaceState(null, "", `${url.pathname}`);
          return;
        }

        const rawHash = window.location.hash.replace(/^#/, "");
        if (rawHash) {
          const hp = new URLSearchParams(rawHash);
          const access_token = hp.get("access_token");
          const refresh_token = hp.get("refresh_token");
          if (access_token && refresh_token) {
            const { error } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
            if (cancelled) return;
            if (error) {
              markInitError(error.message);
            } else {
              markReady();
            }
            window.history.replaceState(null, "", url.pathname + url.search);
            return;
          }
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) return;
        if (session) {
          markReady();
        } else {
          markInitError(
            "This link is invalid or has expired. Request a new reset link or invite from your administrator.",
          );
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (
        session &&
        (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")
      ) {
        setSessionOk(true);
        setInitError("");
        setOfferRequestNewLink(false);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError("");
    if (password.length < 6) {
      setSubmitError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setSubmitError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col font-sans lg:flex-row">
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

            <h2 className="mt-4 text-center text-2xl font-semibold text-[#1d1d1f]">
              Set your password
            </h2>
            <p className="mt-1 text-center text-sm text-[#6e6e73]">
              Choose a password to finish signing in
            </p>

            {initializing ? (
              <div className="mt-10 flex flex-col items-center justify-center gap-3 py-6">
                <Loader2
                  className="h-8 w-8 animate-spin text-[#1d1d1f]"
                  aria-hidden
                />
                <p className="text-sm text-[#6e6e73]">Verifying your link…</p>
              </div>
            ) : !sessionOk ? (
              <div className="mt-8 space-y-4">
                <p
                  className="rounded-lg bg-[#fef2f2] px-3 py-2 text-sm text-[#dc2626]"
                  role="alert"
                >
                  {initError}
                </p>
                {offerRequestNewLink ? (
                  <Link
                    href="/login?forgot_password=1"
                    className="flex w-full items-center justify-center rounded-xl bg-[#1d1d1f] py-3 text-sm font-medium text-white transition-colors hover:bg-[#2d2d2f]"
                  >
                    Request new link
                  </Link>
                ) : null}
                <Link
                  href="/login"
                  className={`block text-center text-sm font-medium text-[#1d1d1f] underline-offset-2 hover:underline ${
                    offerRequestNewLink ? "pt-1" : ""
                  }`}
                >
                  Back to sign in
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-8">
                <div>
                  <label
                    htmlFor="reset-new-password"
                    className="mb-1.5 block text-xs font-medium text-[#1d1d1f]"
                  >
                    New password
                  </label>
                  <div className="relative">
                    <input
                      id="reset-new-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
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
                </div>

                <div className="mt-5">
                  <label
                    htmlFor="reset-confirm-password"
                    className="mb-1.5 block text-xs font-medium text-[#1d1d1f]"
                  >
                    Confirm password
                  </label>
                  <div className="relative">
                    <input
                      id="reset-confirm-password"
                      name="confirm-password"
                      type={showConfirm ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="••••••••"
                      className={`${inputClass} pr-11`}
                    />
                    <button
                      type="button"
                      aria-label={
                        showConfirm ? "Hide password" : "Show password"
                      }
                      onClick={() => setShowConfirm((v) => !v)}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[#6e6e73] hover:text-[#1d1d1f]"
                    >
                      {showConfirm ? (
                        <EyeOff className="h-4 w-4" aria-hidden />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden />
                      )}
                    </button>
                  </div>
                </div>

                {submitError ? (
                  <p className="mt-3 text-sm text-[#dc2626]" role="alert">
                    {submitError}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1d1d1f] py-3 text-sm font-medium text-white transition-all duration-200 hover:bg-[#2d2d2f] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {submitting ? (
                    <>
                      <Loader2
                        className="h-4 w-4 shrink-0 animate-spin"
                        aria-hidden
                      />
                      Saving…
                    </>
                  ) : (
                    "Set Password"
                  )}
                </button>

                <Link
                  href="/login"
                  className="mt-4 block text-center text-sm text-[#6e6e73] hover:text-[#1d1d1f]"
                >
                  ← Back to sign in
                </Link>
              </form>
            )}

            <p className="mt-8 text-center text-xs text-[#aeaeb2]">
              © 2026 House of Ed-Tech. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
