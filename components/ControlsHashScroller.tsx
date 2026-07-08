"use client";

import { useEffect } from "react";

const MAX_SCROLL_ATTEMPTS = 12;

function currentHashId() {
  if (!window.location.hash) return "";
  return decodeURIComponent(window.location.hash.slice(1));
}

export function ControlsHashScroller() {
  useEffect(() => {
    let retryTimer: number | undefined;
    let animationFrame: number | undefined;

    const scrollToHash = (attempt = 0) => {
      const targetId = currentHashId();
      if (!targetId) return;

      const target = document.getElementById(targetId);
      if (target) {
        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({
          behavior: prefersReducedMotion ? "auto" : "smooth",
          block: "start",
        });
        return;
      }

      if (attempt < MAX_SCROLL_ATTEMPTS) {
        retryTimer = window.setTimeout(() => scrollToHash(attempt + 1), 50);
      }
    };

    const scheduleScroll = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(() => scrollToHash());
    };

    scheduleScroll();
    window.addEventListener("hashchange", scheduleScroll);

    return () => {
      window.removeEventListener("hashchange", scheduleScroll);
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  return null;
}
