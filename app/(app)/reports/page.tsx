import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { Surface } from "@/components/Surface";
import { StatusBadge } from "@/components/StatusBadge";

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports"
        title="Reports are exported from Analysis"
        description="Use Analysis to review findings, client source excerpts, and Reg S-P basis links before copying or exporting the Markdown report."
        actions={
          <Button href="/findings" variant="appPrimary">
            Open Analysis
          </Button>
        }
      />

      <Surface as="section" padding="none" className="overflow-hidden">
        <div className="border-b border-app-border px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-app-subtle">
                Export location
              </p>
              <h2 className="mt-1 text-base font-semibold text-app-text">Analysis report export</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">
                Copy report and Export Markdown remain available inside Analysis so reviewers can confirm
                status, risk, and source separation before distributing the workpaper.
              </p>
            </div>
            <StatusBadge tone="accent">Analysis</StatusBadge>
          </div>
        </div>
        <div className="grid gap-0 divide-y divide-app-border md:grid-cols-3 md:divide-x md:divide-y-0">
          {[
            {
              label: "Review findings",
              body: "Confirm covered, open, high-risk, and needs reviewer confirmation counts.",
            },
            {
              label: "Check evidence",
              body: "Verify client source excerpts remain separate from the Reg S-P basis.",
            },
            {
              label: "Export workpaper",
              body: "Use Copy report or Export Markdown from the Analysis toolbar.",
            },
          ].map((item) => (
            <div key={item.label} className="px-5 py-4">
              <h3 className="text-sm font-semibold text-app-text">{item.label}</h3>
              <p className="mt-2 text-sm leading-6 text-app-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </Surface>
    </div>
  );
}
