import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

type PageHeaderProps = {
  eyebrow: string;
  title: ReactNode;
  description: string;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex w-full flex-col gap-5 sm:flex-row sm:items-start">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-app-accent">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-app-accent" />
          {eyebrow}
        </p>
        <h1 className="mt-2.5 max-w-4xl break-words text-3xl font-semibold tracking-[-0.035em] text-app-text lg:text-[36px] lg:leading-[1.15]">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-6 text-app-muted">{description}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3 sm:ml-auto sm:justify-end sm:pt-0.5">
        {actions}
        <ThemeToggle />
      </div>
    </header>
  );
}
