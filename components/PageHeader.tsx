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
    <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-start">
      <div className="min-w-0">
        <p className="text-sm font-semibold uppercase tracking-normal text-app-accent">{eyebrow}</p>
        <h1 className="mt-2 max-w-4xl break-words text-3xl font-semibold text-app-text">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-app-muted">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3 sm:ml-auto sm:pt-1">
        {actions}
        <ThemeToggle />
      </div>
    </div>
  );
}
