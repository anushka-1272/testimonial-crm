import type { Metadata } from "next";

import { AnalyticsDashboard } from "./analytics-dashboard";

export const metadata: Metadata = {
  title: "Analytics | Testimonial CRM",
  description: "Testimonial CRM performance overview.",
};

export default function AnalyticsPage() {
  return (
    <div className="px-8 pb-12 pt-8">
      <div className="mx-auto max-w-[1400px]">
        <AnalyticsDashboard />
      </div>
    </div>
  );
}
