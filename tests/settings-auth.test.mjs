import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("settings sidebar uses a gear icon rather than the theme sun icon", async () => {
  const sidebar = await readFile("components/Sidebar.tsx", "utf8");
  const settingsIcon = sidebar.slice(sidebar.indexOf('{icon === "settings"'), sidebar.indexOf("</svg>"));

  assert.match(settingsIcon, /l\.55 2\.35|l-2\.32\.72/);
  assert.match(settingsIcon, /circle cx="12" cy="11\.5" r="2\.55"/);
  assert.doesNotMatch(settingsIcon, /M12 3\.75v2\.1/);
  assert.doesNotMatch(settingsIcon, /M20\.25 12h-2\.1/);
});

test("settings page renders functional account workspace password security and appearance sections", async () => {
  const page = await readFile("app/(app)/settings/page.tsx", "utf8");
  const client = await readFile("components/SettingsClient.tsx", "utf8");

  assert.match(page, /SettingsClient/);
  assert.match(client, /Account profile/);
  assert.match(client, /Profile details/);
  assert.match(client, /Display name/);
  assert.match(client, /Email address/);
  assert.match(client, /Save profile/);
  assert.match(client, /Password and security/);
  assert.match(client, /Password reset/);
  assert.match(client, /Send reset link/);
  assert.match(client, /Workspace access/);
  assert.match(client, /Team invitations and role management will be added later/);
  assert.match(client, /Security and data handling/);
  assert.match(client, /AppearanceSettings/);
  assert.doesNotMatch(client, /Data retention|Define retention windows/);
});

test("settings profile update preserves auth metadata and validates display name", async () => {
  const client = await readFile("components/SettingsClient.tsx", "utf8");

  assert.match(client, /supabase\.auth\.updateUser\(\{\s*\n\s*data:/);
  assert.match(client, /\.\.\.existingMetadata/);
  assert.match(client, /first_name: profile\.firstName\.trim\(\)/);
  assert.match(client, /last_name: profile\.lastName\.trim\(\)/);
  assert.match(client, /full_name: displayName/);
  assert.match(client, /Enter a display name or first and last name/);
  assert.match(client, /Account profile updated/);
});

test("settings password actions use reset-link path instead of direct session password change", async () => {
  const client = await readFile("components/SettingsClient.tsx", "utf8");

  assert.match(client, /For account protection/);
  assert.match(client, /fetch\("\/api\/auth\/forgot-password"/);
  assert.match(client, /Send reset link/);
  assert.doesNotMatch(client, /supabase\.auth\.updateUser\(\{ password:/);
  assert.doesNotMatch(client, /resetPasswordForEmail/);
  assert.doesNotMatch(client, /window\.location\.origin/);
});

test("auth login exposes forgot password and public recovery routes", async () => {
  const authForm = await readFile("components/AuthForm.tsx", "utf8");
  const forgotPage = await readFile("app/auth/forgot-password/page.tsx", "utf8");
  const updatePage = await readFile("app/auth/update-password/page.tsx", "utf8");

  assert.match(authForm, /Forgot password\?/);
  assert.match(authForm, /href="\/auth\/forgot-password"/);
  assert.match(forgotPage, /ForgotPasswordForm/);
  assert.match(updatePage, /UpdatePasswordForm/);
});

test("forgot password form submits privacy-safe reset requests", async () => {
  const [form, route] = await Promise.all([
    readFile("components/ForgotPasswordForm.tsx", "utf8"),
    readFile("app/api/auth/forgot-password/route.ts", "utf8"),
  ]);

  assert.match(form, /fetch\("\/api\/auth\/forgot-password"/);
  assert.match(route, /resetPasswordForEmail\(email/);
  assert.match(route, /authRedirectUrl\("\/auth\/update-password"\)/);
  assert.doesNotMatch(form, /window\.location\.origin/);
  assert.doesNotMatch(route, /window\.location\.origin/);
  assert.match(form, /If an account exists for that email, we sent password reset instructions/);
  assert.doesNotMatch(form, /No account exists|email was not found/i);
});

test("signup confirmation redirect is requested from the server", async () => {
  const [authForm, redirectRoute] = await Promise.all([
    readFile("components/AuthForm.tsx", "utf8"),
    readFile("app/api/auth/redirect/route.ts", "utf8"),
  ]);

  assert.match(authForm, /loadSignupRedirectUrl/);
  assert.match(authForm, /fetch\("\/api\/auth\/redirect\?target=signup"/);
  assert.match(authForm, /emailRedirectTo/);
  assert.match(redirectRoute, /authRedirectUrl\(path\)/);
  assert.doesNotMatch(authForm, /emailRedirectTo: `\$\{window\.location\.origin\}/);
  assert.doesNotMatch(redirectRoute, /window\.location\.origin/);
});

test("update password form handles validation success and expired link states", async () => {
  const form = await readFile("components/UpdatePasswordForm.tsx", "utf8");

  assert.match(form, /PASSWORD_RECOVERY/);
  assert.match(form, /Password must be at least 8 characters/);
  assert.match(form, /Passwords do not match/);
  assert.match(form, /supabase\.auth\.updateUser\(\{ password: newPassword \}\)/);
  assert.match(form, /Password updated\. You can continue to your workspace/);
  assert.match(form, /This reset link is invalid or expired/);
  assert.match(form, /Request new link/);
});

test("Supabase email templates include RegSpan branding and action variables", async () => {
  const [readme, confirm, reset] = await Promise.all([
    readFile("docs/supabase-email-templates/README.md", "utf8"),
    readFile("docs/supabase-email-templates/confirm-signup.html", "utf8"),
    readFile("docs/supabase-email-templates/reset-password.html", "utf8"),
  ]);

  assert.match(readme, /Authentication > Email Templates/);
  assert.match(readme, /http:\/\/localhost:3000\/auth\/update-password/);
  assert.match(readme, /production-domain|YOUR-PRODUCTION-DOMAIN/i);

  for (const template of [confirm, reset]) {
    assert.match(template, /RegSpan/);
    assert.match(template, /Compliance OS/);
    assert.match(template, /\{\{ \.ConfirmationURL \}\}/);
    assert.match(template, /\{\{ \.Email \}\}/);
    assert.match(template, /Never share this link/);
    assert.match(template, /expires according to the Auth settings/);
  }

  assert.match(confirm, /Verify your RegSpan email/);
  assert.match(confirm, /Verify email/);
  assert.match(reset, /Reset your RegSpan password/);
  assert.match(reset, /Reset password/);
});
