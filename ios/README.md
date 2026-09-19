# ROI-NADOS Companion iPhone

The native companion exists for capabilities that a Home Screen web app cannot provide reliably: custom background notification sounds and WidgetKit widgets.

## Build

1. Install XcodeGen.
2. From this folder, run: xcodegen generate
3. Open ROINADOSCompanion.xcodeproj in Xcode.
4. Select your Apple Developer team for both targets.
5. Confirm these capabilities:
   - Push Notifications
   - App Groups: group.com.roinados.companion
   - Keychain Sharing: com.roinados.shared
6. Debug uses the APNs development environment; Release uses production automatically through APS_ENVIRONMENT.

The project starts with bundle identifiers:
- com.roinados.companion
- com.roinados.companion.widget

If you change them, keep APNS_BUNDLE_ID on the server in sync.

## Pairing

In ROI-NADOS, open Conta -> Alertas -> Companion iPhone and generate the dedicated pairing token.

In the iPhone app, configure:
- the public ROI-NADOS server base URL;
- the Companion token.

The token is stored in shared Keychain, while the server URL is stored in the App Group container. The Widget extension can then fetch aggregate data without using dashboard session cookies.

## Widgets

The WidgetKit extension calls GET /api/v1/widget using Authorization: Bearer.

The companion ships two widget experiences:
- **ROI-NADOS Executive** — small, medium and large Home Screen layouts plus Lock Screen formats with revenue, sales, TikTok spend, ROAS, net profit, conversion, trend and factual attention.
- **Vendas ROI-NADOS** — a focused sales widget for Home Screen and Lock Screen showing today’s sales/revenue and the last sale.

The response contains aggregate business information only:
- revenue and sales;
- leads/conversion;
- TikTok spend and ROAS;
- net profit;
- previous-day trend;
- last-sale amount/time;
- factual attention flags.

It does not expose customer email, phone, order IDs, access tokens or checkout secrets. A last-good snapshot is cached in the shared App Group so widgets can keep useful data during transient network failures.

WidgetKit may defer refreshes even though the timeline requests a 15-minute cadence; iOS controls the actual refresh budget. Sale pushes also ask the app to reload WidgetKit timelines, but the final refresh timing remains under iOS control.

## Native sale sound

On first launch, SaleSoundInstaller generates Library/Sounds/roi-sale.wav directly on the device. Sale pushes sent through APNs reference this file.

The chime is a short three-note ROI-NADOS motif shared conceptually with the foreground dashboard sound. Daily reports remain passive and silent; operational failures use the system sound. This keeps the sale cue recognizable without making every notification noisy.

The native notifications also register contextual actions:
- sale: **Ver vendas**;
- daily brief: **Abrir resumo**;
- automation: **Revisar**.

This gives the native companion a recognizable ROI-NADOS sale sound while avoiding a binary audio asset in the repository.

## Server APNs variables

Configure:
- APNS_TEAM_ID
- APNS_KEY_ID
- APNS_BUNDLE_ID
- APNS_PRIVATE_KEY or APNS_PRIVATE_KEY_B64
- APNS_SANDBOX=true only for development builds

After pairing, enable “Preferir Companion no iPhone” in Conta → Alertas. The dashboard only allows this handoff when at least one native device is paired and APNs is configured.

Delivery semantics:
- approved sale: APNs active alert + `roi-sale.wav` + badge;
- critical operational failures: Time Sensitive + system sound;
- daily executive brief: passive, no sound;
- desktop/Android: Web Push remains active;
- if native APNs delivery fails, ROI-NADOS retries only the eligible iPhone/iPad Web Push subscriptions so a transient APNs failure does not become a silent alert loss.

The native switch is explicit and reversible; disabling it immediately restores normal Web Push routing.
