import React from "react";
import { Document, Page, Text, View, Link, Image as PdfImage, Font, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { STATUS_COLORS, STATUS_DEFINITIONS, STATUS_LABELS, STATUS_ORDER, evidencePageReference, REPORT_REVIEW_REQUIREMENT, findingPresentation, type AssessmentReport } from "./assessmentReport";

// Unmodified Adobe static TTFs, SIL Open Font License 1.1. See public/fonts/report.
// Explicit weights avoid synthetic bold or implicit fallbacks; rendering is offline.
const fontRoot = path.join(process.cwd(), "public/fonts/report");
for (const [family, prefix] of [["Source Serif 4", "SourceSerif4"], ["Source Sans 3", "SourceSans3"]]) {
  Font.register({ family, fonts: [
    { src: path.join(fontRoot, `${prefix}-Regular.ttf`), fontWeight: 400 },
    { src: path.join(fontRoot, `${prefix}-Semibold.ttf`), fontWeight: 600 },
  ] });
}
Font.registerHyphenationCallback(word => word.length > 40 ? Array.from(word) : [word]);
import { createPdfEvidenceReferences, findingDestination, evidenceDestination } from "./assessmentPdfPresentation";

const navy = "#192D43";
const slate = "#617080";
const line = "#D7DCE0";
const s = StyleSheet.create({
  page: { paddingTop: 88, paddingBottom: 58, paddingHorizontal: 48, fontFamily: "Source Sans 3", fontWeight: 400, fontSize: 10.5, lineHeight: 1.4, color: navy, backgroundColor: "#FFFFFF" },
  header: { position: "absolute", top: 27, left: 48, width: 516, height: 35, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 0.6, borderBottomColor: line, paddingBottom: 9 },
  brand: { flexDirection: "row", alignItems: "center", gap: 6 }, logo: { width: 17, height: 17 }, wordmark: { fontFamily: "Source Sans 3", fontSize: 13, lineHeight: 1.2, color: navy },
  meta: { fontSize: 8.5, lineHeight: 1.3, color: slate, maxWidth: 325, textAlign: "right" },
  footer: { position: "absolute", top: 745, left: 48, width: 516, height: 23, borderTopWidth: 0.6, borderTopColor: line, paddingTop: 7, fontSize: 8, color: slate },
  pageNumber: { position: "absolute", top: 752, left: 496, width: 68, textAlign: "right", fontSize: 8, color: slate },
  kicker: { fontSize: 9.5, color: slate, marginBottom: 11 },
  title: { fontFamily: "Source Serif 4", fontSize: 27, lineHeight: 1.14, fontWeight: 400, color: navy, marginBottom: 12 },
  subtitle: { fontSize: 12, lineHeight: 1.3, marginBottom: 8 },
  section: { fontFamily: "Source Serif 4", fontWeight: 600, fontSize: 17, lineHeight: 1.25, color: navy, marginTop: 17, marginBottom: 12 },
  h3: { fontFamily: "Source Sans 3", fontWeight: 600, fontSize: 12.5, lineHeight: 1.3, marginTop: 12, marginBottom: 6 },
  label: { fontSize: 9.5, fontWeight: 600, lineHeight: 1.3, marginBottom: 4, color: navy },
  p: { marginBottom: 7 },
  small: { fontSize: 9, lineHeight: 1.35, color: slate, marginBottom: 5 },
  technical: { fontSize: 8.5, lineHeight: 1.3, color: slate, marginBottom: 5 },
  review: { fontSize: 9, color: slate, marginBottom: 5 },
  metrics: { flexDirection: "row", borderTopWidth: 0.6, borderBottomWidth: 0.6, borderColor: line, paddingVertical: 11, marginTop: 7, marginBottom: 13 },
  metric: { width: "25%", paddingRight: 10 }, number: { fontSize: 17, fontWeight: 400, lineHeight: 1.2, marginBottom: 3 }, metricLabel: { fontSize: 9, lineHeight: 1.3, color: slate },
  bar: { flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: "#E2E8F0", marginTop: 6, marginBottom: 7 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 8 },
  priority: { flexDirection: "row", borderTopWidth: 0.5, borderTopColor: line, paddingTop: 8, marginTop: 5 },
  ordinal: { width: 27, fontFamily: "Source Sans 3", fontSize: 15, color: slate, lineHeight: 1.3 }, priorityBody: { width: 489 },
  priorityTitle: { fontSize: 10.5, fontWeight: 600, lineHeight: 1.3, marginBottom: 4 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: line, paddingVertical: 10, fontSize: 10.5, lineHeight: 1.35 },
  colHead: { position: "absolute", top: 119, left: 48, width: 516, flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#A8B1B9", paddingBottom: 8, fontWeight: 600, fontSize: 9 },
  matrixTitle: { position: "absolute", top: 81, left: 48, width: 516, fontFamily: "Source Serif 4", fontSize: 17, fontWeight: 600, color: navy },
  c1: { width: "47%", paddingRight: 12 }, c2: { width: "19%", paddingRight: 6 }, c3: { width: "24%", paddingRight: 8 }, c4: { width: "10%", textAlign: "right" },
  action: { borderTopWidth: 0.5, borderTopColor: line, paddingTop: 6, marginTop: 2, marginBottom: 4 },
  actionTitle: { fontFamily: "Source Sans 3", fontSize: 12.5, fontWeight: 600, lineHeight: 1.2, marginBottom: 3 },
  actionMeta: { fontSize: 9, color: slate, lineHeight: 1.25, marginBottom: 4 },
  actionColumns: { flexDirection: "row", marginTop: 3 }, issueCol: { width: "46%", paddingRight: 22 }, actionCol: { width: "54%" },
  findingTitle: { fontFamily: "Source Sans 3", fontSize: 15.5, fontWeight: 600, lineHeight: 1.25, marginBottom: 5 },
  findingRef: { fontFamily: "Source Sans 3", fontSize: 12.5, fontWeight: 600, color: navy, marginTop: 5, marginBottom: 3 },
  finding: { borderTopWidth: 0.6, borderTopColor: line, paddingTop: 5, marginTop: 12, marginBottom: 6 },
  findingStatus: { fontSize: 10.5, fontWeight: 600, lineHeight: 1.3, marginBottom: 3 },
  evidenceLink: { color: navy, textDecoration: "underline", fontSize: 9 },
  statusLine: { fontSize: 9.5, color: slate, lineHeight: 1.3, marginBottom: 8 },
  field: { marginTop: 5, marginBottom: 5 }, fieldLabel: { fontSize: 9.5, fontWeight: 400, color: slate, lineHeight: 1.3, marginBottom: 3 },
  sourceTitle: { fontSize: 10.5, fontWeight: 600, lineHeight: 1.3, marginBottom: 4, marginTop: 0 },
  quote: { borderLeftWidth: 0.6, borderLeftColor: "#A8B1B9", paddingLeft: 12, marginLeft: 0, marginTop: 7, marginBottom: 9, fontSize: 10.5, lineHeight: 1.45 },
  rule: { borderBottomWidth: 0.5, borderBottomColor: line, marginTop: 6, marginBottom: 0 },
  methodHeading: { fontFamily: "Source Sans 3", fontWeight: 600, fontSize: 12, lineHeight: 1.25, marginTop: 8, marginBottom: 4 },
  methodP: { marginBottom: 5 },
  scopeRow: { flexDirection: "row", marginBottom: 6 }, scopeNumber: { width: 18, fontSize: 9, color: slate }, scopeContent: { width: 498 },
});
const value = (v: string | null | undefined, fallback = "Not specified in this assessment.") => v?.trim() ? v : fallback;
const date = (v: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(v)) + " UTC";
const ordinal = (i: number) => String(i+1).padStart(2,"0");
function Block({ label, text }: { label: string; text: string }) {
  return <Text style={[s.p, { marginTop: 4 }]} orphans={2} widows={2}><Text style={{ fontSize: 9.5, color: slate }}>{label}: </Text>{text}</Text>;
}
export function AssessmentPdf({ report: r, logo }: { report: AssessmentReport; logo: string }) {
  const evidenceRefs = createPdfEvidenceReferences(r.items.flatMap(f => f.evidence));
  const refFor = (id: string) => evidenceRefs.get(id)!;
  const shell = (content: React.ReactNode, matrix = false, chapter?: string) => <Page size="LETTER" style={[s.page, matrix ? { paddingTop: 153 } : chapter ? { paddingTop: 116 } : {}]}>
    <View fixed style={s.header}><View style={s.brand}><PdfImage src={logo} style={s.logo} /><Text style={s.wordmark}>RegSpan</Text></View><Text style={s.meta}>{r.workspaceName}{"\n"}Reg S-P assessment | {date(r.run.completed_at!)}</Text></View>
    <View fixed style={s.footer}><Text>RegSpan | Documentary assessment | {r.reviewLabel}</Text></View>
    <Text fixed style={s.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    {matrix && <><Text fixed style={s.matrixTitle}>Coverage matrix</Text><View fixed style={s.colHead}><Text style={s.c1}>Assessed requirement</Text><Text style={s.c2}>Coverage</Text><Text style={s.c3}>Risk if unresolved¹</Text><Text style={s.c4}>Finding</Text></View></>}
    {!matrix && chapter && <Text fixed style={s.matrixTitle}>{chapter}</Text>}
    {content}
  </Page>;
  return <Document title={`${r.workspaceName} | Reg S-P assessment`} author="RegSpan" subject={`Documentary coverage assessment | ${r.reviewLabel}`}>
    {shell(<>
      <Text style={s.kicker}>Regulation S-P / Executive overview</Text>
      <Text style={s.title}>Documentary coverage{"\n"}and management priorities</Text>
      <Text style={s.subtitle}>{r.workspaceName}</Text>
      <Text style={s.small}>Analysis completed {date(r.run.completed_at!)}{"\n"}Report ID: {r.run.id}</Text>
      <Text style={s.review}>{r.reviewLabel} · {REPORT_REVIEW_REQUIREMENT}</Text>
      <View style={s.metrics}>{[
        [r.metrics.total, "Requirements assessed"], [r.documents.length, "Documents reviewed"], [`${Math.round(r.metrics.coveredPercent)}%`, "Fully covered"], [r.metrics.highRisk, "High-risk unresolved"],
      ].map(([n,label]) => <View key={label} style={s.metric}><Text style={s.number}>{n}</Text><Text style={s.metricLabel}>{label}</Text></View>)}</View>
      <Text style={s.label}>Documentary coverage</Text>
      <View style={s.bar}>{r.metrics.segments.filter(x=>x.count).map((x,i)=><View key={x.status} style={{ width: `${x.percent}%`, backgroundColor: STATUS_COLORS[x.status], borderLeftWidth: i ? 0.6 : 0, borderLeftColor: "#FFFFFF", height: 10 }} />)}</View>
      <View style={s.legend}>{r.metrics.segments.map(x=><Text key={x.status} style={{ fontSize: 9, color: STATUS_COLORS[x.status] }}>{STATUS_LABELS[x.status]} {x.count}</Text>)}</View>
      <Text style={s.small}>Coverage and severity are separate dimensions. High-risk unresolved counts include High and Critical findings whose status is not Covered.</Text>
      <Text style={s.h3} minPresenceAhead={75}>Key management priorities</Text>
      <Text style={s.small}>The following issues and recommendations are presented in severity order. The complete assessment and supporting sources follow.</Text>
      {r.priorities.slice(0,3).map((f,i)=><View key={f.id} style={s.priority} wrap={(f.summary?.length ?? 0)+(f.remediation?.length ?? 0)+(f.requirement_name?.length ?? 0)>850}>
        <Text style={s.ordinal}>{ordinal(i)}</Text>
        <View style={s.priorityBody}>
          <Text style={s.priorityTitle}>{value(f.requirement_name)}<Text style={{ fontWeight: 400, color: slate, fontSize: 9 }}> / {f.ref} · {f.severity}</Text></Text>
          <Text style={[s.p, { marginBottom: 4 }]}>{value(f.summary, "The stored status requires resolution or reviewer confirmation.")}</Text>
          <Text style={[s.p, { marginBottom: 4 }]}><Text style={{ color: slate }}>Action: </Text>{value(f.remediation, "No action is specified; reviewer input is required.")}</Text>
        </View>
      </View>)}
      {!r.priorities.length && <Text style={s.p}>The completed run records no unresolved findings. Review the supporting evidence and any recorded recommendations before relying on the assessment.</Text>}
    </>)}
    {shell(<>
      {r.items.map(f=><View key={f.id} style={s.row}><Text style={s.c1}>{value(f.requirement_name, "Requirement name not recorded")}</Text><Text style={[s.c2, { color: STATUS_COLORS[f.status] }]}>{STATUS_LABELS[f.status]}</Text><Text style={s.c3}>{f.status === "covered" ? "None indicated²" : f.severity}</Text><Link src={`#${findingDestination(f.ref)}`} style={[s.c4, { color: navy, textDecoration: "underline" }]}>{f.ref}</Link></View>)}
      <Text style={[s.small, { marginTop: 14 }]}>¹ Unresolved risk uses the recorded severity for unresolved findings. ² Covered findings have no unresolved risk indicated by status; their original severity is preserved in the workpapers. Select a finding reference to open its detailed assessment.</Text>
    </>, true)}
    {shell(<>
      <Text style={s.small}>Unresolved findings, ordered by severity. Recommendations are drawn from the analysis; owners and deadlines have not been assigned.</Text>
      {r.priorities.map((f,i)=>{
        const short = [f.requirement_name,f.summary,f.remediation].join(" ").length < 1100 && (f.requirement_name?.length ?? 0)<140;
        return <View key={f.id} style={s.action} wrap={!short}>
          <Text style={s.actionTitle} minPresenceAhead={short ? 0 : 65}>{ordinal(i)}. {value(f.requirement_name)}</Text>
          <Text style={s.actionMeta}>{f.ref} / <Text style={{ color: STATUS_COLORS[f.status] }}>{STATUS_LABELS[f.status]}</Text> / Risk if unresolved: {f.severity}</Text>
          <View style={s.actionColumns}>
            <View style={s.issueCol}><Text style={s.label}>Issue</Text><Text style={{ fontSize: 10.5, lineHeight: 1.35 }} orphans={2} widows={2}>{value(f.summary)}</Text></View>
            <View style={s.actionCol}><Text style={s.label}>Recommendation</Text><Text style={{ fontSize: 10.5, lineHeight: 1.35 }} orphans={2} widows={2}>{value(f.remediation, "No recommendation is specified; reviewer input is required.")}</Text></View>
          </View>
        </View>;
      })}
      {!r.priorities.length && <Text>No unresolved requirements were recorded.</Text>}
    </>, false, "Priority action plan")}
    {shell(<>
      <Text style={s.small}>Each assessment presents the conclusion, rationale and recommendation. Evidence references link to the source appendix. Reviewer verification is required before distribution or reliance.</Text>
      {r.items.map(f=>{
        const display = findingPresentation(f);
        const textLength = [f.requirement_name, f.summary, f.rationale, f.remediation, f.basis?.sourceBasis,
          ...f.evidence.map(e => `${e.id} ${e.filename}`)].join(" ").length;
        const keepTogether = textLength < 1300 && (f.requirement_name?.length ?? 0) < 140 && f.evidence.length <= 3;
        const content = <>
          {!keepTogether && <Text id={findingDestination(f.ref)} style={s.findingRef} minPresenceAhead={50}>Finding {f.ref}</Text>}
          <Text style={s.findingTitle} minPresenceAhead={keepTogether ? 0 : 65}>{keepTogether && <Text style={{ fontWeight: 400 }}>{f.ref}  </Text>}{value(f.requirement_name, "Requirement name not recorded")}</Text>
          <Text style={[s.findingStatus, { color: STATUS_COLORS[f.status], marginBottom: 8 }]}>{STATUS_LABELS[f.status]}<Text style={{ fontWeight: 400, fontSize: 9.5, color: slate }}> · Severity: {f.severity} · Risk if unresolved: {display.unresolvedRisk}</Text></Text>
          <Block label="Conclusion" text={value(display.conclusion)} />
          {display.rationale?.trim() && <Block label="Rationale" text={display.rationale} />}
          <Block label="Recommendation" text={value(f.remediation, "No recommendation is specified.")} />
          {f.evidence.length ? <Text style={[s.small, { marginTop: 4 }]}>Evidence: {f.evidence.map((e,i)=><Link key={e.id} src={`#${evidenceDestination(refFor(e.id))}`} style={s.evidenceLink}>{i ? "; " : ""}{refFor(e.id)}</Link>)}</Text> : <Text style={s.small}>No client evidence is available for this finding. This does not establish that a procedure does not exist.</Text>}
          <Text style={s.small}>Regulatory basis: {f.basis?.sourceBasis || "No matching regulatory basis is available."}</Text>
        </>;
        return keepTogether
          ? <View id={findingDestination(f.ref)} key={f.id} style={s.finding} wrap={false}>{content}</View>
          : <React.Fragment key={f.id}><View style={s.finding} />{content}</React.Fragment>;
      })}
    </>, false, "Detailed assessments")}
    {shell(<>
      <Text style={s.p}>Client source quotations are reproduced in full. Short evidence references are mapped to the original identifiers below. Regulatory authority is listed separately in the assessments.</Text>
      {r.items.map(f=><React.Fragment key={f.id}>
        <Text style={s.h3} minPresenceAhead={150}>{f.ref} / {value(f.requirement_name)}</Text>
        {!f.evidence.length && <Text style={s.p}>No client evidence is available for this finding.</Text>}
        {f.evidence.map(e=><React.Fragment key={e.id}>
          <Text id={evidenceDestination(refFor(e.id))} style={[s.sourceTitle, (e.filename?.length ?? 0) > 80 ? { fontSize: 9.5, fontWeight: 400 } : {}]} minPresenceAhead={75}>{refFor(e.id)} / {e.filename || "Source filename unavailable"}</Text>
          <Text style={s.small} minPresenceAhead={35}>{e.section_path || "Section not specified"} / {evidencePageReference(e)}{"\n"}Evidence assessment: {e.relationship?.replaceAll("_", " ") || "Not recorded"}</Text>
          {e.quotes.length ? e.quotes.map((q,i)=><React.Fragment key={i}>
            {e.quotes.length > 1 && <Text style={s.small} minPresenceAhead={30}>Source quotation {i+1} of {e.quotes.length}</Text>}
            <Text style={s.quote} orphans={3} widows={3}>{q}</Text>
          </React.Fragment>) : <Text style={s.p}>No quotation accompanies this evidence reference.</Text>}
          {e.reason && <Block label="Assessment note (not a source quotation)" text={e.reason} />}
          <Text style={s.technical}>Original evidence ID: {e.id}{"\n"}Document: {e.document_id || "ID not recorded"} / Passage: {e.chunk_id || "ID not recorded"}</Text>
          <View style={s.rule} />
        </React.Fragment>)}
        <Text style={s.technical}>Finding ID: {f.id} / Requirement ID: {value(f.requirement_id)}</Text>
      </React.Fragment>)}
    </>, false, "Evidence appendix")}
    {shell(<>
      <Text style={s.methodHeading} minPresenceAhead={45}>Assessment scope and date</Text>
      <Text style={s.methodP}>Analysis run {r.run.id}, completed {date(r.run.completed_at!)}. All assessment data and document scope come from this completed run. Export performs no additional AI analysis.</Text>
      <Text style={s.methodHeading} minPresenceAhead={50}>How to read the findings</Text>
      <Text style={s.methodP}>Conclusions, rationale, recommendations, severity and evidence assessments reproduce the selected run&apos;s stored fields. Recommendations are unedited remediation text, not approved actions. Rationale may combine supporting elements and unresolved gaps; identical conclusion and rationale are shown once. Semantic inconsistencies are not automatically detected. Short evidence references are deterministic aliases of original evidence IDs, mapped in the appendix; they do not replace the underlying identifiers.</Text>
      <Text style={s.methodHeading} minPresenceAhead={50}>Regulatory references</Text>
      <Text style={s.methodP}>Reg S-P citations use RegSpan&apos;s bundled catalog; the run has no versioned regulatory-text snapshot. References identify regulatory basis and supporting controls, and are separate from exact client quotations.</Text>
      <View wrap={r.documents.length > 5 || r.documents.map(d => d.filename || "").join(" ").length > 800}>
      <Text style={s.methodHeading} minPresenceAhead={60}>Reviewed-document scope</Text>
      {r.documents.length ? r.documents.map((d,i)=><View key={`${d.document_id}-${i}`} style={s.scopeRow} wrap={(d.filename?.length ?? 0) > 1000}>
        <Text style={s.scopeNumber}>{i+1}.</Text>
        <View style={s.scopeContent}>
          <Text style={[s.small, { marginBottom: 0 }]}>{d.filename || "Source filename unavailable"}</Text>
          <Text style={[s.technical, { marginBottom: 0 }]}>Document reference: {d.document_id || "ID not recorded"}</Text>
        </View>
      </View>) : <Text style={s.methodP}>No document snapshot was recorded for this run.</Text>}
      <Text style={s.methodHeading} minPresenceAhead={60}>Status definitions</Text>
      {STATUS_ORDER.map(status=><Text key={status} style={[s.small, { marginBottom: 3 }]}><Text style={{ fontWeight: 600 }}>{STATUS_LABELS[status]}: </Text>{STATUS_DEFINITIONS[status]}</Text>)}
      <Text style={s.methodHeading} minPresenceAhead={60}>Limitations and reviewer responsibility</Text>
      <Text style={s.methodP}>Documentary coverage is not proof of operational compliance, control effectiveness, or legal compliance. Before distribution or reliance, a qualified reviewer must verify every status, conclusion, recommendation, regulatory basis and cited source. Existing structured fields do not support reliable automated semantic consistency checks; export performs none and preserves recommendations even if inconsistent. Missing evidence may reflect document scope. Quotations are reproduced as stored, without independent revalidation. This draft does not establish reviewer approval or constitute legal advice.</Text>
      </View>
    </>, false, "Methodology and limitations")}
  </Document>;
}
export async function renderAssessmentPdf(report: AssessmentReport) {
  const logo = `data:image/png;base64,${(await readFile(path.join(process.cwd(), "public/brand/regspan-mark-64.png"))).toString("base64")}`;
  return renderToBuffer(<AssessmentPdf report={report} logo={logo} />);
}
