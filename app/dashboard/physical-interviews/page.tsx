import type { Metadata } from "next";

import { PhysicalInterviewsDashboard } from "./physical-interviews-dashboard";

export const metadata: Metadata = {
  title: "Physical Interviews | Testimonial CRM",
  description: "Manage in-person physical interview track.",
};

export default function Page() {
  return <PhysicalInterviewsDashboard />;
}
