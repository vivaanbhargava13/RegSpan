"use client";

import type { Session } from "@supabase/supabase-js";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/Alert";
import { AppearanceSettings } from "@/components/AppearanceSettings";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { Surface } from "@/components/Surface";
import { getBrowserSupabaseClient } from "@/components/supabaseClient";
import { getCurrentWorkspace, type CurrentWorkspace } from "@/lib/workspaces";

type ProfileForm = {
  firstName: string;
  lastName: string;
  displayName: string;
};

const initialProfileForm: ProfileForm = {
  firstName: "",
  lastName: "",
  displayName: "",
};

function profileFromSession(session: Session | null): ProfileForm {
  const metadata = session?.user.user_metadata ?? {};
  const firstName = typeof metadata.first_name === "string" ? metadata.first_name : "";
  const lastName = typeof metadata.last_name === "string" ? metadata.last_name : "";
  const fullName = typeof metadata.full_name === "string" ? metadata.full_name : "";

  return {
    firstName,
    lastName,
    displayName: fullName || [firstName, lastName].filter(Boolean).join(" "),
  };
}

function fullNameFromProfile(profile: ProfileForm) {
  return profile.displayName.trim() || [profile.firstName, profile.lastName].map((value) => value.trim()).filter(Boolean).join(" ");
}

export function SettingsClient() {
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<CurrentWorkspace | null>(null);
  const [profile, setProfile] = useState<ProfileForm>(initialProfileForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [securityMessage, setSecurityMessage] = useState("");
  const [securityError, setSecurityError] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [isSavingExternalAiProcessing, setIsSavingExternalAiProcessing] = useState(false);
  const [externalAiProcessingMessage, setExternalAiProcessingMessage] = useState("");
  const [externalAiProcessingError, setExternalAiProcessingError] = useState("");

  const email = session?.user.email ?? "";
  const hasProfileChanges = useMemo(() => {
    const original = profileFromSession(session);
    return profile.firstName !== original.firstName
      || profile.lastName !== original.lastName
      || profile.displayName !== original.displayName;
  }, [profile, session]);
  const canManageExternalAiProcessing = Boolean(
    session?.user.id && workspace?.ownerUserId === session.user.id,
  );

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      setProfileError("Supabase Auth is not configured for this environment.");
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return;
      setSession(nextSession);
      setProfile(profileFromSession(nextSession));
    });

    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (!isMounted) return;
      if (error || !data.session) {
        setProfileError(error?.message || "Your session could not be loaded.");
        setIsLoading(false);
        return;
      }

      setSession(data.session);
      setProfile(profileFromSession(data.session));

      try {
        const currentWorkspace = await getCurrentWorkspace(supabase, data.session.user.id);
        if (isMounted) setWorkspace(currentWorkspace);
      } catch (workspaceLoadError) {
        if (isMounted) {
          setWorkspaceError(
            workspaceLoadError instanceof Error
              ? workspaceLoadError.message
              : "Workspace details could not be loaded.",
          );
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  function updateProfileField(field: keyof ProfileForm, value: string) {
    setProfile((current) => ({ ...current, [field]: value }));
    setProfileError("");
    setProfileMessage("");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = fullNameFromProfile(profile);
    if (!displayName) {
      setProfileError("Enter a display name or first and last name.");
      setProfileMessage("");
      return;
    }

    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      setProfileError("Supabase Auth is not configured for this environment.");
      return;
    }

    setIsSavingProfile(true);
    setProfileError("");
    setProfileMessage("");

    try {
      const existingMetadata = session?.user.user_metadata ?? {};
      const { data, error } = await supabase.auth.updateUser({
        data: {
          ...existingMetadata,
          first_name: profile.firstName.trim(),
          last_name: profile.lastName.trim(),
          full_name: displayName,
        },
      });

      if (error) throw error;
      const nextSession = data.user ? (await supabase.auth.getSession()).data.session : null;
      setSession(nextSession);
      setProfile(profileFromSession(nextSession));
      setProfileMessage("Account profile updated.");
    } catch (profileUpdateError) {
      setProfileError(profileUpdateError instanceof Error ? profileUpdateError.message : "Unable to update account profile.");
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function sendResetLink() {
    if (!email) {
      setSecurityError("Your account email could not be loaded.");
      return;
    }

    setIsSendingReset(true);
    setSecurityError("");
    setSecurityMessage("");

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (response.status === 429) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || "Too many password reset requests. Please wait before trying again.");
      }
      setSecurityMessage("If an account exists for that email, we sent password reset instructions.");
    } catch (resetError) {
      if (resetError instanceof Error && /too many password reset/i.test(resetError.message)) {
        setSecurityError(resetError.message);
      } else {
        setSecurityMessage("If an account exists for that email, we sent password reset instructions.");
      }
    } finally {
      setIsSendingReset(false);
    }
  }

  async function updateExternalAiProcessing(enabled: boolean) {
    if (!workspace || !canManageExternalAiProcessing || isSavingExternalAiProcessing) return;
    if (enabled && !window.confirm(
      "Enable external AI processing for this workspace? Selected client document text and excerpts may be sent to configured AI providers for future processing and Analysis.",
    )) {
      return;
    }

    setIsSavingExternalAiProcessing(true);
    setExternalAiProcessingError("");
    setExternalAiProcessingMessage("");

    try {
      const response = await fetch("/api/workspace/external-ai-processing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const body = (await response.json()) as {
        error?: string;
        externalAiProcessingEnabled?: boolean;
      };
      if (!response.ok || typeof body.externalAiProcessingEnabled !== "boolean") {
        throw new Error(body.error || "Unable to update external AI processing.");
      }

      const externalAiProcessingEnabled = body.externalAiProcessingEnabled;

      setWorkspace((current) => current
        ? { ...current, externalAiProcessingEnabled }
        : current);
      setExternalAiProcessingMessage(
        externalAiProcessingEnabled
          ? "External AI processing is enabled for future processing and Analysis."
          : "External AI processing is disabled for future processing and Analysis.",
      );
    } catch (updateError) {
      setExternalAiProcessingError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update external AI processing.",
      );
    } finally {
      setIsSavingExternalAiProcessing(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Workspace settings"
        description="Manage account basics, password recovery, appearance, and workspace context."
      />

      {isLoading ? (
        <Surface className="flex items-center gap-3 text-sm font-semibold text-app-muted">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-app-accent" />
          Loading settings…
        </Surface>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
        <Surface as="section" padding="lg">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-app-subtle">Account profile</p>
          <h2 className="mt-1 app-section-title">Profile details</h2>
          <p className="mt-2 text-sm leading-6 text-app-muted">
            This name is used in the RegSpan workspace header and audit review context.
          </p>

          <form className="mt-5 space-y-4" onSubmit={saveProfile} noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold text-app-text">First name</span>
                <input
                  value={profile.firstName}
                  onChange={(event) => updateProfileField("firstName", event.target.value)}
                  type="text"
                  autoComplete="given-name"
                  className="mt-2 h-10 w-full rounded-lg border border-app-border bg-app-surface px-3 text-sm text-app-text outline-none transition focus:border-app-accent focus:ring-4 focus:ring-app-accent-soft"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-app-text">Last name</span>
                <input
                  value={profile.lastName}
                  onChange={(event) => updateProfileField("lastName", event.target.value)}
                  type="text"
                  autoComplete="family-name"
                  className="mt-2 h-10 w-full rounded-lg border border-app-border bg-app-surface px-3 text-sm text-app-text outline-none transition focus:border-app-accent focus:ring-4 focus:ring-app-accent-soft"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-sm font-semibold text-app-text">Display name</span>
              <input
                value={profile.displayName}
                onChange={(event) => updateProfileField("displayName", event.target.value)}
                type="text"
                autoComplete="name"
                className="mt-2 h-10 w-full rounded-lg border border-app-border bg-app-surface px-3 text-sm text-app-text outline-none transition focus:border-app-accent focus:ring-4 focus:ring-app-accent-soft"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-app-text">Email address</span>
              <input
                value={email}
                readOnly
                type="email"
                className="mt-2 h-10 w-full rounded-lg border border-app-border bg-app-elevated px-3 text-sm text-app-muted outline-none"
              />
            </label>

            {profileError ? <Alert tone="danger">{profileError}</Alert> : null}
            {profileMessage ? <Alert tone="success">{profileMessage}</Alert> : null}

            <Button type="submit" variant="appPrimary" disabled={isSavingProfile || !hasProfileChanges}>
              {isSavingProfile ? "Saving…" : "Save profile"}
            </Button>
          </form>
        </Surface>

        <Surface as="section" padding="lg">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-app-subtle">Workspace</p>
          <h2 className="mt-1 app-section-title">Workspace access</h2>
          <dl className="mt-5 divide-y divide-app-border text-sm">
            <div className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[0.45fr_1fr]">
              <dt className="font-medium text-app-muted">Workspace</dt>
              <dd className="break-words font-semibold text-app-text [overflow-wrap:anywhere]">{workspace?.name ?? "Not loaded"}</dd>
            </div>
            <div className="grid gap-1 py-3 sm:grid-cols-[0.45fr_1fr]">
              <dt className="font-medium text-app-muted">Role</dt>
              <dd className="font-semibold capitalize text-app-text">{workspace?.role ?? "Member"}</dd>
            </div>
            <div className="grid gap-1 py-3 sm:grid-cols-[0.45fr_1fr]">
              <dt className="font-medium text-app-muted">Status</dt>
              <dd className="font-semibold text-app-success">Active workspace member</dd>
            </div>
          </dl>
          {workspaceError ? <Alert className="mt-4" tone="warning">{workspaceError}</Alert> : null}
          <div className="mt-4 rounded-lg border border-dashed border-app-border-strong bg-app-elevated/55 p-4 text-sm leading-6 text-app-muted">
            Team invitations and role management will be added later. Current access remains scoped to authenticated workspace membership.
          </div>
        </Surface>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Surface as="section" padding="lg">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-app-subtle">Password and security</p>
          <h2 className="mt-1 app-section-title">Password reset</h2>
          <p className="mt-2 text-sm leading-6 text-app-muted">
            For account protection, RegSpan sends a password reset link to your verified account email instead of changing passwords from an active session.
          </p>

          <div className="mt-5 space-y-4">
            {securityError ? <Alert tone="danger">{securityError}</Alert> : null}
            {securityMessage ? <Alert tone="success">{securityMessage}</Alert> : null}

            <Button type="button" variant="appPrimary" onClick={sendResetLink} disabled={isSendingReset || !email}>
              {isSendingReset ? "Sending…" : "Send reset link"}
            </Button>
          </div>
        </Surface>

        <Surface as="section" padding="lg">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-app-subtle">Security and data handling</p>
          <h2 className="mt-1 app-section-title">Review environment</h2>
          <ul className="mt-5 space-y-3 text-sm leading-6 text-app-muted">
            <li className="rounded-lg border border-app-border bg-app-elevated/60 p-3">
              Uploaded documents are stored in private workspace-scoped storage.
            </li>
            <li className="rounded-lg border border-app-border bg-app-elevated/60 p-3">
              Source preparation and Analysis stay tied to the current workspace.
            </li>
            <li className="rounded-lg border border-app-border bg-app-elevated/60 p-3">
              Findings display client source excerpts separately from Reg S-P reference material.
            </li>
          </ul>
        </Surface>
      </section>

      <Surface as="section" padding="lg">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-app-subtle">External AI processing</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h2 className="app-section-title">Client document processing consent</h2>
            <p id="external-ai-processing-description" className="mt-2 text-sm leading-6 text-app-muted">
              When disabled, RegSpan does not send client document text to external AI providers. When enabled, selected document text or excerpts may be sent to configured AI providers for embeddings, classification, and summaries. Regulatory reference content may be handled separately. This setting affects future processing and Analysis.
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-app-text">
            <span>{workspace?.externalAiProcessingEnabled ? "Enabled" : "Disabled"}</span>
            <input
              aria-describedby="external-ai-processing-description"
              checked={workspace?.externalAiProcessingEnabled === true}
              className="peer sr-only"
              disabled={!canManageExternalAiProcessing || isSavingExternalAiProcessing}
              onChange={(event) => void updateExternalAiProcessing(event.target.checked)}
              role="switch"
              type="checkbox"
            />
            <span
              aria-hidden="true"
              className="relative h-6 w-11 rounded-full bg-app-border-strong transition-colors peer-checked:bg-app-accent peer-disabled:cursor-not-allowed peer-disabled:opacity-60 after:absolute after:left-1 after:top-1 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5"
            />
          </label>
        </div>

        {!canManageExternalAiProcessing && workspace ? (
          <p className="mt-4 text-sm text-app-muted">
            Only the workspace owner can change this setting.
          </p>
        ) : null}
        {externalAiProcessingError ? <Alert className="mt-4" tone="danger">{externalAiProcessingError}</Alert> : null}
        {externalAiProcessingMessage ? <Alert className="mt-4" tone="success">{externalAiProcessingMessage}</Alert> : null}
      </Surface>

      <AppearanceSettings />
    </div>
  );
}
