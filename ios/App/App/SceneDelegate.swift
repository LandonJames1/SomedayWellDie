import UIKit
import Capacitor
import CoreSpotlight

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        /* ⚠️ MainViewController, NOT CAPBridgeViewController. It is the
           only thing that registers this app's own plugins — see the
           header of MainViewController.swift. Putting the stock class
           back silently turns off every native feature. */
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        /* ⚠️ A SPOTLIGHT TAP IS NOT A UNIVERSAL LINK, and Capacitor's
           proxy only knows about the second. iOS hands us the searchable
           item's identifier, which SpotlightIndex.swift deliberately
           made a complete deep link, so it can be posted straight down
           the same path a widget tap or a share takes — no new branch
           in js/deeplink.js, and nothing to look up on a cold start
           before the web layer is running. */
        if userActivity.activityType == CSSearchableItemActionType,
           let id = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
           let url = URL(string: id) {
            NotificationCenter.default.post(name: .capacitorOpenURL,
                                            object: ["url": url])
            return
        }
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
