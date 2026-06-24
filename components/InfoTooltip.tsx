"use client";

import { useEffect, useId, useRef, useState } from "react";

type TooltipPlacement = "top" | "bottom" | "left" | "right";

type InfoTooltipProps = {
  children: string;
  preferredPlacement?: TooltipPlacement;
};

const viewportMargin = 12;
const tooltipGap = 10;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function InfoTooltip({ children, preferredPlacement = "bottom" }: InfoTooltipProps) {
  const tooltipId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function updatePosition() {
      const button = buttonRef.current;
      const tooltip = tooltipRef.current;

      if (!button || !tooltip) {
        return;
      }

      const buttonRect = button.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const shouldOpenBelow = viewportWidth < 640;
      const placement = shouldOpenBelow ? "bottom" : preferredPlacement;
      let left = buttonRect.left + buttonRect.width / 2 - tooltipRect.width / 2;
      let top = buttonRect.bottom + tooltipGap;

      if (placement === "left") {
        left = buttonRect.left - tooltipRect.width - tooltipGap;
        top = buttonRect.top + buttonRect.height / 2 - tooltipRect.height / 2;
      }

      if (placement === "right") {
        left = buttonRect.right + tooltipGap;
        top = buttonRect.top + buttonRect.height / 2 - tooltipRect.height / 2;
      }

      if (placement === "top") {
        left = buttonRect.left + buttonRect.width / 2 - tooltipRect.width / 2;
        top = buttonRect.top - tooltipRect.height - tooltipGap;
      }

      if (left < viewportMargin || left + tooltipRect.width > viewportWidth - viewportMargin) {
        left = buttonRect.left + buttonRect.width / 2 - tooltipRect.width / 2;
        top = buttonRect.bottom + tooltipGap;
      }

      setPosition({
        left: clamp(left, viewportMargin, viewportWidth - tooltipRect.width - viewportMargin),
        top: clamp(top, viewportMargin, viewportHeight - tooltipRect.height - viewportMargin),
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, preferredPlacement]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="What does this metric mean?"
        aria-describedby={isOpen ? tooltipId : undefined}
        onBlur={() => setIsOpen(false)}
        onClick={() => setIsOpen(true)}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setIsOpen(false);
            event.currentTarget.blur();
          }
        }}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={(event) => {
          if (document.activeElement !== event.currentTarget) {
            setIsOpen(false);
          }
        }}
        className="inline-grid size-6 place-items-center rounded-full border border-app-border-strong bg-app-surface text-[11px] font-semibold text-app-muted shadow-sm transition-colors hover:border-app-accent hover:bg-app-accent-soft hover:text-app-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
      >
        ?
      </button>

      {isOpen ? (
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          style={{ left: position.left, top: position.top }}
          className="fixed z-50 w-[min(280px,calc(100vw-24px))] rounded-xl border border-app-border bg-app-shell px-4 py-3 text-sm leading-5 text-app-text shadow-app-float"
        >
          {children}
        </div>
      ) : null}
    </>
  );
}
