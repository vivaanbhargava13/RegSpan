import "server-only";

type LifecycleState = {
  activeIngestionRequests: number;
  draining: boolean;
  handlersInstalled: boolean;
};

const globalLifecycle = globalThis as typeof globalThis & {
  __regspanServerLifecycle?: LifecycleState;
};

const state = globalLifecycle.__regspanServerLifecycle ?? {
  activeIngestionRequests: 0,
  draining: false,
  handlersInstalled: false,
};
globalLifecycle.__regspanServerLifecycle = state;

export function beginIngestionRequest() {
  if (state.draining) return null;
  state.activeIngestionRequests += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.activeIngestionRequests = Math.max(0, state.activeIngestionRequests - 1);
  };
}

function shutdownGraceMs(environment: NodeJS.ProcessEnv) {
  const configured = Number(environment.REGSPAN_SHUTDOWN_GRACE_MS);
  return Number.isSafeInteger(configured) && configured >= 1_000 && configured <= 350_000
    ? configured
    : 330_000;
}

export function installGracefulShutdownHandlers(environment = process.env) {
  if (state.handlersInstalled || environment.NEXT_MANUAL_SIG_HANDLE !== "true") return;
  state.handlersInstalled = true;

  const beginShutdown = (signal: "SIGTERM" | "SIGINT") => {
    if (state.draining) return;
    state.draining = true;
    const startedAt = Date.now();
    const graceMs = shutdownGraceMs(environment);
    console.info("[RegSpan shutdown] Draining active ingestion requests", {
      signal,
      activeIngestionRequests: state.activeIngestionRequests,
      graceMs,
    });

    const timer = setInterval(() => {
      if (state.activeIngestionRequests === 0) {
        clearInterval(timer);
        process.exit(0);
      }
      if (Date.now() - startedAt >= graceMs) {
        clearInterval(timer);
        console.error("[RegSpan shutdown] Ingestion drain deadline exceeded", {
          activeIngestionRequests: state.activeIngestionRequests,
          graceMs,
        });
        process.exit(1);
      }
    }, 100);
  };

  process.once("SIGTERM", () => beginShutdown("SIGTERM"));
  process.once("SIGINT", () => beginShutdown("SIGINT"));
}
