# RegSpan Supabase Auth Email Templates

Use these templates in the Supabase dashboard under **Authentication > Email Templates**.

## Templates

- `confirm-signup.html`: paste into the **Confirm signup** template.
- `reset-password.html`: paste into the **Reset password** template.

## Redirect URLs

Supabase Auth URL configuration must allow the password update route:

- Local development: `http://localhost:3000/auth/update-password`
- Production: `https://YOUR-PRODUCTION-DOMAIN/auth/update-password`

The app sends password recovery links with `redirectTo` set from the current browser origin, so local and production hosts both need to be registered in Supabase Auth settings.

## Variables

These templates use Supabase Auth template variables:

- `{{ .ConfirmationURL }}` for the action link.
- `{{ .Email }}` for the recipient email address.

Do not replace these variables with app-only values. Supabase renders them when it sends the email.
