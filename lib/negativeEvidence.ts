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

const absencePatterns = [
  {
    label: "does not define requirement",
    pattern:
      /\bdoes not\s+(?:fully\s+|completely\s+|adequately\s+|formally\s+)?(?:define|establish|authorize|require|impose|maintain|create|replace|address|include|satisfy|cover|document|specify)\b/g,
  },
  {
    label: "not responsible for requirement",
    pattern:
      /\b(?:is|are|was|were)\s+not\s+(?:intended\s+to\s+|designed\s+to\s+|responsible\s+for\s+)?(?:define|establish|authorize|require|replace|satisfy|cover|address)\b/g,
  },
  {
    label: "handled in separate document",
    pattern:
      /\b(?:handled|covered|defined|established|addressed)\s+(?:in|by)\s+(?:a\s+|another\s+|separate\s+|the\s+separate\s+)?(?:policy|procedure|standard|program|plan|document|governance\s+document)\b/g,
  },
  {
    label: "excluded or out of scope",
    pattern:
      /\b(?:excludes?|outside\s+the\s+scope|out\s+of\s+scope|reserved\s+for\s+(?:another|separate)|delegated\s+to\s+(?:another|separate))\b/g,
  },
  {
    label: "no formal requirement",
    pattern:
      /\b(?:no|without)\s+(?:formal\s+|documented\s+|written\s+)?(?:program|plan|procedure|policy|standard|requirement|notification|reporting|validation|preservation|process)\b/g,
  },
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

function negativeEvidenceWindow(text: string, phraseIndex: number, phraseLength: number) {
  return text.slice(
    Math.max(0, phraseIndex - Math.floor(NEGATION_WINDOW / 2)),
    phraseIndex + phraseLength + NEGATION_WINDOW,
  );
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

      const window = negativeEvidenceWindow(normalizedText, phraseIndex, phrase.length);
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

  for (const { label, pattern } of absencePatterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(normalizedText);
    while (match) {
      const phraseIndex = match.index;
      const phrase = match[0] || label;
      const window = negativeEvidenceWindow(normalizedText, phraseIndex, phrase.length);
      const matchedSignal = signals.find((signal) => window.includes(signal));
      if (matchedSignal) {
        return {
          isNegativeEvidence: true,
          matchedPhrase: phrase,
          matchedSignal,
        };
      }
      match = pattern.exec(normalizedText);
    }
  }

  return {
    isNegativeEvidence: false,
    matchedPhrase: null,
    matchedSignal: null,
  };
}
