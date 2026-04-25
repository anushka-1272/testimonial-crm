import { createClient } from "@supabase/supabase-js";

import { verifyRequestUser } from "@/lib/google-sheet-gviz";

export const runtime = "nodejs";

const TIMEZONE_IST = "Asia/Kolkata";
const FETCH_CAP = 5000;

type ExportRow = {
  name: string;
  email: string;
  type: "testimonial" | "project";
  domain: string | null;
  role: string | null;
  completed_at: string | null;
  summary: string | null;
  youtube_link: string;
};

type PostProductionBaseRow = {
  interview_id: string | null;
  project_interview_id: string | null;
  source_type: string | null;
  summary: string | null;
  youtube_link: string | null;
  updated_at: string;
};

type TestimonialInterviewRow = {
  id: string;
  completed_at: string | null;
  interview_status: string | null;
  post_interview_eligible: boolean | null;
  candidates:
    | {
        full_name: string | null;
        email: string | null;
        domain: string | null;
        job_role: string | null;
        role_before_program: string | null;
        achievement_title: string | null;
        quantified_result: string | null;
        how_program_helped: string | null;
        is_deleted?: boolean | null;
      }
    | Array<{
        full_name: string | null;
        email: string | null;
        domain: string | null;
        job_role: string | null;
        role_before_program: string | null;
        achievement_title: string | null;
        quantified_result: string | null;
        how_program_helped: string | null;
        is_deleted?: boolean | null;
      }>;
};

type ProjectInterviewRow = {
  id: string;
  completed_at: string | null;
  interview_status: string | null;
  post_interview_eligible: boolean | null;
  project_candidates:
    | {
        full_name: string | null;
        email: string | null;
        is_deleted?: boolean | null;
      }
    | Array<{
        full_name: string | null;
        email: string | null;
        is_deleted?: boolean | null;
      }>;
};

function csvEscape(v: string): string {
  const value = v ?? "";
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function toCsv(rows: ExportRow[]): string {
  const headers = [
    "Name",
    "Email",
    "Type",
    "Domain",
    "Role",
    "Completed Date",
    "Summary",
    "YouTube Link",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.name,
        row.email,
        row.type === "project" ? "Project" : "Testimonial",
        row.domain ?? "",
        row.role ?? "",
        formatIstDateTime(row.completed_at),
        row.summary ?? "",
        row.youtube_link,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n");
}

function parseYmdBoundsIst(ymd: string): { startIso: string; endIso: string } | null {
  const t = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const start = new Date(`${t}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function formatIstDateTime(iso: string | null): string {
  if (!iso?.trim()) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: TIMEZONE_IST,
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  const dayPeriod = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toUpperCase();
  if (!day || !month || !hour || !minute || !dayPeriod) return "";
  return `${day} ${month}, ${hour}:${minute} ${dayPeriod}`;
}

function dedupeByInterview(rows: PostProductionBaseRow[]): PostProductionBaseRow[] {
  const byKey = new Map<string, PostProductionBaseRow>();
  for (const row of rows) {
    const source = row.source_type === "project" ? "project" : "testimonial";
    const linkedId =
      source === "project"
        ? (row.project_interview_id ?? row.interview_id ?? "").trim()
        : (row.interview_id ?? row.project_interview_id ?? "").trim();
    if (!linkedId) continue;
    const key = `${source}:${linkedId}`;
    const prev = byKey.get(key);
    if (!prev || new Date(row.updated_at).getTime() > new Date(prev.updated_at).getTime()) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

function normalizeCandidate<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function GET(request: Request) {
  const user = await verifyRequestUser(request);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return new Response("Server is missing Supabase configuration", { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const reqUrl = new URL(request.url);
  const search = (reqUrl.searchParams.get("search") ?? "").trim().toLowerCase();
  const type = reqUrl.searchParams.get("type") === "project"
    ? "project"
    : reqUrl.searchParams.get("type") === "testimonial"
      ? "testimonial"
      : "all";
  const domain = (reqUrl.searchParams.get("domain") ?? "all").trim();
  const from = (reqUrl.searchParams.get("from") ?? "").trim();
  const to = (reqUrl.searchParams.get("to") ?? "").trim();
  const fromB = from ? parseYmdBoundsIst(from) : null;
  const toB = to ? parseYmdBoundsIst(to) : null;

  const { data: ppData, error: ppErr } = await supabase
    .from("post_production")
    .select("interview_id, project_interview_id, source_type, summary, youtube_link, updated_at")
    .not("youtube_link", "is", null)
    .neq("youtube_link", "")
    .order("updated_at", { ascending: false })
    .limit(FETCH_CAP * 2);

  if (ppErr) {
    return new Response(ppErr.message, { status: 500 });
  }

  const ppRows = dedupeByInterview(
    ((ppData ?? []) as PostProductionBaseRow[]).filter((r) =>
      Boolean(r.youtube_link?.trim()),
    ),
  );

  const testimonialIds = [...new Set(
    ppRows
      .filter((r) => (r.source_type ?? "testimonial") !== "project")
      .map((r) => r.interview_id?.trim() ?? "")
      .filter(Boolean),
  )];
  const projectIds = [...new Set(
    ppRows
      .filter((r) => r.source_type === "project")
      .map((r) => (r.project_interview_id ?? r.interview_id ?? "").trim())
      .filter(Boolean),
  )];

  const [tRes, pRes] = await Promise.all([
    testimonialIds.length
      ? supabase
          .from("interviews")
          .select(
            "id, completed_at, interview_status, post_interview_eligible, candidates!inner ( full_name, email, domain, job_role, role_before_program, achievement_title, quantified_result, how_program_helped, is_deleted )",
          )
          .in("id", testimonialIds)
          .eq("post_interview_eligible", true)
          .not("completed_at", "is", null)
          .or("interview_status.eq.completed,completed_at.not.is.null")
          .eq("candidates.is_deleted", false)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase
          .from("project_interviews")
          .select(
            "id, completed_at, interview_status, post_interview_eligible, project_candidates!inner ( full_name, email, is_deleted )",
          )
          .in("id", projectIds)
          .eq("post_interview_eligible", true)
          .not("completed_at", "is", null)
          .or("interview_status.eq.completed,completed_at.not.is.null")
          .eq("project_candidates.is_deleted", false)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (tRes.error) return new Response(tRes.error.message, { status: 500 });
  if (pRes.error) return new Response(pRes.error.message, { status: 500 });

  const tById = new Map<string, TestimonialInterviewRow>(
    ((tRes.data ?? []) as TestimonialInterviewRow[]).map((r) => [r.id, r]),
  );
  const pById = new Map<string, ProjectInterviewRow>(
    ((pRes.data ?? []) as ProjectInterviewRow[]).map((r) => [r.id, r]),
  );

  const out: ExportRow[] = [];
  for (const pp of ppRows) {
    const source = pp.source_type === "project" ? "project" : "testimonial";
    const yt = pp.youtube_link?.trim() ?? "";
    if (!yt) continue;

    if (source === "project") {
      const id = (pp.project_interview_id ?? pp.interview_id ?? "").trim();
      if (!id) continue;
      const iv = pById.get(id);
      if (!iv || iv.post_interview_eligible !== true || !iv.completed_at) continue;
      const c = normalizeCandidate(iv.project_candidates);
      if (!c || c.is_deleted) continue;
      const email = c.email?.trim() ?? "";
      if (!email) continue;
      out.push({
        name: c.full_name?.trim() || email,
        email,
        type: "project",
        domain: null,
        role: null,
        completed_at: iv.completed_at,
        summary: pp.summary?.trim() || null,
        youtube_link: yt,
      });
      continue;
    }

    const id = (pp.interview_id ?? pp.project_interview_id ?? "").trim();
    if (!id) continue;
    const iv = tById.get(id);
    if (!iv || iv.post_interview_eligible !== true || !iv.completed_at) continue;
    const c = normalizeCandidate(iv.candidates);
    if (!c || c.is_deleted) continue;
    const email = c.email?.trim() ?? "";
    if (!email) continue;
    out.push({
      name: c.full_name?.trim() || email,
      email,
      type: "testimonial",
      domain: c.domain?.trim() || null,
      role: c.job_role?.trim() || c.role_before_program?.trim() || null,
      completed_at: iv.completed_at,
      summary:
        pp.summary?.trim() ||
        c.how_program_helped?.trim() ||
        c.quantified_result?.trim() ||
        c.achievement_title?.trim() ||
        null,
      youtube_link: yt,
    });
  }

  const filtered = out.filter((r) => {
    if (type !== "all" && r.type !== type) return false;
    if (domain !== "all" && type !== "project") {
      if (r.type === "testimonial" && (r.domain ?? "").trim() !== domain) return false;
    }
    if (search) {
      const s = search.toLowerCase();
      if (!r.name.toLowerCase().includes(s) && !r.email.toLowerCase().includes(s)) return false;
    }
    if (fromB && r.completed_at) {
      if (r.completed_at < fromB.startIso) return false;
    } else if (fromB && !r.completed_at) {
      return false;
    }
    if (toB && r.completed_at) {
      if (r.completed_at >= toB.endIso) return false;
    } else if (toB && !r.completed_at) {
      return false;
    }
    return true;
  });

  const csv = toCsv(filtered);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="interview-library.csv"',
      "Cache-Control": "no-store",
    },
  });
}
