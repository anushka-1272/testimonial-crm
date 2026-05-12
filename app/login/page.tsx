"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useState,
} from "react";

import { LogoOnDark, LogoOnLight } from "@/components/brand-logo";
import { CandidateLookupSection } from "@/components/candidate-lookup/candidate-lookup-section";

const inputClass =
  "w-full rounded-xl border border-[#e5e5e5] px-4 py-3 text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]";

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
  const router = useRouter();
  const supabase = createClientComponentClient();

  useEffect(() => {
    const id = requestAnimationFrame(() => setRightVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("forgot_password") !== "1") return;
    setAuthView("forgot_password");
    setResetError("");
    setResetSuccess("");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);

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
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin}/reset-password`,
      },
    );
    setResetLoading(false);
    if (resetErr) {
      setResetError(authFormErrorMessage(resetErr.message));
      return;
    }
    setResetSuccess("Check your email for a reset link");
  }

  return (
    <div className="flex min-h-screen flex-col font-sans lg:flex-row">
      {/* Left — 60% (desktop only) */}
      <div className="relative hidden min-h-[320px] flex-col items-center justify-center overflow-hidden bg-[#0f1729] px-8 py-14 lg:flex lg:min-h-screen lg:w-3/5 lg:py-0">
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
        className={`flex min-h-screen w-full flex-1 flex-col bg-white transition-opacity duration-500 ease-out lg:w-2/5 lg:min-h-0 lg:flex-none ${
          rightVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="flex flex-1 flex-col justify-center px-5 py-10 sm:px-12 sm:py-12 lg:px-14">
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

                <CandidateLookupSection />
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

    </div>
  );
}
