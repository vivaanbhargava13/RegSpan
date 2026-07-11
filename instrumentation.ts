export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installGracefulShutdownHandlers } = await import("@/lib/serverLifecycle");
  installGracefulShutdownHandlers();
}
