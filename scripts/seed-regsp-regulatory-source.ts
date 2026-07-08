import { createClient } from "@supabase/supabase-js";
import {
  REG_SP_REQUIREMENTS,
  type RegSpRequirement,
} from "../lib/regSpRequirements";
import {
  REG_SP_SOURCE_KEY,
  canonicalControlKeyForRequirement,
} from "../lib/regulatoryControlFramework";

type SeedChunk = {
  citationKey: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  heading: string;
  parentHeading: string;
  sectionPath: string;
  chunkKind: string;
  content: string;
  synopsis: string;
};

const seedChunks: SeedChunk[] = [
  {
    citationKey: "incident_response_program",
    chunkIndex: 0,
    pageStart: 323,
    pageEnd: 326,
    heading: "Incident response program",
    parentHeading: "Final Rule Text",
    sectionPath: "Final Rule Text > Safeguards Rule > Incident Response Program",
    chunkKind: "direct_rule_requirement",
    content:
      "Curated seed reference for amended Regulation S-P incident response program requirements under 17 CFR 248.30(a)(3), including written policies and procedures reasonably designed to detect, respond to, and recover from unauthorized access to or use of customer information.",
    synopsis:
      "Written incident response program, assessment, containment, control, and recovery obligations.",
  },
  {
    citationKey: "customer_notification_trigger",
    chunkIndex: 1,
    pageStart: 326,
    pageEnd: 329,
    heading: "Customer notification trigger and timing",
    parentHeading: "Final Rule Text",
    sectionPath: "Final Rule Text > Safeguards Rule > Customer Notification",
    chunkKind: "direct_rule_requirement",
    content:
      "Curated seed reference for customer notification requirements under 17 CFR 248.30(a)(4)(i), including notice after unauthorized access to or use of sensitive customer information unless the institution determines it is not reasonably likely to result in substantial harm or inconvenience, and outside timing of not later than 30 days after awareness.",
    synopsis:
      "Customer notice trigger, harm or inconvenience standard, and 30-day timing.",
  },
  {
    citationKey: "customer_notification_content",
    chunkIndex: 2,
    pageStart: 329,
    pageEnd: 331,
    heading: "Customer notification contents",
    parentHeading: "Final Rule Text",
    sectionPath: "Final Rule Text > Safeguards Rule > Notice Contents",
    chunkKind: "direct_rule_requirement",
    content:
      "Curated seed reference for required customer notice content under 17 CFR 248.30(a)(4)(iv), including information about the incident, affected information when known, contact information, and protective steps such as reviewing account statements, fraud alerts, credit reports, and identity theft resources.",
    synopsis:
      "Required contents of notices to affected individuals and recommended protective steps.",
  },
  {
    citationKey: "service_provider",
    chunkIndex: 3,
    pageStart: 331,
    pageEnd: 333,
    heading: "Service provider oversight and notice",
    parentHeading: "Final Rule Text",
    sectionPath: "Final Rule Text > Safeguards Rule > Service Providers",
    chunkKind: "direct_rule_requirement",
    content:
      "Curated seed reference for service provider provisions under 17 CFR 248.30(a)(5), including oversight, protection of customer information, and prompt service provider notice to the covered institution after becoming aware of a breach in security involving customer information systems.",
    synopsis:
      "Service provider oversight, customer information protection, and incident notice to the covered institution.",
  },
  {
    citationKey: "safeguards",
    chunkIndex: 4,
    pageStart: 320,
    pageEnd: 323,
    heading: "Safeguards for customer information",
    parentHeading: "Final Rule Text",
    sectionPath: "Final Rule Text > Safeguards Rule",
    chunkKind: "direct_rule_requirement",
    content:
      "Curated seed reference for Regulation S-P safeguards requirements under 17 CFR 248.30(a)(1) and the amended customer information scope, including administrative, technical, and physical safeguards for customer records and information.",
    synopsis:
      "Safeguards for customer records and information, including amended customer information scope.",
  },
  {
    citationKey: "disposal",
    chunkIndex: 5,
    pageStart: 333,
    pageEnd: 335,
    heading: "Disposal rule",
    parentHeading: "Final Rule Text",
    sectionPath: "Final Rule Text > Disposal Rule",
    chunkKind: "direct_rule_requirement",
    content:
      "Curated seed reference for amended Regulation S-P disposal requirements under 17 CFR 248.30(b), including proper disposal of consumer information and customer information using reasonable measures to protect against unauthorized access to or use during disposal.",
    synopsis:
      "Secure disposal of consumer information and customer information.",
  },
  {
    citationKey: "recordkeeping",
    chunkIndex: 6,
    pageStart: 335,
    pageEnd: 337,
    heading: "Written records documenting compliance",
    parentHeading: "Final Rule Text",
    sectionPath: "Final Rule Text > Recordkeeping",
    chunkKind: "direct_rule_requirement",
    content:
      "Curated seed reference for written recordkeeping requirements under 17 CFR 248.30(c), including records documenting compliance with safeguards and disposal rules, incident response and notification determinations, notices, and policies and procedures.",
    synopsis:
      "Written compliance records, determinations, notices, and retention expectations.",
  },
  {
    citationKey: "attorney_general_delay",
    chunkIndex: 7,
    pageStart: 327,
    pageEnd: 330,
    heading: "Notification delay and law enforcement coordination",
    parentHeading: "Final Rule Text",
    sectionPath: "Final Rule Text > Customer Notification > Delay",
    chunkKind: "exception",
    content:
      "Curated seed reference for notification delay mechanics related to Attorney General determinations where notice would pose a substantial risk to national security or public safety.",
    synopsis:
      "Law enforcement and Attorney General delay mechanics related to customer notification timing.",
  },
  {
    citationKey: "compliance_period",
    chunkIndex: 8,
    pageStart: 315,
    pageEnd: 319,
    heading: "Compliance period",
    parentHeading: "Final Rule Discussion",
    sectionPath: "Final Rule Discussion > Compliance Period",
    chunkKind: "compliance_date",
    content:
      "Curated seed reference for the final rule compliance period discussion, including phased compliance timing for larger and smaller covered institutions.",
    synopsis:
      "Compliance period discussion for amended Regulation S-P requirements.",
  },
];

function categoryForRequirement(requirement: RegSpRequirement) {
  if (requirement.id.includes("notification")) return "Customer notification";
  if (requirement.id.includes("vendor")) return "Service providers";
  if (requirement.id.includes("safeguards")) return "Safeguards";
  if (requirement.id.includes("disposal")) return "Disposal";
  if (requirement.id.includes("records") || requirement.id.includes("evidence")) return "Recordkeeping";
  return "Incident response";
}

function citationKeysForRequirement(requirement: RegSpRequirement) {
  switch (requirement.id) {
    case "written_incident_response_program":
    case "unauthorized_access_detection_escalation":
    case "remediation_recovery_validation":
      return ["incident_response_program"];
    case "customer_notification_unauthorized_access":
      return ["customer_notification_trigger", "attorney_general_delay"];
    case "customer_notification_content":
      return ["customer_notification_content"];
    case "vendor_incident_handling":
      return ["service_provider"];
    case "customer_information_safeguards":
      return ["safeguards"];
    case "disposal_consumer_customer_information":
      return ["disposal"];
    case "written_compliance_records":
    case "evidence_log_preservation":
      return ["recordkeeping"];
    case "regulator_law_enforcement_notification":
      return ["attorney_general_delay"];
    default:
      return ["incident_response_program"];
  }
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  const { data: source, error: sourceError } = await supabase
    .from("regulatory_sources")
    .upsert({
      source_key: REG_SP_SOURCE_KEY,
      title: "Regulation S-P: Privacy of Consumer Financial Information and Safeguarding Customer Information",
      regulator: "SEC",
      release_number: "34-100155",
      regulation: "Regulation S-P",
      source_type: "sec_final_rule",
      effective_date: "2024-08-02",
      compliance_date: "Tiered compliance period; see final rule compliance period discussion.",
      version: "2024-final-rule",
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "source_key" })
    .select("id")
    .single();

  if (sourceError || !source) {
    throw new Error(`Unable to seed regulatory source: ${sourceError?.message ?? "missing row"}`);
  }

  const chunkRows = seedChunks.map((chunk) => ({
    source_id: source.id,
    chunk_index: chunk.chunkIndex,
    page_start: chunk.pageStart,
    page_end: chunk.pageEnd,
    heading: chunk.heading,
    parent_heading: chunk.parentHeading,
    section_path: chunk.sectionPath,
    chunk_kind: chunk.chunkKind,
    content: chunk.content,
    synopsis: chunk.synopsis,
    metadata: {
      citation_key: chunk.citationKey,
      source_type: "regulatory_reference",
      evidence_role: "requirement_reference",
      manual_seed: true,
      page_range_approximate: true,
    },
    updated_at: new Date().toISOString(),
  }));
  const { data: chunks, error: chunksError } = await supabase
    .from("regulatory_source_chunks")
    .upsert(chunkRows, { onConflict: "source_id,chunk_index" })
    .select("id, metadata");

  if (chunksError || !chunks) {
    throw new Error(`Unable to seed regulatory source chunks: ${chunksError?.message ?? "missing rows"}`);
  }

  const chunkIdByCitationKey = new Map(
    chunks.map((chunk) => [
      (chunk.metadata as { citation_key?: string } | null)?.citation_key,
      chunk.id as string,
    ]),
  );

  const controlRows = REG_SP_REQUIREMENTS.map((requirement, index) => ({
    control_key: canonicalControlKeyForRequirement(requirement),
    control_name: requirement.title,
    requirement_text: requirement.description,
    name: requirement.title,
    regulation: "Reg S-P",
    source_key: REG_SP_SOURCE_KEY,
    category: categoryForRequirement(requirement),
    summary: requirement.description,
    regulatory_role: requirement.regulatoryRole,
    severity: requirement.regulatoryRole === "supporting_control" ? "medium" : "high",
    status: "active",
    display_order: index + 1,
    metadata: {
      legacy_requirement_id: requirement.id,
      sourceBasis: requirement.sourceBasis,
      mvpScope: requirement.mvpScope,
      evidenceCriteria: requirement.evidenceCriteria,
      retrievalQuery: requirement.retrievalQuery,
      directSignals: requirement.directSignals,
      actionSignals: requirement.actionSignals,
      topicSignals: requirement.topicSignals,
      partialSignals: requirement.partialSignals,
      backgroundSignals: requirement.backgroundSignals,
      negativeSignals: requirement.negativeSignals ?? [],
      seed_version: "regsp-11-v1",
    },
    updated_at: new Date().toISOString(),
  }));
  const { data: controls, error: controlsError } = await supabase
    .from("controls")
    .upsert(controlRows, { onConflict: "control_key" })
    .select("id, control_key, metadata");

  if (controlsError || !controls) {
    throw new Error(`Unable to seed controls: ${controlsError?.message ?? "missing rows"}`);
  }

  const controlIds = controls.map((control) => control.id as string);
  await supabase.from("control_citations").delete().in("control_id", controlIds);
  await supabase.from("control_elements").delete().in("control_id", controlIds);

  const requirementByControlKey = new Map<string, RegSpRequirement>(
    REG_SP_REQUIREMENTS.map((requirement) => [
      canonicalControlKeyForRequirement(requirement),
      requirement,
    ]),
  );
  const elementRows = controls.flatMap((control) => {
    const requirement = requirementByControlKey.get(control.control_key as string);
    if (!requirement) return [];
    return requirement.coverageElements.map((element, index) => ({
      control_id: control.id,
      element_key: element.id,
      label: element.label,
      description: element.label,
      required: element.requiredForCovered,
      evidence_question: requirement.evidenceCriteria.lookFor,
      missing_if_absent: element.requiredForCovered,
      display_order: index + 1,
      metadata: {
        signals: element.signals,
      },
    }));
  });
  const { error: elementsError } = await supabase.from("control_elements").insert(elementRows);
  if (elementsError) {
    throw new Error(`Unable to seed control elements: ${elementsError.message}`);
  }

  const citationRows = controls.flatMap((control) => {
    const requirement = requirementByControlKey.get(control.control_key as string);
    if (!requirement) return [];
    return citationKeysForRequirement(requirement).map((citationKey, index) => ({
      control_id: control.id,
      source_chunk_id: chunkIdByCitationKey.get(citationKey),
      citation_type: index === 0 ? "primary" : "supporting",
      citation_note: requirement.sourceBasis,
      display_order: index + 1,
      metadata: {
        citation_key: citationKey,
        source_type: "regulatory_reference",
        evidence_role: "requirement_reference",
      },
    })).filter((row) => row.source_chunk_id);
  });
  const { error: citationsError } = await supabase.from("control_citations").insert(citationRows);
  if (citationsError) {
    throw new Error(`Unable to seed control citations: ${citationsError.message}`);
  }

  console.info(`Seeded ${controls.length} controls, ${elementRows.length} control elements, and ${citationRows.length} citations.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
