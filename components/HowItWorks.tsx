const steps = [
  {
    title: "Upload policies",
    body: "Collect cybersecurity, privacy, vendor, and incident response documents in one review flow.",
  },
  {
    title: "Map evidence to Reg S-P requirements",
    body: "Associate cited policy language with requirement areas for structured reviewer analysis.",
  },
  {
    title: "Review AI-suggested findings",
    body: "Surface missing, partial, and conflicting evidence for human review before reporting.",
  },
  {
    title: "Export reviewer-ready reports",
    body: "Prepare cited summaries and remediation notes for internal stakeholders and reviewers.",
  },
];

export function HowItWorks() {
  return (
    <section id="workflow" className="scroll-mt-24 border-y border-line bg-white px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-normal text-accent">Workflow</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-normal text-ink sm:text-4xl">
            A review path from document evidence to cited findings.
          </h2>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <article key={step.title} className="rounded-2xl border border-line bg-canvas p-6">
              <div className="grid size-10 place-items-center rounded-xl bg-accent text-sm font-bold text-white">
                {index + 1}
              </div>
              <h3 className="mt-6 text-lg font-semibold text-ink">{step.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted">{step.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
