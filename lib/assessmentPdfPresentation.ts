import { createHash } from "node:crypto";

/** PDF-only aliases: determined by the original ID, independent of finding/evidence order. */
export function createPdfEvidenceReferences(evidence: readonly { id: string }[]) {
  const ids = [...new Set(evidence.map(e => e.id))].sort();
  if (ids.some(id => !id)) throw new Error("Evidence requires an original identifier");
  const digests = new Map(ids.map(id => [id, createHash("sha256").update(id).digest("hex").toUpperCase()]));
  return new Map(ids.map(id => {
    const digest = digests.get(id)!;
    let length = 6;
    // Extend colliding prefixes rather than emitting an ambiguous display reference.
    while (ids.some(other => other !== id && digests.get(other)!.startsWith(digest.slice(0, length)))) {
      if (length === digest.length) throw new Error("Evidence reference collision");
      length = Math.min(length + 2, digest.length);
    }
    return [id, `E-${digest.slice(0, length)}`];
  }));
}

export const findingDestination = (reference: string) => `finding-${reference}`;
export const evidenceDestination = (displayReference: string) => `evidence-${displayReference}`;
