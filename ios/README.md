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

## Widget

The WidgetKit extension calls GET /api/v1/widget using Authorization: Bearer.

The response contains aggregate business information only:
- revenue;
- sales;
- leads/conversion;
- TikTok spend;
- ROAS;
- net profit;
- factual attention flags.

It does not expose customer email, phone, order IDs, access tokens or checkout secrets.

WidgetKit may defer refreshes even though the timeline requests a 15-minute cadence; iOS controls the actual refresh budget.

## Native sale sound

On first launch, SaleSoundInstaller generates Library/Sounds/roi-sale.wav directly on the device. Sale pushes sent through APNs reference this file.

This gives the native companion a recognizable ROI-NADOS sale sound while avoiding a binary audio asset in the repository.

## Server APNs variables

Configure:
- APNS_TEAM_ID
- APNS_KEY_ID
- APNS_BUNDLE_ID
- APNS_PRIVATE_KEY or APNS_PRIVATE_KEY_B64
- APNS_SANDBOX=true only for development builds

After pairing, enable “Preferir Companion no iPhone” in Conta → Alertas. Only then ROI-NADOS suppresses Web Push to iPhone/iPad subscriptions and routes those alerts through APNs; desktop/Android Web Push remains active. This explicit switch avoids silently changing an existing notification channel.
