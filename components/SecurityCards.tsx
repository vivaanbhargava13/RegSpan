const cards = [
  {
    title: "Evidence-first outputs",
    body: "Findings are oriented around cited source material so reviewers can trace each suggested control mapping.",
  },
  {
    title: "Human review before final reports",
    body: "AI suggestions are treated as draft analysis for legal, compliance, and security stakeholders to approve.",
  },
  {
    title: "Designed for secure document workflows",
    body: "The product foundation is shaped for sensitive policy review, access controls, and controlled exports.",
  },
];

export function SecurityCards() {
  return (
    <section id="security" className="px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-normal text-accent">Security</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-normal text-ink sm:text-4xl">
            Built around careful evidence handling.
          </h2>
        </div>
        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {cards.map((card) => (
            <article key={card.title} className="rounded-2xl border border-line bg-white p-6 shadow-sm">
              <div className="mb-6 h-1.5 w-12 rounded-full bg-accent" />
              <h3 className="text-xl font-semibold text-ink">{card.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted">{card.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
