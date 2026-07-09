import { AppearanceSettings } from "@/components/AppearanceSettings";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/Surface";

const sections = [
  {
    title: "Workspace profile",
    body: "Workspace identity and ownership are securely provisioned from your authenticated account.",
  },
  {
    title: "Users and roles",
    body: "Invitations and granular reviewer roles are not configured in this release.",
  },
  {
    title: "Security",
    body: "Documents are private and access is scoped through authenticated workspace membership.",
  },
  {
    title: "Data retention",
    body: "Define retention windows for documents, review notes, findings, and exported reports later.",
  },
  {
    title: "Data handling",
    body: "Review document handling, reference behavior, and workspace data settings before production use.",
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Workspace settings"
        description="Manage workspace-level preferences and operational notes for the review environment."
      />

      <AppearanceSettings />

      <section className="grid gap-4 md:grid-cols-2">
        {sections.map((section, index) => (
          <Card key={section.title} as="article" className="min-w-0">
            <div className="mb-4 grid size-8 place-items-center rounded-md border border-app-border bg-app-elevated font-mono text-[11px] font-semibold text-app-subtle">
              {String(index + 1).padStart(2, "0")}
            </div>
            <h3 className="text-sm font-semibold text-app-text">{section.title}</h3>
            <p className="mt-2 text-sm leading-6 text-app-muted">{section.body}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
