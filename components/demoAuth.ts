export type DemoSession = {
  email: string;
  displayName: string;
  workspaceName: "RegSpan Demo Workspace";
  createdAt: string;
};

export const DEMO_SESSION_KEY = "regspan.demoSession";

function getDisplayName(email: string) {
  return email.split("@")[0]?.replace(/[._-]+/g, " ") || "Reviewer";
}

// Temporary demo auth only. Replace this localStorage session with real auth later.
export function createDemoSession(email: string): DemoSession {
  const session: DemoSession = {
    email,
    displayName: getDisplayName(email),
    workspaceName: "RegSpan Demo Workspace",
    createdAt: new Date().toISOString(),
  };

  localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(session));
  return session;
}

// Temporary demo auth only. Replace this localStorage session lookup with real auth later.
export function readDemoSession(): DemoSession | null {
  const rawSession = localStorage.getItem(DEMO_SESSION_KEY);

  if (!rawSession) {
    return null;
  }

  try {
    return JSON.parse(rawSession) as DemoSession;
  } catch {
    localStorage.removeItem(DEMO_SESSION_KEY);
    return null;
  }
}

// Temporary demo auth only. Replace this localStorage cleanup with real logout later.
export function clearDemoSession() {
  localStorage.removeItem(DEMO_SESSION_KEY);
}
