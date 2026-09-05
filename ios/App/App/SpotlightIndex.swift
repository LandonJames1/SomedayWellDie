/* ==============================================================
   SPOTLIGHT — the app's activities in the phone's own search.

   Pull down on the home screen, type "Iceland", and the activity
   comes up with its list and its deadline under it. Tapping it
   opens the app on that activity's sheet.

   ⚠️ THE UNIQUE IDENTIFIER IS THE DEEP LINK ITSELF, deliberately.
   iOS hands the identifier back on a tap and nothing else, so
   anything that is not enough to act on has to be looked up — and
   the lookup would be in JavaScript, which is not running yet on a
   cold start. `somedaywelldie://open#activity/<id>` is complete on
   its own, and SceneDelegate can post it straight down the same
   path a share or a widget tap takes. One route in, and no new
   branch in js/deeplink.js.

   ⚠️ AND THE INDEX IS REPLACED, NOT APPENDED TO. Deleting an
   activity, leaving a shared list, or signing out must all take
   its rows out of a search index that lives on the device and
   outlives the process. Rather than tracking each of those, the
   web layer republishes the whole set and this deletes the domain
   first — see js/spotlight.js for why that is affordable.
   ============================================================== */

import Foundation
import Capacitor
import CoreSpotlight
import UniformTypeIdentifiers

@objc(SpotlightIndexPlugin)
public class SpotlightIndexPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpotlightIndexPlugin"
    public let jsName = "SpotlightIndex"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "index", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    static let domain = "activities"

    @objc func index(_ call: CAPPluginCall) {
        let rows = call.getArray("items", JSObject.self) ?? []

        let items: [CSSearchableItem] = rows.compactMap { row in
            guard let id = row["id"] as? String, !id.isEmpty else { return nil }
            let attrs = CSSearchableItemAttributeSet(contentType: UTType.content)
            let name = row["name"] as? String
            attrs.title = name
            /* Set as well as the title: some Spotlight surfaces read one
               and some the other, and an item with only a title comes
               back unlabelled in the ones that read displayName. */
            attrs.displayName = name
            /* One line under the title: the list it is in and when it is
               due, which is what the app's own rows show. */
            attrs.contentDescription = row["detail"] as? String

            /* ⚠️ THE HALF THAT ACTUALLY MAKES IT FINDABLE. A title is
               matched largely from its start, so before this you had to
               type most of an activity's name to see it at all. Keywords
               are matched per word and far more loosely, and the web
               side fills them with every meaningful word of the name,
               its list and its place — see spotlightKeywords(). */
            if let kw = row["keywords"] as? [String], !kw.isEmpty {
                attrs.keywords = kw
            }
            /* And the full-text body, which is what lets a word from the
               middle of a place name match. */
            if let text = row["text"] as? String, !text.isEmpty {
                attrs.textContent = text
            }
            /* Lower sorts higher. The app's only say in whether
               something unfinished beats something finished years ago;
               Spotlight weighs it against its own relevance rather than
               obeying it. */
            if let rank = row["rank"] as? Int {
                attrs.rankingHint = NSNumber(value: rank)
            }
            return CSSearchableItem(
                uniqueIdentifier: "somedaywelldie://open#activity/\(id)",
                domainIdentifier: Self.domain,
                attributeSet: attrs)
        }

        /* Delete-then-add rather than add-alone: see the second warning
           above. Both are cheap and neither blocks the caller. */
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [Self.domain]) { _ in
            guard !items.isEmpty else { return }
            CSSearchableIndex.default().indexSearchableItems(items) { err in
                if let err { CAPLog.print("[spotlight] index failed:", err.localizedDescription) }
            }
        }
        /* Resolved immediately, but WITH THE COUNT. Nothing on screen is
           waiting for a search index — holding the bridge open for a
           disk write on the path Home renders through would be wrong —
           but "how many rows did the native side actually receive" is
           the one question that separates "the bridge is not delivering"
           from "Spotlight is not indexing", and it is unanswerable from
           the web layer otherwise. */
        call.resolve(["count": items.count, "received": rows.count])
    }

    @objc func clear(_ call: CAPPluginCall) {
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [Self.domain]) { _ in }
        call.resolve()
    }
}
