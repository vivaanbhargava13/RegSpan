import "server-only";

function isEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function isMockProcessingRouteEnabled(environment = process.env) {
  return environment.NODE_ENV !== "production"
    && isEnabled(environment.ENABLE_MOCK_PROCESSING_ROUTE);
}

export function areInternalDebugRoutesEnabled(environment = process.env) {
  return environment.NODE_ENV !== "production"
    && isEnabled(environment.ENABLE_INTERNAL_DEBUG_ROUTES);
}
