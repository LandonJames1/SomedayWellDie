/* ==============================================================
   FACE ID / PASSCODE LOCK

   A bucket list is a list of things somebody has not done yet and
   the photographs of the ones they have. It is the kind of thing
   people hand a phone over with, and there was no way to keep it
   shut.

   ⚠️ IT IS A DOOR, NOT ENCRYPTION, and js/applock.js says so in as
   many words. LocalAuthentication answers "is this the phone's
   owner"; it does not hold a key, and nothing here re-encrypts the
   database, the IndexedDB snapshot or the Supabase session. Anyone
   with the device passcode and a debugger still reaches the data.
   Presenting it as more than it is would be the dishonest kind of
   security feature.

   ⚠️ .deviceOwnerAuthentication, NOT ...WithBiometrics. The second
   fails outright when Face ID is off, unenrolled, or locked out
   after too many attempts — and the fallback in every one of those
   cases has to be the device passcode, or the person is locked out
   of their own app by a feature they turned on for convenience.
   ============================================================== */

import Foundation
import Capacitor
import LocalAuthentication

@objc(AppLockPlugin)
public class AppLockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppLockPlugin"
    public let jsName = "AppLock"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
    ]

    @objc func available(_ call: CAPPluginCall) {
        let ctx = LAContext()
        var err: NSError?
        let ok = ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err)
        var kind = "none"
        if ok {
            switch ctx.biometryType {
            case .faceID: kind = "face"
            case .touchID: kind = "touch"
            default: kind = "passcode"
            }
        }
        /* "available" means there is any door at all. A device with no
           passcode set has none, and the setting hides rather than
           offering a lock that cannot lock. */
        call.resolve(["available": ok, "kind": kind])
    }

    @objc func authenticate(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Unlock your lists"
        /* A FRESH CONTEXT PER ATTEMPT. LAContext caches a successful
           evaluation for the life of the object, so a reused one would
           wave the second unlock straight through without asking. */
        let ctx = LAContext()
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, err in
            DispatchQueue.main.async {
                if ok { call.resolve(["ok": true]); return }
                let code = (err as? LAError)?.code
                /* Cancelling is an answer, not a failure — the lock
                   screen simply stays up with its Unlock button. */
                let cancelled = code == .userCancel || code == .appCancel || code == .systemCancel
                call.resolve(["ok": false, "cancelled": cancelled])
            }
        }
    }
}
