import type { Metadata } from "next";

import { DispatchDashboard } from "./dispatch-dashboard";

export const metadata: Metadata = {
  title: "Dispatch | Testimonial CRM",
  description: "Track shipments and delivery status.",
};

export default function DispatchPage() {
  return <DispatchDashboard />;
}
