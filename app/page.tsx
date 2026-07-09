import { Button } from "@/components/Button";
import { Footer } from "@/components/Footer";
import { HowItWorks } from "@/components/HowItWorks";
import { Navbar } from "@/components/Navbar";
import { ProductPreview } from "@/components/ProductPreview";
import { SecurityCards } from "@/components/SecurityCards";

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden">
      <Navbar />

      <section className="mx-auto grid w-full max-w-7xl items-center gap-14 px-6 pb-20 pt-16 sm:pt-20 lg:grid-cols-[1fr_0.94fr] lg:px-8 lg:pb-28">
        <div className="max-w-3xl">
          <div className="mb-7 inline-flex items-center rounded-full border border-line bg-white px-3 py-1 text-sm font-medium text-muted shadow-sm">
            Reg S-P readiness workflow foundation
          </div>
          <h1 className="max-w-4xl text-5xl font-semibold leading-[1.03] tracking-normal text-ink sm:text-6xl lg:text-7xl">
            AI-assisted <span className="whitespace-nowrap">Reg S-P</span> evidence mapping for financial firms.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-muted sm:text-xl">
            Upload cybersecurity, privacy, vendor, and incident response
            policies. Map evidence to Reg S-P requirements, identify findings, and
            export reviewer-ready reports with citations.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Button href="/auth" size="lg">
              Start assessment
            </Button>
            <Button href="#workflow" variant="secondary" size="lg">
              See workflow
            </Button>
          </div>
          <p className="mt-5 text-sm font-medium text-muted">
            Built for evidence review, human approval, and audit-ready reporting.
          </p>
        </div>

        <ProductPreview />
      </section>

      <HowItWorks />
      <SecurityCards />

      <section className="px-6 py-20 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-8 rounded-2xl border border-line bg-ink px-6 py-10 text-white shadow-soft sm:px-10 lg:flex-row lg:items-center">
          <div>
            <p className="text-sm font-medium text-white/65">Ready when your evidence is.</p>
            <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl">
              Start with a clearer view of your Reg S-P evidence.
            </h2>
          </div>
          <Button href="/auth" variant="light" size="lg">
            Create account
          </Button>
        </div>
      </section>

      <Footer />
    </main>
  );
}
