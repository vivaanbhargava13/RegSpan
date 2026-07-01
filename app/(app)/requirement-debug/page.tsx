import { notFound } from "next/navigation";
import { RequirementDebugClient } from "@/components/RequirementDebugClient";
import { areInternalDebugRoutesEnabled } from "@/lib/securityFeatureFlags";

export default function RequirementDebugPage() {
  if (!areInternalDebugRoutesEnabled()) {
    notFound();
  }

  return <RequirementDebugClient />;
}
