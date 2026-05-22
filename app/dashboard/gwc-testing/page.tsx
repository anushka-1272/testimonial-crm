import type { Metadata } from "next";

import { GwcTestingDashboard } from "./gwc-testing-dashboard";

export const metadata: Metadata = {
  title: "GWC Testing | Testimonial CRM",
  description: "GWC candidate workflow, content verification, and dispatch.",
};

export default function GwcTestingPage() {
  return <GwcTestingDashboard />;
}
