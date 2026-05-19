import type { SupabaseClient } from "@supabase/supabase-js";

export async function requestRevertInterview(
  supabase: SupabaseClient,
  payload: {
    interviewId: string;
    candidateId: string;
    isProject: boolean;
    candidateName: string;
  },
): Promise<{ error: string | null }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch("/api/interviews/revert", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    return { error: json.error ?? "Revert failed" };
  }
  return { error: null };
}
