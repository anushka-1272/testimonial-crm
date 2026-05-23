export type TestimonialInterviewType =
  | "testimonial"
  | "project"
  | "written_feedback";

export type TestimonialInterviewTypeFilter = "all" | TestimonialInterviewType;

export const TESTIMONIAL_INTERVIEW_TYPE_OPTIONS: {
  value: TestimonialInterviewType;
  label: string;
}[] = [
  { value: "testimonial", label: "Testimonial" },
  { value: "project", label: "Project" },
  { value: "written_feedback", label: "Written feedback" },
];

export function isTestimonialInterviewType(
  value: string | null | undefined,
): value is TestimonialInterviewType {
  return (
    value === "testimonial" ||
    value === "project" ||
    value === "written_feedback"
  );
}

export function testimonialInterviewTypeLabel(
  type: TestimonialInterviewType | null | undefined,
): string {
  if (type === "testimonial") return "Testimonial";
  if (type === "project") return "Project";
  if (type === "written_feedback") return "Written feedback";
  return "—";
}

export function testimonialInterviewTypeRequiresInterviewer(
  type: TestimonialInterviewType,
): boolean {
  return type === "project";
}
