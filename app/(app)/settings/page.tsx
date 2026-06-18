import { AppearanceSettings } from "@/components/AppearanceSettings";
import { PageHeader } from "@/components/PageHeader";

const sections = [
  {
    title: "Workspace profile",
    body: "Manage workspace identity, reviewer contacts, and default report naming later.",
  },
  {
    title: "Users and roles",
    body: "Invite reviewers and assign access levels when real authentication is connected.",
  },
  {
    title: "Security",
    body: "Configure access settings and document handling policies in a future backend phase.",
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Workspace settings"
        description="Manage appearance, demo workspace details, and data handling notes."
      />

      <AppearanceSettings />

      <section className="grid gap-4 md:grid-cols-2">
        {sections.map((section) => (
          <article key={section.title} className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-app-soft">
            <h2 className="text-lg font-semibold text-app-text">{section.title}</h2>
            <p className="mt-3 text-sm leading-6 text-app-muted">{section.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
