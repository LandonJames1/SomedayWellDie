/* ==============================================================
   THE SHARE EXTENSION

   "Share to Someday We'll Die" from Safari, Notes, Messages —
   anywhere iOS offers a share sheet. It is the one way an idea gets
   into the app without the app being open, which is the thing the
   web version cannot do at all.

   ⚠️ IT HANDS OFF AND GETS OUT OF THE WAY. There is deliberately no
   compose UI here — no SLComposeServiceViewController, no second
   form. An activity in this app needs a list, a name, a target
   date, a priority and a place (see NEW_REQUIRED in
   js/activities.js), and a share sheet is the wrong place to ask
   for five things. So this stashes what was shared, opens the app,
   and the app opens its own new-activity sheet with the text
   already in it. One form, in one place, and the app's own rule
   that nothing is ever inserted without a sheet still holds.

   ⚠️ THE STASH IS THE HANDOFF, NOT THE URL. A custom-scheme URL
   could carry the text as a query parameter, and that breaks the
   moment somebody shares something with a percent sign, an emoji
   or 4KB of selected prose. The App Group's UserDefaults has no
   length limit and no escaping to get wrong, so the URL says only
   "there is something waiting".
   ============================================================== */

import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {

    static let group = "group.com.landonjames.somedaywelldie"
    static let key = "somedayShare"

    override func viewDidLoad() {
        super.viewDidLoad()
        /* No view of its own: the extension appears and is gone. A
           blank sheet flashing up would read as the app hanging. */
        view.backgroundColor = .clear
        extract()
    }

    private func extract() {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        let providers = items.flatMap { $0.attachments ?? [] }

        /* A URL is preferred over text because Safari supplies BOTH —
           the page title as plain text and the address as a URL — and
           the address is the half that cannot be retyped. Where only
           text exists (Notes, a selection) that is what we take. */
        if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            p.loadItem(forTypeIdentifier: UTType.url.identifier) { [weak self] value, _ in
                let url = (value as? URL)?.absoluteString
                    ?? (value as? String) ?? ""
                /* The title, when the same share carried one. */
                let title = items.compactMap { $0.attributedContentText?.string }
                    .first(where: { !$0.isEmpty }) ?? ""
                self?.finish(name: title, url: url)
            }
            return
        }
        if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
            p.loadItem(forTypeIdentifier: UTType.plainText.identifier) { [weak self] value, _ in
                self?.finish(name: (value as? String) ?? "", url: "")
            }
            return
        }
        finish(name: "", url: "")
    }

    private func finish(name: String, url: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            /* One line of text is a name; a page of it is not. The app's
               name field is a single wrapped title, so anything longer
               is truncated here rather than pasted into a control that
               cannot show it. */
            var n = name.trimmingCharacters(in: .whitespacesAndNewlines)
            if let nl = n.firstIndex(where: { $0.isNewline }) { n = String(n[..<nl]) }
            if n.count > 140 { n = String(n.prefix(140)) }

            let payload: [String: String] = ["name": n, "url": url]
            if let d = UserDefaults(suiteName: Self.group),
               let data = try? JSONSerialization.data(withJSONObject: payload),
               let json = String(data: data, encoding: .utf8) {
                d.set(json, forKey: Self.key)
            }
            self.openHost()
            self.extensionContext?.completeRequest(returningItems: nil)
        }
    }

    /* ⚠️ An app extension has no UIApplication.shared, so the only
       supported way out is the extension context. The responder-chain
       walk below it is the long-standing fallback for the versions
       where that quietly does nothing on a share extension. */
    private func openHost() {
        guard let url = URL(string: "somedaywelldie://share") else { return }
        if let ctx = extensionContext {
            ctx.open(url) { ok in if ok { return } }
        }
        var r: UIResponder? = self
        while let cur = r {
            if let app = cur as? UIApplication {
                app.perform(#selector(UIApplication.open(_:options:completionHandler:)),
                            with: url, with: [:])
                return
            }
            r = cur.next
        }
    }
}
