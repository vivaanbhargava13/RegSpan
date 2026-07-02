"use client";

import { useId, useState } from "react";

type TooltipPlacement = "top" | "bottom" | "left" | "right";

type InfoTooltipProps = {
  children: string;
  preferredPlacement?: TooltipPlacement;
};

const placementClasses: Record<TooltipPlacement, string> = {
  bottom: "right-0 top-full mt-2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
  top: "bottom-full right-0 mb-2",
};

export function InfoTooltip({ children, preferredPlacement = "bottom" }: InfoTooltipProps) {
  const tooltipId = useId();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <span
      className="group/tooltip relative z-30 inline-flex"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) {
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label="What does this metric mean?"
        aria-describedby={isOpen ? tooltipId : undefined}
        onBlur={() => setIsOpen(false)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen((current) => !current);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsOpen(false);
            event.currentTarget.blur();
          }
        }}
        className="relative z-20 inline-grid size-6 place-items-center rounded-full border border-app-border-strong bg-app-surface text-[11px] font-semibold text-app-muted shadow-sm transition-colors hover:border-app-accent hover:bg-app-accent-soft hover:text-app-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
      >
        ?
      </button>

      {isOpen ? (
        <div
          id={tooltipId}
          role="tooltip"
          className={`pointer-events-none absolute z-[9999] w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-app-border bg-app-shell px-4 py-3 text-left text-sm leading-5 text-app-text shadow-app-float ${placementClasses[preferredPlacement]}`}
        >
          {children}
        </div>
      ) : null}
    </span>
  );
}
