# `.well-known/apple-app-site-association`

The file iOS fetches to decide whether a link to this site should open
the app instead of Safari. Without it, Universal Links do not work and
nothing anywhere reports why — invite links simply keep opening in a
browser tab, exactly as they did before the native app existed.

## Four things it needs from the host

1. **Served at `https://<domain>/.well-known/apple-app-site-association`.**
2. **Over HTTPS, with no redirect.** iOS follows none — a 301 from
   `example.com` to `www.example.com` fails the fetch outright.
3. **`Content-Type: application/json`.** The file deliberately has no
   `.json` extension, so a host that guesses the type from the
   extension will serve `application/octet-stream` and iOS will reject
   it. Most static hosts special-case `.well-known`; check yours.
4. **No authentication.** It is fetched by Apple's CDN, not the device.

## Two placeholders to fill in

- `REPLACE-WITH-TEAM-ID` — your 10-character Apple Developer Team ID,
  from developer.apple.com → Membership. The value becomes
  `TEAMID.com.landonjames.somedaywelldie`.
- The matching host in `ios/App/App/App.entitlements`
  (`applinks:<domain>`) and in `APP_WEB_ORIGIN` in `js/config.js`.
  **All three must name the same domain.**

## Checking it

    curl -sSI https://<domain>/.well-known/apple-app-site-association

Look for `200` and `content-type: application/json`. Apple also caches
it: a device picks the file up at install time, so after changing it,
delete the app and reinstall rather than assuming the change is live.

## Why this is not in `www/`

`scripts/build-www.js` assembles what goes *inside the app binary*.
This file is the opposite — it is served by the website, to a device
that has not opened the app yet. It ships with the web deploy.
