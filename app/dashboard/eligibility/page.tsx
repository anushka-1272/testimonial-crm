import type { Metadata } from "next";

import { EligibilityDashboard } from "./eligibility-dashboard";

export const metadata: Metadata = {
  title: "Eligibility review | Testimonial CRM",
  description: "Review candidate eligibility, AI scores, and outcomes.",
};

export default function EligibilityReviewPage() {
  return <EligibilityDashboard />;
}
