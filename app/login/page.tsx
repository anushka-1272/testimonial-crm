"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

const fieldClass =
  "mt-1.5 w-full rounded-xl border border-[#e5e5e5] bg-white p-3 text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:border-[#3b82f6] focus:outline-none focus:ring-0";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClientComponentClient();

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
    <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7] px-4 py-12 font-sans">
      <div className="w-full max-w-sm rounded-2xl border border-[#f0f0f0] bg-white p-8 shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-[#1d1d1f]">
            Testimonial CRM
          </h1>
          <p className="mt-1 text-sm text-[#6e6e73]">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          {error ? (
            <div
              className="rounded-xl border border-[#f0f0f0] bg-[#f5f5f7] px-4 py-3 text-sm text-[#1d1d1f]"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          <div>
            <label
              htmlFor="login-email"
              className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]"
            >
              Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="text-xs font-medium uppercase tracking-widest text-[#aeaeb2]"
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
              className={fieldClass}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[#1d1d1f] py-3 text-sm font-medium text-white transition-all hover:bg-[#2d2d2f] disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
