export type NegativeEvidenceMatch = {
  isNegativeEvidence: boolean;
  matchedPhrase: string | null;
  matchedSignal: string | null;
};

const NEGATION_WINDOW = 220;

const absencePhrases = [
  "does not define",
  "does not establish",
  "does not authorize",
  "does not require",
  "does not impose",
  "does not maintain",
  "does not create",
  "does not replace",
  "does not address",
  "does not include",
  "does not satisfy",
  "does not cover",
  "no formal",
  "lacks",
  "missing",
  "excluded",
  "reserved for another policy",
  "reserved for separate governance documents",
  "not intended to satisfy",
  "not intended to establish",
  "not required by this policy",
  "not the enterprise cyber incident response plan",
  "not a cyber incident response program",
  "not a breach response standard",
  "not a regulator notification procedure",
  "outside the scope",
];

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueSignals(signals: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const signal of signals) {
    const normalized = normalize(signal);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

export function detectNegativeEvidence(
  text: string,
  requirementSignals: string[],
): NegativeEvidenceMatch {
  const normalizedText = normalize(text);
  if (!normalizedText) {
    return {
      isNegativeEvidence: false,
      matchedPhrase: null,
      matchedSignal: null,
    };
  }

  const signals = uniqueSignals(requirementSignals)
    .filter((signal) => signal.length >= 4);
  for (const phrase of absencePhrases) {
    let searchFrom = 0;
    while (searchFrom < normalizedText.length) {
      const phraseIndex = normalizedText.indexOf(phrase, searchFrom);
      if (phraseIndex === -1) {
        break;
      }

      const window = normalizedText.slice(
        phraseIndex,
        phraseIndex + phrase.length + NEGATION_WINDOW,
      );
      const matchedSignal = signals.find((signal) => window.includes(signal));
      if (matchedSignal) {
        return {
          isNegativeEvidence: true,
          matchedPhrase: phrase,
          matchedSignal,
        };
      }

      searchFrom = phraseIndex + phrase.length;
    }
  }

  return {
    isNegativeEvidence: false,
    matchedPhrase: null,
    matchedSignal: null,
  };
}
