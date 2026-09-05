/* ==============================================================
   ⚠️ WHERE THIS APP'S OWN PLUGINS ARE REGISTERED.

   A plugin that ships as a Swift PACKAGE — @capacitor/app,
   /haptics, /keyboard, /push-notifications — is found on its own,
   because the package is a declared dependency of CapApp-SPM and
   Capacitor walks what it was linked against.

   A plugin defined in the APP TARGET is not. Conforming to
   CAPBridgedPlugin and marking the class @objc is necessary and is
   NOT sufficient: nothing enumerates the app binary looking for
   them, so the class compiles, ships, and is never attached to the
   bridge.

   And it fails in total silence. Capacitor.Plugins.WidgetBridge is
   simply undefined, every guard in the web layer reads that as
   "not running natively" — which is exactly what those guards are
   FOR — and each feature hides itself as designed. The widget sat
   on "Nothing next", Spotlight indexed nothing, the picker fell
   back to the <input>, the Apple button and the lock row stayed
   hidden and the map quietly loaded MapLibre. Seven features, one
   cause, no error anywhere.

   ⚠️ SO: EVERY PLUGIN IN THE App FOLDER MUST BE LISTED BELOW. Adding
   the file to the target is not enough. If a native feature is
   "not doing anything", look here first.
   ============================================================== */

import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {

    override func capacitorDidLoad() {
        /* Registered as INSTANCES rather than types: these are plain
           objects with no configuration, and an instance is what the
           bridge ends up holding either way. */
        bridge?.registerPluginInstance(WidgetBridgePlugin())
        bridge?.registerPluginInstance(SpotlightIndexPlugin())
        bridge?.registerPluginInstance(ShareInboxPlugin())
        bridge?.registerPluginInstance(NativeMediaPlugin())
        bridge?.registerPluginInstance(AppleAuthPlugin())
        bridge?.registerPluginInstance(AppLockPlugin())
        bridge?.registerPluginInstance(NativeMapPlugin())
    }
}
