import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";
import { createHash } from "node:crypto";
import ts from "typescript";
register("../scripts/serverTsLoader.mjs", import.meta.url);
const { createAssessmentReport, reportMetrics, exactQuotes, findingPresentation, REPORT_REVIEW_LABEL, REPORT_REVIEW_REQUIREMENT } = await import("../lib/assessmentReport.ts");
const { createPdfEvidenceReferences, findingDestination, evidenceDestination } = await import("../lib/assessmentPdfPresentation.ts");
const { syntheticAssessment, typicalSyntheticAssessment } = await import("../scripts/sampleAssessmentPdf.ts");

test("all five statuses reconcile; severity is independent of coverage", () => {
  const r = createAssessmentReport(syntheticAssessment());
  assert.equal(r.metrics.total, 5);
  assert.deepEqual(Object.values(r.metrics.counts), [1,1,1,1,1]);
  assert.equal(r.metrics.coveredPercent, 20);
  assert.equal(r.metrics.highRisk, 2);
  assert.equal(r.metrics.unresolved, 4);
  assert.equal(r.metrics.segments.reduce((n,s)=>n+s.percent,0), 100);
  assert.deepEqual(r.priorities.map(f=>f.severity), ["critical", "high", "medium", "low"]);
  assert.equal(reportMetrics([]).coveredPercent, 0);
  assert.throws(()=>reportMetrics([{status:"unexpected",severity:"high"}]), /Unknown/);
});

test("report rejects mixed workspaces, runs, incomplete runs and inconsistent counts", () => {
  for (const mutate of [
    x=>x.run.workspace_id="foreign", x=>x.findings[0].workspace_id="foreign",
    x=>x.findings[0].analysis_run_id="other-run", x=>x.run.status="running",
    x=>x.run.completed_at=null, x=>x.run.finding_count++, x=>x.run.requirement_count++,
    x=>x.findings[1].id=x.findings[0].id, x=>x.findings[1].requirement_id=x.findings[0].requirement_id,
    x=>x.findings[0].severity="unknown",
  ]) { const input=syntheticAssessment(); mutate(input); assert.throws(()=>createAssessmentReport(input)); }
});

test("quotes preserve exact text, alternate fields and missing evidence", () => {
  const text = '  Exact “quoted” text.\nSecond line — unchanged.  ';
  assert.deepEqual(exactQuotes({quote:text,evidence_quote:"alternate"}), [text,"alternate"]);
  assert.deepEqual(exactQuotes({quote:text,evidence_quote:text}), [text]);
  assert.deepEqual(exactQuotes({quote:" ",evidence_quote:null}), []);
  const r=createAssessmentReport(syntheticAssessment());
  assert.equal(r.items[2].relevant, undefined);
  assert.equal(r.items[2].evidence.length, 0);
  assert.equal(r.items[1].evidence[0].quotes.length, 2);
  assert.equal(r.items[4].evidence[0].quotes[0], syntheticAssessment().findings[4].evidence[0].quote);
});

// Exercise the actual shared loader with a scoped in-memory Supabase stand-in.
async function loaderWithFakeClient() {
  const src=await readFile("lib/findingsData.ts","utf8");
  const output=ts.transpileModule(src.replace('import "server-only";', ''), {compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}
test("shared loader scopes every query and only joins evidence from selected findings", async () => {
  const {loadWorkspaceFindings}=await loaderWithFakeClient();
  const calls=[];
  const run={id:"run-a",workspace_id:"ws-a",status:"completed",completed_at:"2026-11-14T15:30:00Z"};
  const rows={
    document_chunks:[{id:"a",workspace_id:"ws-a"},{id:"b",workspace_id:"ws-b"}],
    analysis_run_documents:[{workspace_id:"ws-a",analysis_run_id:"old-run",filename:"SECRET-OLD-SCOPE.pdf"},{workspace_id:"ws-a",analysis_run_id:"run-a",filename:"a.pdf"},{workspace_id:"ws-b",analysis_run_id:"run-b",filename:"SECRET.pdf"}],
    findings:[{id:"finding-a",workspace_id:"ws-a",analysis_run_id:"run-a"},{id:"finding-b",workspace_id:"ws-b",analysis_run_id:"run-b"},{id:"old-a",workspace_id:"ws-a",analysis_run_id:"old-run"}],
    finding_evidence:[{id:"e-a",workspace_id:"ws-a",finding_id:"finding-a",quote:"visible"},{id:"e-b",workspace_id:"ws-b",finding_id:"finding-a",quote:"SECRET"},{id:"old-e",workspace_id:"ws-a",finding_id:"old-a",quote:"OLD"}],
  };
  rows.finding_evidence.push(...Array.from({length:600},(_,i)=>({id:`extra-${i}`,workspace_id:"ws-a",finding_id:"finding-a",quote:`visible extra ${i}`})));
  const client={rpc:async(name,args)=>{assert.equal(args.p_workspace_id,"ws-a");return {data:{latest_run:run,active_run:null,invalid_latest_run:null}};},from(table){let data=rows[table]; const filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);data=data.filter(r=>r[k]===v);return q},in(k,vs){filters.push([k,vs]);data=data.filter(r=>vs.includes(r[k]));return q},order(){return q},range(from,to){data=data.slice(from,to+1);return q},limit(n){data=data.slice(0,n);return q},then(resolve){calls.push({table,filters});resolve({data,error:null})}};return q;}};
  const result=await loadWorkspaceFindings(client,"ws-a");
  assert.equal(result.findings.length,1);
  assert.equal(result.findings[0].evidence[0].quote,"visible");
  assert.equal(result.findings[0].evidence.length,601);
  assert.equal(result.findings[0].evidence.at(-1).quote,"visible extra 599");
  assert.equal(result.reviewedDocuments.length,1);
  assert.doesNotMatch(JSON.stringify(result),/SECRET|OLD/);
  for(const c of calls) assert.ok(c.filters.some(([k,v])=>k==="workspace_id"&&v==="ws-a"));
});

test("PDF endpoint derives workspace through authentication and pins the displayed run", async () => {
  const route=await readFile("app/api/findings/export/pdf/route.ts","utf8");
  assert.match(route,/authenticateRequestOrSession\(supabase, request\)/);
  assert.match(route,/getActorWorkspaceId\(supabase, actor.user.id\)/);
  assert.match(route,/loadWorkspaceFindings\(supabase, workspaceId\)/);
  assert.match(route,/requestedRun !== data.latestRun.id/);
  assert.match(route,/private, no-store/);
  assert.doesNotMatch(route,/request.json|searchParams.get\("workspace/);
});

test("long, selectable PDF content renders with Letter pages and intact final clauses", async () => {
  const { renderAssessmentPdf } = await import("../lib/assessmentPdf.tsx");
  const { PDFParse } = await import("pdf-parse");
  const input=syntheticAssessment();
  // Force matrix continuation with a requirement name longer than one page.
  input.findings[0].requirement_name="Synthetic extended requirement ".repeat(250)+"MATRIX-END-MARKER";
  const pdf=await renderAssessmentPdf(createAssessmentReport(input));
  assert.equal(pdf.subarray(0,5).toString(),"%PDF-");
  const parser=new PDFParse({data:new Uint8Array(pdf)});
  try {
    const result=await parser.getText();
    assert.ok(result.total>10);
    assert.match(result.text,/MATRIX-END-MARKER/);
    assert.match(result.text,/Synthetic clause 26/);
    assert.match(result.text,/No client evidence is available for this finding/);
    assert.match(result.text,/SYNTHETIC ALTERNATE SOURCE/);
    assert.match(result.text.replace(/\s+/g," "),/not proof of operational compliance/);
    assert.match(result.text,/RegSpan \| Documentary assessment/);
    for (const [i, page] of result.pages.entries()) assert.ok(page.text.includes(`${i+1} / ${result.total}`), `Page ${i+1} has a page number`);
    const info=await parser.getInfo({parsePageInfo:true});
    for(const page of info.pages) {assert.equal(page.width,612);assert.equal(page.height,792);}
    const {getDocument}=await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc=await getDocument({data:new Uint8Array(pdf),useSystemFonts:true}).promise;
    try {
      const destination=await doc.getDestination(findingDestination("F-01"));
      assert.ok(destination);
      const page=await doc.getPage(await doc.getPageIndex(destination[0])+1);
      const content=await page.getTextContent();
      const anchor=content.items.find(item=>item.str?.trim()==="F-01");
      assert.ok(anchor,"Oversized findings must link to their beginning");
      assert.ok(Math.abs(destination[3]-anchor.transform[5])<40,"Oversized finding anchor uses page coordinates");
    } finally {await doc.destroy();}
  } finally {await parser.destroy();}
});

test("endpoint rejects unauthenticated exports and ignores client-supplied workspace or findings", async () => {
  let actorAllowed=false;
  const input=syntheticAssessment();
  let rendered=0;
  const scopeCalls=[];
  const client={from(table){assert.equal(table,"workspaces"); const q={select(){return q},eq(key,id){assert.equal(key,"id");assert.equal(id,input.workspaceId);return q},async maybeSingle(){return {data:{name:input.workspaceName}}}};return q;}};
  globalThis.__assessmentRouteTest={
    NextResponse:Response,
    authenticateRequestOrSession:async()=>{if(!actorAllowed)throw new Error("unauthenticated");return {user:{id:"user-a"}};},
    documentErrorResponse:e=>({body:{error:e.message},status:401}),
    getActorWorkspaceId:async(db,user)=>{assert.equal(user,"user-a");return input.workspaceId;},
    getCorrelationId:()=>"test",
    getServerSupabaseAdminClient:()=>client,
    loadWorkspaceFindings:async(db,ws)=>{scopeCalls.push(ws);return {latestRun:input.run,findings:input.findings,reviewedDocuments:input.documents};},
    createAssessmentReport,
    renderAssessmentPdf:async r=>{rendered++;assert.equal(r.workspaceId,input.workspaceId);assert.equal(r.run.id,input.run.id);assert.equal(r.reviewLabel,REPORT_REVIEW_LABEL);return Buffer.from("%PDF-test");},
  };
  try {
    const source=await readFile("app/api/findings/export/pdf/route.ts","utf8");
    const transformed=source.replace(/^import .*;\n/gm,"");
    const prelude=`const {NextResponse, authenticateRequestOrSession, documentErrorResponse, getActorWorkspaceId, getCorrelationId, getServerSupabaseAdminClient, loadWorkspaceFindings, createAssessmentReport, renderAssessmentPdf} = globalThis.__assessmentRouteTest;\n`;
    const code=ts.transpileModule(prelude+transformed,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
    const {GET}=await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    const originalError=console.error; console.error=()=>{};
    try {assert.equal((await GET(new Request("https://example.test/api/findings/export/pdf"))).status,401);} finally {console.error=originalError;}
    assert.equal(scopeCalls.length,0);
    actorAllowed=true;
    const response=await GET(new Request(`https://example.test/api/findings/export/pdf?runId=${input.run.id}&workspaceId=foreign&findings=forged&approved=true`));
    assert.equal(response.status,200);
    assert.equal(response.headers.get("Content-Type"),"application/pdf");
    assert.deepEqual(scopeCalls,[input.workspaceId]);
    assert.equal(rendered,1);
    assert.equal((await GET(new Request("https://example.test/api/findings/export/pdf?runId=foreign-run"))).status,409);
    assert.equal(rendered,1);
    for (const [object, key, foreignValue] of [
      [input.findings[0], "analysis_run_id", "different-completed-run"],
      [input.findings[0], "workspace_id", "foreign-workspace"],
      [input.run, "workspace_id", "foreign-workspace"],
    ]) {
      const original=object[key];
      object[key]=foreignValue;
      assert.equal((await GET(new Request(`https://example.test/api/findings/export/pdf?runId=${input.run.id}`))).status,409);
      assert.equal(rendered,1);
      object[key]=original;
    }
    input.run.status="running";
    assert.equal((await GET(new Request("https://example.test/api/findings/export/pdf"))).status,409);
    assert.equal(rendered,1);
  } finally {delete globalThis.__assessmentRouteTest;}
});


test("presentation deduplicates narrative and preserves recorded recommendations and severity", () => {
  const input = typicalSyntheticAssessment();
  const snapshot = structuredClone(input);
  const covered = input.findings[3];
  assert.equal(covered.status, "covered");
  assert.match(covered.remediation, /No notice content is documented/);
  const display = findingPresentation(covered);
  assert.equal(display.unresolvedRisk, "None indicated (Covered)");
  assert.equal(covered.severity, "medium");
  assert.equal(findingPresentation(input.findings[0]).rationale, null);
  assert.equal(findingPresentation({...covered, summary:null}).conclusion, covered.rationale);
  assert.equal(findingPresentation({...covered, summary:null}).rationale, null);
  assert.equal(findingPresentation({...covered, status:"partial"}).unresolvedRisk, "medium");
  const report = createAssessmentReport(input);
  assert.deepEqual(input, snapshot);
  assert.equal(report.metrics.total, 11);
  assert.equal(report.metrics.counts.covered, 5);
  assert.equal(report.metrics.unresolved, 6);
  assert.equal(report.metrics.highRisk, 3);
  assert.equal(report.items[3].remediation, covered.remediation);
  assert.deepEqual(report.priorities.slice(0,3).map(f=>f.ref), ["F-05","F-02","F-03"]);
});

test("executive samples retain full appendix-only quotations, readable text and efficient pagination", async () => {
  const { renderAssessmentPdf } = await import("../lib/assessmentPdf.tsx");
  const { PDFParse } = await import("pdf-parse");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const normalize = text => text.replace(/\s+/g," ").trim();
  for (const input of [typicalSyntheticAssessment(), syntheticAssessment()]) {
    const report = createAssessmentReport(input);
    const pdf = await renderAssessmentPdf(report);
    const fontDescriptors = pdf.toString("latin1");
    for(const name of ["SourceSerif4-Regular", "SourceSerif4-Semibold", "SourceSans3-Regular", "SourceSans3-Semibold"]) assert.ok(fontDescriptors.includes(name), `Missing font ${name}`);
    assert.equal((fontDescriptors.match(/\/FontFile2/g) || []).length,4, "All four static font faces must be embedded");
    assert.doesNotMatch(fontDescriptors,/\/FontName \/[^\n]*(Geist|Helvetica)/);
    const parser = new PDFParse({data:new Uint8Array(pdf)});
    try {
      const text = await parser.getText();
      console.log(`${input.run.id}: ${text.total} pages`);
      const appendixIndex = text.text.indexOf("Evidence appendix");
      assert.ok(appendixIndex>0);
      const beforeAppendix = text.text.slice(0,appendixIndex);
      const evidenceRefs=createPdfEvidenceReferences(report.items.flatMap(f=>f.evidence));
      for(const [id, reference] of evidenceRefs) {
        assert.ok(!beforeAppendix.includes(id), "Original evidence IDs belong in the appendix");
        assert.ok(beforeAppendix.includes(reference), "Missing main-report display reference");
        assert.ok(text.text.slice(appendixIndex).includes(id), "Missing original evidence ID mapping");
        assert.ok(text.text.slice(appendixIndex).includes(reference), "Missing appendix display reference");
      }
      const actionPages=text.pages.filter(page=>page.text.includes("Priority action plan"));
      assert.equal(actionPages.length,1,"The sample action plan should form one complete page");
      for(const finding of report.priorities) assert.ok(actionPages[0].text.includes(finding.ref));
      const appendix = normalize(text.text.slice(appendixIndex));
      assert.doesNotMatch(beforeAppendix,/SYNTHETIC SOURCE:|SYNTHETIC ALTERNATE SOURCE:|Synthetic clause/);
      assert.match(text.pages[0].text,/Key management priorities/);
      assert.match(text.pages[0].text,/Action:/);
      for(const priority of report.priorities.slice(0,3)) assert.ok(text.pages[0].text.includes(priority.ref), "All management priorities belong on the executive page");
      assert.match(beforeAppendix,/Recommendation/);
      assert.match(beforeAppendix,/Severity: high/);
      assert.match(beforeAppendix,/Risk if unresolved: None indicated \(Covered\)/);
      assert.match(normalize(text.text),/Recommendations are unedited/);
      // No empty or single-paragraph continuation pages.
      for (const page of text.pages) assert.ok(page.text.length>450, `Unexpected sparse page ${page.num}`);
      for (const [i,page] of text.pages.entries()) {
        assert.ok(page.text.includes(`${i+1} / ${text.total}`));
        assert.ok(page.text.includes(REPORT_REVIEW_LABEL), `Missing draft designation on page ${i+1}`);
      }
      assert.ok(normalize(text.pages[0].text).includes(REPORT_REVIEW_REQUIREMENT));
      assert.match(normalize(text.text), /Semantic inconsistencies are not automatically detected/);
      assert.match(normalize(text.text), /Existing structured fields do not support reliable automated semantic consistency checks/);
      if (report.metrics.total===11) {
        assert.ok(text.total<=16);
        for (const finding of report.items) {
          for (const evidence of finding.evidence) for (const quote of evidence.quotes) assert.ok(appendix.includes(normalize(quote)), evidence.id);
          assert.ok(appendix.includes(normalize(finding.basis.sourceBasis)) || beforeAppendix.replace(/\s+/g," ").includes(normalize(finding.basis.sourceBasis)));
        }
        const workpapers = beforeAppendix.slice(beforeAppendix.indexOf("Detailed assessments"));
        assert.equal(workpapers.split(input.findings[0].summary).length-1, 1);
        assert.ok(normalize(workpapers).includes(input.findings[3].remediation));
        assert.equal(text.pages[0].text.includes("Coverage matrix"), false);
      } else {
        assert.ok(text.total<=12);
        assert.equal(text.text.split("Synthetic clause 26").length-1, 1);
      }
      // Check actual rendered glyph geometry, including filenames and quotation text.
      const task=getDocument({data:new Uint8Array(pdf),useSystemFonts:true});
      const doc=await task.promise;
      try {
        const linkTargets=new Set();
        for(let n=1;n<=doc.numPages;n++) {
          const annotations=await (await doc.getPage(n)).getAnnotations();
          for(const link of annotations.filter(a=>a.subtype==="Link" && typeof a.dest==="string")) linkTargets.add(link.dest);
        }
        for(const finding of report.items) {
          const name=findingDestination(finding.ref);
          assert.ok(linkTargets.has(name),`No matrix link for ${finding.ref}`);
          const destination=await doc.getDestination(name);
          assert.ok(destination,`Missing finding destination ${name}`);
          const target=await doc.getPage(await doc.getPageIndex(destination[0])+1);
          const content=await target.getTextContent();
          const label=content.items.find(item=>item.str===`Finding ${finding.ref}` || item.str?.trim()===finding.ref);
          assert.ok(label,`Destination goes to wrong finding page: ${name}`);
          assert.ok(Math.abs(destination[3]-label.transform[5])<40,`Destination misses finding heading: ${name}`);
        }
        for(const [id,reference] of evidenceRefs) {
          const name=evidenceDestination(reference);
          assert.ok(linkTargets.has(name),`Missing evidence link: ${id}`);
          const destination=await doc.getDestination(name);
          assert.ok(destination,`Missing evidence destination: ${reference}`);
          const target=await doc.getPage(await doc.getPageIndex(destination[0])+1);
          const content=await target.getTextContent();
          assert.ok(content.items.some(item=>item.str?.includes(reference)),`Evidence link goes to wrong source: ${reference}`);
        }
        let quotationFontChecked=false;
        let hangingListChecked=false;
        const bodyText=[];
        for(let n=1;n<=doc.numPages;n++) {
          const page=await doc.getPage(n);
          const content=await page.getTextContent();
          if(input.findings.length===5 && content.items.some(item=>item.str==="Reviewed-document scope")) {
            const number=content.items.find(item=>["3", "3."].includes(item.str) && Math.abs(item.transform[4]-48)<1);
            assert.ok(number, "Missing third document number");
            const filenameStart=content.items.find(item=>item.str?.startsWith("SYNTHETIC_LongUnbrokenFilename"));
            assert.ok(filenameStart, "Missing long filename in document scope");
            assert.ok(Math.abs(number.transform[5]-filenameStart.transform[5])<1, "Document number detached from filename");
            assert.ok(filenameStart.transform[4]>=number.transform[4]+17, "Filename lacks hanging indent");
            hangingListChecked=true;
          }
          bodyText.push(content.items.filter(item=>item.str?.trim() && item.transform[5]>58 && item.transform[5]<680).map(item=>item.str).join(" "));
          for(const item of content.items.filter(item=>item.str?.trim())) {
            assert.ok(item.transform[4]>=43 && item.transform[4]+item.width<=570, `Horizontal overflow on page ${n}: ${item.str}`);
            assert.ok(item.transform[5]>=26 && item.transform[5]<=767, `Vertical overflow on page ${n}: ${item.str}`);
            if(item.str.startsWith("SYNTHETIC SOURCE:") || item.str.startsWith("Synthetic clause")) {
              assert.ok(item.height>=10.4, `Unreadable quotation font: ${item.height}`);
              quotationFontChecked=true;
            }
          }
        }
        assert.ok(quotationFontChecked);
        if(input.findings.length===5) assert.ok(hangingListChecked);
        const sourceText=normalize(bodyText.join(" "));
        if(input.findings.length===11) for(const finding of input.findings) {
          for(const field of [finding.summary, finding.rationale, finding.remediation]) if(field?.trim()) assert.ok(sourceText.includes(normalize(field)), `Assessment text changed: ${finding.id}`);
        }
        // Remove only repeated page furniture through geometry, then compare complete
        // quotation strings, including the stress excerpt across page boundaries.
        for(const finding of report.items) for(const evidence of finding.evidence) for(const quote of evidence.quotes) {
          assert.ok(sourceText.includes(normalize(quote)), `Incomplete quotation: ${evidence.id}`);
        }
      } finally {await doc.destroy();}
    } finally {await parser.destroy();}
  }
});


test("completed runs remain unreviewed despite unverified approval metadata", () => {
  const input=typicalSyntheticAssessment();
  const report=createAssessmentReport({
    ...input, reviewLabel:"Approved", approval_status:"approved", reviewed_by:"unverified-person",
    run:{...input.run, approved:true, review_status:"approved"},
  });
  assert.equal(report.reviewLabel,"Draft / Not Independently Reviewed");
  assert.deepEqual(report.findings,input.findings);
  assert.equal(report.items[3].status,"covered");
  assert.equal(report.items[3].remediation,"No notice content is documented. Draft a complete customer-notice template.");
  // Export does not claim to detect contradictions from free text or rewrite them.
  for(const remediation of ["No notice content is documented.","Maintain the existing template.","Reviewer input required."]) {
    const caseInput=typicalSyntheticAssessment();
    caseInput.findings[3].remediation=remediation;
    const result=createAssessmentReport(caseInput);
    assert.equal(result.items[3].status,"covered");
    assert.equal(result.items[3].remediation,remediation);
    assert.equal(result.reviewLabel,REPORT_REVIEW_LABEL);
    assert.deepEqual(result.metrics,report.metrics);
  }
});


test("report fonts are licensed static assets with pinned upstream checksums", async () => {
  const sources=JSON.parse(await readFile("public/fonts/report/sources.json","utf8"));
  assert.equal(sources.length,4);
  for(const source of sources) {
    assert.match(source.url,/^https:\/\/raw.githubuserconten[t]\.com\/adobe-fonts\/source-(serif|sans)\/[a-f0-9]{40}\/TTF\//);
    const asset=await readFile(`public/fonts/report/${source.file}`);
    assert.equal(createHash("sha256").update(asset).digest("hex"),source.sha256);
  }
  for(const name of ["SourceSerif4","SourceSans3"]) {
    assert.match(await readFile(`public/fonts/report/${name}-LICENSE.md`,"utf8"),/SIL OPEN FONT LICENSE|SIL Open Font License/);
  }
  const config=await readFile("next.config.ts","utf8");
  assert.ok(config.includes('./public/fonts/report/*.ttf'));
});


test("PDF evidence references are stable, unique aliases and do not mutate source records", () => {
  const records=typicalSyntheticAssessment().findings.flatMap(f=>f.evidence);
  const original=structuredClone(records);
  const refs=createPdfEvidenceReferences(records);
  const shuffled=createPdfEvidenceReferences([...records].reverse());
  assert.deepEqual([...refs],[...shuffled]);
  assert.equal(refs.size,new Set(records.map(e=>e.id)).size);
  assert.equal(new Set(refs.values()).size,refs.size);
  for(const reference of refs.values()) assert.match(reference,/^E-[A-F0-9]{6,64}$/);
  const extended=createPdfEvidenceReferences([...records,{id:"additional-independent-source"},records[0]]);
  for(const [id,reference] of refs) assert.equal(extended.get(id),reference);
  assert.deepEqual(records,original);
  assert.throws(()=>createPdfEvidenceReferences([{id:""}]),/identifier/);
});


test("colliding short evidence prefixes extend deterministically without ambiguity", () => {
  // These IDs share the six-character SHA-256 prefix EE471A.
  const ids=[{id:"pdf-evidence-496"},{id:"pdf-evidence-3551"}];
  const refs=createPdfEvidenceReferences(ids);
  assert.equal(new Set(refs.values()).size,2);
  for(const reference of refs.values()) assert.ok(reference.length>8);
  assert.deepEqual([...refs],[...createPdfEvidenceReferences([...ids].reverse())]);
});


test("PDF typography reserves serif for the report title and major sections", async () => {
  const template=await readFile("lib/assessmentPdf.tsx","utf8");
  const styles=template.split("const s = StyleSheet.create({")[1].split("\n});")[0];
  const serifRoles=[...styles.matchAll(/(\w+): \{[^{}]*fontFamily: "Source Serif 4"/g)].map(match=>match[1]);
  assert.deepEqual(serifRoles,["title","section","matrixTitle"]);
  for(const role of ["wordmark","h3","ordinal","actionTitle","findingTitle","findingRef","methodHeading"]) {
    assert.match(styles,new RegExp(`${role}: \\{[^{}]*fontFamily: "Source Sans 3"`));
  }
  assert.match(styles,/page: \{[^{}]*fontFamily: "Source Sans 3"[^{}]*fontWeight: 400[^{}]*fontSize: 10\.5/);
  assert.doesNotMatch(styles,/fontWeight: (?:700|800|900|"bold")/);
});
