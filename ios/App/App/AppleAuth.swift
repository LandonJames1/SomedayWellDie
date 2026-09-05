/* ==============================================================
   SIGN IN WITH APPLE

   Native, not the web flow. Supabase can do Apple over OAuth in a
   browser tab, and inside the shell that means bouncing out to
   Safari and back — which is the exact "this is a website" seam
   the rest of this work exists to remove. ASAuthorization is a
   system sheet with Face ID on it.

   The token goes to Supabase's signInWithIdToken() from
   js/appleauth.js. Nothing here talks to Supabase: the session,
   the profile row and the error text all live in the web layer,
   and a second implementation of any of them would be a second
   thing to keep in step.

   ⚠️ THE NONCE IS TWO VALUES AND THEY ARE NOT INTERCHANGEABLE.
   Apple is given the SHA-256 HASH; Supabase must be given the RAW
   string, and it hashes it again to compare. Sending the hash to
   both — the easy mistake, since one variable would then do — is
   rejected as an invalid nonce, and the error says nothing about
   which half was wrong.

   ⚠️ THE NAME ARRIVES EXACTLY ONCE. Apple returns fullName only on
   the FIRST authorization for an app; every later sign-in has it
   nil, forever, with no way to ask again. So it is passed back
   here and the web layer writes it onto the profile immediately —
   see createUserProfile() in js/me.js. Deleting the app does not
   reset it; only revoking the app under Settings → Apple Account →
   Sign in with Apple does.
   ============================================================== */

import Foundation
import Capacitor
import AuthenticationServices
import CryptoKit

@objc(AppleAuthPlugin)
public class AppleAuthPlugin: CAPPlugin, CAPBridgedPlugin,
                              ASAuthorizationControllerDelegate,
                              ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "AppleAuthPlugin"
    public let jsName = "AppleAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
    ]

    private var pending: CAPPluginCall?
    private var rawNonce: String?

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    @objc func signIn(_ call: CAPPluginCall) {
        if pending != nil { call.reject("a sign-in is already in progress"); return }
        pending = call

        let nonce = Self.randomNonce()
        rawNonce = nonce

        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = Self.sha256(nonce)          // the HASH — see above

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let c = ASAuthorizationController(authorizationRequests: [request])
            c.delegate = self
            c.presentationContextProvider = self
            c.performRequests()
        }
    }

    // MARK: - Result

    public func authorizationController(controller: ASAuthorizationController,
                                        didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = cred.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            finish(reject: "no identity token")
            return
        }
        let name = [cred.fullName?.givenName, cred.fullName?.familyName]
            .compactMap { $0 }.joined(separator: " ")

        var o = JSObject()
        o["idToken"] = token
        o["nonce"] = rawNonce ?? ""                 // the RAW string — see above
        o["name"] = name
        /* Also only present on the first authorization, and null when
           the user chose Hide My Email — in which case the token still
           carries Apple's relay address and Supabase uses that. */
        o["email"] = cred.email ?? ""
        finish(resolve: o)
    }

    public func authorizationController(controller: ASAuthorizationController,
                                        didCompleteWithError error: Error) {
        /* Cancelling is not a failure. It resolves with nothing so the
           web layer can return quietly rather than putting "the
           operation was cancelled" on the sign-in screen. */
        if let e = error as? ASAuthorizationError, e.code == .canceled {
            var o = JSObject(); o["cancelled"] = true
            finish(resolve: o)
            return
        }
        finish(reject: error.localizedDescription)
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    private func finish(resolve: JSObject? = nil, reject: String? = nil) {
        let call = pending
        pending = nil
        rawNonce = nil
        if let reject { call?.reject(reject) } else { call?.resolve(resolve ?? JSObject()) }
    }

    // MARK: - Nonce

    private static func randomNonce(_ length: Int = 32) -> String {
        let chars = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var bytes = [UInt8](repeating: 0, count: length)
        _ = SecRandomCopyBytes(kSecRandomDefault, length, &bytes)
        return String(bytes.map { chars[Int($0) % chars.count] })
    }

    private static func sha256(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
