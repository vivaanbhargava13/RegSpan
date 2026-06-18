import Link from "next/link";

export default function DashboardPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-white p-10 text-center shadow-soft">
        <Link href="/" className="mx-auto mb-8 inline-flex items-center gap-2 text-sm font-semibold text-accent">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-white">R</span>
          RegSpan
        </Link>
        <h1 className="text-3xl font-semibold text-ink">Dashboard coming next.</h1>
        <p className="mt-4 text-muted">
          Authentication, uploads, evidence mapping, and reports will be connected in the next phase.
        </p>
      </div>
    </main>
  );
}
