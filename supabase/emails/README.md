# Auth email templates

Six HTML templates for **Authentication → Emails** in the Supabase
dashboard. Open a template, paste the file's contents into the body
field, set the subject, save. There is no deploy step and nothing in the
app reads these files — the dashboard is the source of truth once
they are pasted, and these are the copy of record.

| File | Dashboard template | Subject |
| --- | --- | --- |
| `confirm-signup.html` | Confirm signup | Confirm your email |
| `reset-password.html` | Reset password | Reset your password |
| `magic-link.html` | Magic Link | Your sign-in link |
| `change-email.html` | Change Email Address | Confirm your new email |
| `invite-user.html` | Invite user | You're invited to Someday We'll Die |
| `reauthentication.html` | Reauthentication | Your confirmation code |

`_preview.html` renders all six with the variables filled in. **It has to
be served** — it reads the templates with `fetch()` — so from the repo
root: `python3 -m http.server 8000`, then
`http://localhost:8000/supabase/emails/_preview.html`.

## ⚠️ The link is the whole point of these files

Every one of them addresses the link as:

```
{{ .SiteURL }}/index.html?token_hash={{ .TokenHash }}&type=<type>
```

**Not `{{ .ConfirmationURL }}`, which is what the stock templates use.**
`js/config.js` sets `flowType:'pkce'`, so `ConfirmationURL` comes back as
`?code=…`, and redeeming that code needs the verifier the app wrote to
**localStorage in the browser that made the request**. People sign up on a
laptop and read their mail on a phone; people who cannot get into their
phone ask for a reset from a laptop. Anywhere but the original browser
the exchange fails with *"both auth code and code verifier should be
non-empty"* and the recipient lands on the sign-in screen having
apparently done nothing. `verifyOtp()` — which is what `token_hash`
drives — carries no such requirement.

The `type` is not decoration either. `readEmailConfirmation()` in
`js/auth.js` reads it, defaults it to `email`, and passes it to
`verifyOtp`; `type=recovery` is the **only** thing that tells the client
a landing is a password reset rather than a sign-in. Get it wrong and a
reset link signs the person in with their old password unchanged.

| Template | `type` |
| --- | --- |
| Confirm signup | `email` |
| Reset password | `recovery` |
| Magic Link | `magiclink` |
| Change Email Address | `email_change` |
| Invite user | `invite` |

`reauthentication.html` has no link at all — it carries a six-digit
`{{ .Token }}` that gets typed back into the app.

## Two dashboard settings decide whether any of this works

Both live under **Authentication → URL Configuration**, and both fail
identically from the outside — *"I clicked the link and got a broken
page"*:

- **Site URL** is what `{{ .SiteURL }}` resolves to. Left at the
  Supabase default it is `http://localhost:3000` and every recipient
  lands on a dead page.
- **Redirect URLs** has to list the app's real origin, or
  `emailRedirectTo` is silently ignored and falls back to Site URL.

See CLAUDE.md, **Coming back through the confirmation email**.

## Design notes

They are the app's palette and type, as far as email allows:

- **Tables and inline styles.** Every colour is written inline as the
  light value; the `<style>` block only carries the dark-mode overrides
  and the phone breakpoint. Gmail strips `<style>` in some contexts, so
  anything that only existed there would be lost.
- **No web fonts.** Gmail strips `@font-face`, so Newsreader and IBM
  Plex Mono cannot be relied on. Georgia stands in for the serif and a
  system mono stack for the eyebrow — the *shape* of the type system
  survives, the exact faces do not.
- **Dark mode** via `prefers-color-scheme`, honoured by Apple Mail, iOS
  Mail and Outlook for macOS. Gmail ignores it and gets the light
  values, which is why they are all inline.
- **No images.** A blocked image at the top of an email reads as a
  broken email, and there is nothing here worth that risk — the
  wordmark is text. If you want the app icon,
  `{{ .SiteURL }}/icons/icon-192.png` is served by the web host and
  would work; give it `alt` text and expect it to be blocked often.
- **The button is a `<td background>` with a padded `<a>` inside.**
  Outlook for Windows ignores `border-radius`, so it renders square
  there and correct everywhere else. The pasteable URL underneath is
  the floor: some clients and some corporate filters mangle the button.
- **The stated expiry is 24 hours**, matching `confirmFailureHTML()` in
  `js/auth.js` and Supabase's default `MAILER_OTP_EXP` (86400). If you
  change that setting, change both.

**The "no help text" rule in CLAUDE.md does not apply here.** That rule
is about the app's own surfaces, where a control should be legible from
itself. An email arriving in somebody's inbox has to say what it is, who
it is for and what happens if they ignore it — a bare button with no
sentence around it is what a phishing email looks like. The copy is
still kept to one line per idea.

## Personalising by name

`{{ .Data.display_name }}` reaches the metadata `signUp()` passes, so a
greeting is possible. It is deliberately not used: Go renders a missing
key as `<no value>`, and the accounts most likely to lack one are the
oldest. If you add it, add a fallback path rather than interpolating it
bare.

## Changing one

They share one skeleton — wordmark, card, title, a paragraph, the
button, a rule, a footnote — so **a change to the frame belongs in all
six**. `_preview.html` puts them side by side, which is the cheapest way
to see when one has drifted. What it cannot tell you is whether a real
client strips something; for that, send yourself one from the dashboard's
own preview.
