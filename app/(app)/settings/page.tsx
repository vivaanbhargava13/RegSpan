import { AppearanceSettings } from "@/components/AppearanceSettings";
import { PageHeader } from "@/components/PageHeader";

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
    body: "Define retention windows for documents, review notes, gaps, and exported reports later.",
  },
  {
    title: "Data handling",
    body: "Review document handling, reference behavior, and workspace data settings before production use.",
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Settings"
        title="Workspace settings"
        description="Manage appearance, workspace details, and data handling notes."
      />

      <AppearanceSettings />

      <section className="grid gap-4 md:grid-cols-2">
        {sections.map((section, index) => (
          <article key={section.title} className="app-card p-5 lg:p-6">
            <div className="mb-4 grid size-9 place-items-center rounded-xl bg-app-accent-soft font-mono text-[11px] font-semibold text-app-accent">
              {String(index + 1).padStart(2, "0")}
            </div>
            <h2 className="app-section-title">{section.title}</h2>
            <p className="mt-3 text-sm leading-6 text-app-muted">{section.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
