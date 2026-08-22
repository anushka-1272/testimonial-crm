import type { PlannedContentType } from "@/lib/planned-content-type";
import type { WatiTemplateParameter } from "@/lib/wati";

/**
 * WATI template names. Names must match the WATI dashboard exactly.
 */
export const WATI_TEMPLATES = {
  interviewInvite: "interview_",
  interviewCompleted: "interview_completed",
  storyRejected: "succcess_story_rejected",
  rewardDispatched: "rewardsss_",
  interviewScheduledLinkedin: "interview_scheduled_new",
  interviewScheduledBlog: "interview_blogpost_new1",
  interviewScheduledBoth: "scheduled_blog_linkedin",
  eligibleTestimonial: "eligible_testimonial",
  interviewNoShow: "Interview_no_show",
} as const;

export function scheduledDraftTemplateName(
  plannedContent: PlannedContentType,
): string {
  switch (plannedContent) {
    case "linkedin_post":
      return WATI_TEMPLATES.interviewScheduledLinkedin;
    case "blog_post":
      return WATI_TEMPLATES.interviewScheduledBlog;
    case "both":
      return WATI_TEMPLATES.interviewScheduledBoth;
  }
}

export function nameDateTimeParams(
  name: string,
  dateLabel: string,
  timeLabel: string,
): WatiTemplateParameter[] {
  return [
    { name: "1", value: name },
    { name: "2", value: dateLabel },
    { name: "3", value: timeLabel },
  ];
}

export function nameOnlyParams(name: string): WatiTemplateParameter[] {
  return [{ name: "1", value: name }];
}

export function noShowInterviewParams(
  name: string,
  scheduledSlot: string,
): WatiTemplateParameter[] {
  return [
    { name: "1", value: name },
    { name: "2", value: scheduledSlot },
  ];
}

/** Alternate param sets — WATI rejects the request if the count does not match the template. */
export function noShowInterviewParamAttempts(
  name: string,
  scheduledSlot: string,
): WatiTemplateParameter[][] {
  return [nameOnlyParams(name), noShowInterviewParams(name, scheduledSlot)];
}
