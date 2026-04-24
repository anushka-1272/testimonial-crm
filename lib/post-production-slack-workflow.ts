import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SLACK_PRKHRVV_EMAIL,
  SLACK_SAPNA_POST_PRODUCTION_EMAIL,
  SLACK_SOMOSHREE_POST_PRODUCTION_EMAIL,
} from "@/lib/slack-contacts";
import { voidSlackNotify } from "@/lib/slack-client";

/** Fields needed to detect transitions (compare `before` + `patch`). */
export type PostProductionSlackSnapshot = {
  candidate_name: string | null;
  raw_video_link: string | null;
  edited_video_link: string | null;
  pre_edit_review: string;
  post_edit_review: string;
  youtube_link: string | null;
};

function trimmed(s: string | null | undefined): string {
  return (s ?? "").trim();
}

function patchHas<K extends string>(patch: Record<string, unknown>, key: K): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

/**
 * Fire Slack DMs on meaningful transitions only (old vs new), to avoid duplicate spam.
 *
 * 1. Raw link first set → Sapna (pre-review)
 * 2. Pre-review marked done → Somoshree (edit + edited link)
 * 3. Edited link first set → Sapna (post-review)
 * 4. Post-review marked done → Sapna (YouTube private + link reminder)
 * 5. YouTube link first set → Prakhar (thumbnail + unlist)
 */
export function notifyPostProductionSlackAfterPatch(
  supabase: SupabaseClient,
  before: PostProductionSlackSnapshot,
  patch: Record<string, unknown>,
): void {
  const candidateLabel = trimmed(before.candidate_name) || "Candidate";

  if (patchHas(patch, "raw_video_link")) {
    const was = trimmed(before.raw_video_link);
    const now = trimmed(patch.raw_video_link as string | null | undefined);
    if (!was && now) {
      voidSlackNotify(
        supabase,
        SLACK_SAPNA_POST_PRODUCTION_EMAIL,
        `Raw video added for *${candidateLabel}*. Please do pre-review.`,
      );
    }
  }

  if (patchHas(patch, "pre_edit_review")) {
    const now = String(patch.pre_edit_review);
    if (now === "done" && before.pre_edit_review !== "done") {
      voidSlackNotify(
        supabase,
        SLACK_SOMOSHREE_POST_PRODUCTION_EMAIL,
        `Pre-review completed for *${candidateLabel}*. Please edit and upload edited link.`,
      );
    }
  }

  if (patchHas(patch, "edited_video_link")) {
    const was = trimmed(before.edited_video_link);
    const now = trimmed(patch.edited_video_link as string | null | undefined);
    if (!was && now) {
      voidSlackNotify(
        supabase,
        SLACK_SAPNA_POST_PRODUCTION_EMAIL,
        `Edited video ready for *${candidateLabel}*. Please do post-review.`,
      );
    }
  }

  if (patchHas(patch, "post_edit_review")) {
    const now = String(patch.post_edit_review);
    if (now === "done" && before.post_edit_review !== "done") {
      voidSlackNotify(
        supabase,
        SLACK_SAPNA_POST_PRODUCTION_EMAIL,
        `Post-review completed for *${candidateLabel}*. Upload on YouTube as PRIVATE and add link.`,
      );
    }
  }

  if (patchHas(patch, "youtube_link")) {
    const was = trimmed(before.youtube_link);
    const now = trimmed(patch.youtube_link as string | null | undefined);
    if (!was && now) {
      voidSlackNotify(
        supabase,
        SLACK_PRKHRVV_EMAIL,
        `YT link added for *${candidateLabel}*. Please add thumbnail and unlist video.`,
      );
    }
  }
}
