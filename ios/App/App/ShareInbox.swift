/* ==============================================================
   SHARE INBOX — the web layer's read side of the share extension.

   The extension cannot reach into the web view, so it leaves what
   was shared in the App Group's UserDefaults and opens the app with
   somedaywelldie://share. js/deeplink.js sees that, calls take()
   here, and opens the app's own new-activity sheet with the text in
   it. See ShareViewController.swift for why the payload does not
   ride on the URL.

   ⚠️ take() IS DESTRUCTIVE, AND HAS TO BE. The stash is a single
   slot: reading without clearing would re-open the sheet with the
   same link on every later launch, and the second time it would
   look like the app had invented it.
   ============================================================== */

import Foundation
import Capacitor

@objc(ShareInboxPlugin)
public class ShareInboxPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareInboxPlugin"
    public let jsName = "ShareInbox"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise)
    ]

    static let group = "group.com.landonjames.somedaywelldie"
    static let key = "somedayShare"

    @objc func take(_ call: CAPPluginCall) {
        guard let d = UserDefaults(suiteName: Self.group),
              let json = d.string(forKey: Self.key) else {
            /* Nothing waiting is an ordinary answer, not a failure —
               the app is opened by the scheme for other reasons too. */
            call.resolve(["json": ""]); return
        }
        d.removeObject(forKey: Self.key)
        call.resolve(["json": json])
    }
}
