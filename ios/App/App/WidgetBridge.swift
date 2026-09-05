/* ==============================================================
   WIDGET BRIDGE — the web layer's one way to write to the widget.

   The widget cannot fetch for itself: the session, the RLS scope
   and the offline snapshot all live in JavaScript, so anything
   native would be a second and disagreeing reading of "next". So
   the web layer computes the numbers it is already computing for
   Home and posts them here, into the App Group's UserDefaults,
   which is the only storage both processes can see.

   ⚠️ THE APP GROUP STRING APPEARS IN FOUR PLACES and must be the
   same in all of them: here, WIDGET_GROUP in SomedayWidget.swift,
   App.entitlements and SomedayWidget.entitlements — plus enabled on
   both App IDs in the developer portal. A mismatch throws nothing:
   the write lands in a suite the widget does not read, and the
   widget sits on its placeholder forever.
   ============================================================== */

import Foundation
import Capacitor
import WidgetKit

@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "publish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    static let group = "group.com.landonjames.somedaywelldie"
    static let key = "somedaySnapshot"

    /* The payload is passed as a JSON *string* rather than as a
       JSObject, so the shape is decided once — by the Codable structs
       in SomedayWidget.swift — instead of being rebuilt here and
       given a second chance to disagree. */
    @objc func publish(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("json is required"); return
        }
        guard let d = UserDefaults(suiteName: Self.group) else {
            /* Rejecting rather than silently succeeding: this is the
               exact failure the four-places warning above describes,
               and it is worth one line in the console. */
            call.reject("app group unavailable: \(Self.group)"); return
        }
        d.set(json, forKey: Self.key)
        reload()
        /* Read straight back out of the suite rather than reporting what
           we were handed: that is the difference between "the app wrote
           it" and "the App Group is actually shared", which is the thing
           that silently is not, and the widget's placeholder is the only
           other symptom. */
        let stored = (UserDefaults(suiteName: Self.group)?.string(forKey: Self.key) ?? "").count
        call.resolve(["stored": stored])
    }

    /* Sign-out. The widget is on a home screen the next person to
       pick up the phone can see, so it must not outlive the session
       that filled it. */
    @objc func clear(_ call: CAPPluginCall) {
        UserDefaults(suiteName: Self.group)?.removeObject(forKey: Self.key)
        reload()
        call.resolve()
    }

    private func reload() {
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
}
