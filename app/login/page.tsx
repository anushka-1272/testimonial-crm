"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { LogoOnDark, LogoOnLight } from "@/components/brand-logo";

const inputClass =
  "w-full rounded-xl border border-[#e5e5e5] px-4 py-3 text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#3b82f6] focus:outline-none focus:ring-1 focus:ring-[#3b82f6]";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rightVisible, setRightVisible] = useState(false);
  const router = useRouter();
  const supabase = createClientComponentClient();

  useEffect(() => {
    const id = requestAnimationFrame(() => setRightVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (signErr) {
      setError(
        signErr.message === "Invalid login credentials"
          ? "Invalid email or password."
          : signErr.message,
      );
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

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
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputClass}
                />
              </div>

              {error ? (
                <p
                  className="mt-3 rounded-lg bg-[#fef2f2] px-3 py-2 text-xs text-[#ef4444]"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1d1d1f] py-3 text-sm font-medium text-white transition-all duration-200 hover:bg-[#2d2d2f] disabled:opacity-70"
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

            <p className="mt-8 text-center text-xs text-[#aeaeb2]">
              © 2026 House of Ed-Tech. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
