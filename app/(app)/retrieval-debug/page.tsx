import { notFound } from "next/navigation";
import { RetrievalDebugClient } from "@/components/RetrievalDebugClient";
import { areInternalDebugRoutesEnabled } from "@/lib/securityFeatureFlags";

export default function RetrievalDebugPage() {
  if (!areInternalDebugRoutesEnabled()) {
    notFound();
  }

  return <RetrievalDebugClient />;
}
