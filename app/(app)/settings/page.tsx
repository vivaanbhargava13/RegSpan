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
    body: "Configure access controls and document handling policies in a future backend phase.",
  },
  {
    title: "Data retention",
    body: "Define retention windows for documents, chunks, findings, and exported reports later.",
  },
  {
    title: "Model/data handling",
    body: "Review model usage, citation behavior, and data handling settings before production use.",
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-normal text-accent">Settings</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Workspace settings</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          Nonfunctional placeholders for the settings areas needed in the product shell.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        {sections.map((section) => (
          <article key={section.title} className="rounded-2xl border border-line bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-ink">{section.title}</h2>
            <p className="mt-3 text-sm leading-6 text-muted">{section.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
