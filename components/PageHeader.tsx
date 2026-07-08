import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow: string;
  title: ReactNode;
  description: string;
  actions?: ReactNode;
};

type PageToolbarProps = {
  children: ReactNode;
  className?: string;
};

export function PageToolbar({ children, className = "" }: PageToolbarProps) {
  return (
    <div
      className={[
        "flex shrink-0 flex-wrap items-center gap-2 sm:ml-auto sm:justify-end",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex w-full flex-col gap-5 sm:flex-row sm:items-start">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-app-subtle">
          <span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-app-accent" />
          {eyebrow}
        </p>
        <h1 className="mt-2 max-w-4xl break-words text-2xl font-semibold tracking-[-0.015em] text-app-text lg:text-[32px] lg:leading-[1.18]">
          {title}
        </h1>
        <p className="mt-2.5 max-w-2xl text-sm leading-6 text-app-muted">{description}</p>
      </div>
      {actions ? <PageToolbar className="sm:pt-0.5">{actions}</PageToolbar> : null}
    </header>
  );
}
