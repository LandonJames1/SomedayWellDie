/* ==============================================================
   THE HOME SCREEN WIDGET

   The one part of this app that is not a web view, and the reason
   it exists is twofold: Up Next is the question the app answers
   ("what is closest?"), and a widget answers it without the app
   being opened at all — which is also the clearest possible answer
   to Guideline 4.2, since a website cannot do this.

   ⚠️ IT OWNS NO DATA AND MAKES NO NETWORK CALL. Everything comes
   out of the App Group's UserDefaults, written by the web layer
   through WidgetBridge (see WidgetBridge.swift). A widget that
   fetched for itself would need the Supabase session, the RLS
   scope and the offline snapshot — three things that live in
   JavaScript — and would then be a second, disagreeing copy of the
   app's reading of "next".

   So the timeline is deliberately a SINGLE entry with .never as its
   policy: there is nothing to refresh towards. The web layer calls
   reloadAllTimelines() when the numbers actually change.
   ============================================================== */

import WidgetKit
import SwiftUI

/* Must match APP_GROUP in WidgetBridge.swift and the App Group
   enabled on BOTH targets' entitlements. A mismatch is silent — the
   widget simply reads nothing and shows its placeholder forever. */
let WIDGET_GROUP = "group.com.landonjames.somedaywelldie"
let WIDGET_KEY = "somedaySnapshot"

// MARK: - The shape the web layer writes

struct UpNextItem: Codable, Hashable {
    let name: String
    let when: String       // "18 days", "Dec 31", "Overdue" — already formatted
    let urgent: Bool       // overdue or urgent: the only two that tint
    let list: String
}

struct KpiItem: Codable, Hashable {
    let count: Int
    let label: String
}

struct Snapshot: Codable {
    let total: Int
    let done: Int
    /* The single number on the face of the widget, and the band it
       belongs to — "4", "Overdue". Chosen on the web side by
       widgetKpi(), which walks the app's own band order and stops at
       the first one with anything in it. See widget.js. */
    let kpiCount: Int
    let kpiLabel: String
    /* The two nearest bands that have anything in them, chosen on the
       web side by widgetKpis(). One entry when only one band is
       occupied; never more than two. */
    let kpis: [KpiItem]
    let next: [UpNextItem]

    /* ⚠️ EVERY FIELD DECODES WITH A DEFAULT, deliberately. The payload
       already in the App Group was written by whatever version of the
       app ran last, and a strict decode of a shape that has since
       gained a field throws — which this widget cannot report, so it
       falls back to .empty and reads as "the bridge is broken". It is
       not defensive coding for its own sake: it is the difference
       between an update losing one number for one launch and an update
       appearing to break the widget outright. */
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        total     = (try? c.decodeIfPresent(Int.self, forKey: .total)) as? Int ?? 0
        done      = (try? c.decodeIfPresent(Int.self, forKey: .done)) as? Int ?? 0
        kpiCount  = (try? c.decodeIfPresent(Int.self, forKey: .kpiCount)) as? Int ?? 0
        kpiLabel  = (try? c.decodeIfPresent(String.self, forKey: .kpiLabel)) as? String ?? ""
        next      = (try? c.decodeIfPresent([UpNextItem].self, forKey: .next)) as? [UpNextItem] ?? []
        /* A payload written before the pair existed carries only the
           single kpiCount/kpiLabel, so it is promoted rather than read
           as "no bands" — the same reason every other field here has a
           default. */
        let pair  = (try? c.decodeIfPresent([KpiItem].self, forKey: .kpis)) as? [KpiItem] ?? []
        kpis      = pair.isEmpty && !kpiLabel.isEmpty
                    ? [KpiItem(count: kpiCount, label: kpiLabel)]
                    : pair
    }

    init(total: Int, done: Int, kpis: [KpiItem], next: [UpNextItem]) {
        self.total = total; self.done = done
        self.kpis = kpis
        self.kpiCount = kpis.first?.count ?? 0
        self.kpiLabel = kpis.first?.label ?? ""
        self.next = next
    }

    /* ⚠️ DELIBERATELY NOT PLAUSIBLE-LOOKING. This is what the gallery
       and the SwiftUI preview canvas draw, and an earlier version put
       invented activity names and a made-up 9-of-24 in here — so any
       moment the real read came back empty, the widget showed
       convincing data that was simply false, and it read as the widget
       being WRONG rather than as it being empty. A placeholder's job is
       to show the SHAPE. Generic strings can never be mistaken for the
       user's own rows. */
    static let placeholder = Snapshot(
        total: 0, done: 0,
        kpis: [KpiItem(count: 0, label: "Up next"), KpiItem(count: 0, label: "After that")],
        next: [
            UpNextItem(name: "Your next activity", when: "—", urgent: false, list: ""),
            UpNextItem(name: "Then this one", when: "—", urgent: false, list: ""),
            UpNextItem(name: "And this one", when: "—", urgent: false, list: ""),
            UpNextItem(name: "And this one too", when: "—", urgent: false, list: ""),
        ])

    static let empty = Snapshot(total: 0, done: 0, kpis: [], next: [])
}

func readSnapshot() -> Snapshot {
    guard let d = UserDefaults(suiteName: WIDGET_GROUP),
          let raw = d.string(forKey: WIDGET_KEY),
          let data = raw.data(using: .utf8),
          let snap = try? JSONDecoder().decode(Snapshot.self, from: data)
    else { return .empty }
    return snap
}

// MARK: - Timeline

struct Entry: TimelineEntry {
    let date: Date
    let snap: Snapshot
}

struct Provider: TimelineProvider {
    /* The gallery preview. Real zeros here would show an empty card
       to somebody deciding whether to add the widget at all. */
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), snap: .placeholder)
    }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: Date(),
                         snap: context.isPreview ? .placeholder : readSnapshot()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [Entry(date: Date(), snap: readSnapshot())],
                            policy: .never))
    }
}

// MARK: - Palette
//
// The app's own tokens, hardcoded because a widget cannot read the
// web layer's CSS. Keep them in step with :root in css/base.css.

extension Color {
    static let sdBG      = Color(red: 0.937, green: 0.925, blue: 0.902)   // --bg
    static let sdBGDark  = Color(red: 0.086, green: 0.078, blue: 0.059)
    static let sdLabel   = Color(red: 0.110, green: 0.102, blue: 0.086)   // --label
    static let sdLabelD  = Color(red: 0.949, green: 0.933, blue: 0.894)
    static let sdTint    = Color(red: 0.612, green: 0.353, blue: 0.180)   // --pri-high
    static let sdGreen   = Color(red: 0.424, green: 0.533, blue: 0.325)   // --green
    static let sdMuted   = Color(red: 0.435, green: 0.412, blue: 0.365)
    static let sdMutedD  = Color(red: 0.784, green: 0.761, blue: 0.706)
}

/* One place that answers "which ground am I on", so no view has to
   carry a colorScheme branch of its own. */
struct Palette {
    let dark: Bool
    var bg: Color { dark ? .sdBGDark : .sdBG }
    var label: Color { dark ? .sdLabelD : .sdLabel }
    var muted: Color { dark ? .sdMutedD : .sdMuted }
    var rule: Color { (dark ? Color.white : Color.black).opacity(0.10) }
}

// MARK: - Pieces

/* ⚠️ ONE NUMBER, AND IT IS NOT A PERCENTAGE. This was a progress ring
   — done out of total — which is a fact about the past and the same
   fact every day: a library of four hundred moves that dial by a
   quarter of a percent when you finish something, so it never visibly
   changed. The number that earns the space is how much is actually
   coming at you, which is why it carries its band's name underneath.

   The serif at 40pt is the app's own display face doing what it does
   on Home's stat numerals. */
struct KPI: View {
    let item: KpiItem
    let p: Palette
    /* The two stacked share a column, so the numeral is passed in
       rather than fixed: one on its own can afford 50, a pair cannot. */
    var size: CGFloat = 50
    /* ⚠️ ONLY THE FIRST BAND TINTS, and only when it is Overdue. Both
       halves in terracotta would be two alarms rather than a ranking,
       and the lower band is by definition the less pressing of the
       two. Matches dateInfo()'s rule on the web side. */
    var hot: Bool = false

    var body: some View {
        /* Centred rather than leading: it is a stat on its own half of
           the card, not a label above something, and left-aligned it
           read as having been pushed into the corner. */
        VStack(alignment: .center, spacing: 0) {
            Text("\(item.count)")
                .font(.system(size: size, weight: .semibold, design: .serif))
                .foregroundStyle(hot ? Color.sdTint : p.label)
                /* A three-digit count still has to fit the same column,
                   so the type gives way rather than the column. */
                .minimumScaleFactor(0.45)
                .lineLimit(1)
            Text(item.label.uppercased())
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .tracking(1.0)
                .foregroundStyle(hot ? Color.sdTint : p.muted)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/* The KPI column: the two nearest bands, stacked, sharing the height.
   One entry simply fills it, so nothing special-cases the case where
   only one band has anything in it. */
struct KPIStack: View {
    let kpis: [KpiItem]
    let p: Palette
    var single: CGFloat = 50
    var paired: CGFloat = 33

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(kpis.prefix(2).enumerated()), id: \.offset) { i, k in
                if i > 0 {
                    Rectangle().fill(p.rule).frame(height: 0.6)
                        .padding(.vertical, 5)
                }
                KPI(item: k, p: p,
                    size: kpis.count > 1 ? paired : single,
                    hot: i == 0 && k.label.lowercased() == "overdue")
                    .frame(maxHeight: .infinity)
            }
        }
    }
}

/* The mono small-caps eyebrow the whole app is built on. */
struct Eyebrow: View {
    let text: String
    let p: Palette
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 9, weight: .semibold, design: .monospaced))
            .tracking(1.1)
            .foregroundStyle(p.muted)
    }
}

struct Row: View {
    let item: UpNextItem
    let p: Palette
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(item.name)
                /* 12.5 rather than 13: four rows plus their rules have
                   to clear a medium widget's content height, and the
                   deadline beside them does not shrink. */
                .font(.system(size: 12.5, weight: .medium, design: .serif))
                .foregroundStyle(p.label)
                .lineLimit(1)
            Spacer(minLength: 4)
            Text(item.when)
                .font(.system(size: 9.5, weight: .semibold, design: .monospaced))
                /* Only overdue and urgent tint, exactly as dateInfo()
                   decides on the web side. Any other band would be a
                   second colour scale on four square inches. */
                .foregroundStyle(item.urgent ? Color.sdTint : p.muted)
                .lineLimit(1)
                .fixedSize()          // a truncated deadline is a wrong number
        }
    }
}

struct Empty: View {
    let p: Palette
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Nothing next")
                .font(.system(size: 14, weight: .medium, design: .serif))
                .foregroundStyle(p.label)
            /* Says which of the two empties this is: the account really
               has nothing pending, or nothing has ever been published to
               the App Group. Same words either way from the user's side,
               but it is never the placeholder — which is how you tell
               from the outside that the bridge ran at all. */
            Text("Open the app to add something")
                .font(.system(size: 11))
                .foregroundStyle(p.muted)
        }
    }
}

// MARK: - The two families

struct WidgetBody: View {
    @Environment(\.colorScheme) var scheme
    @Environment(\.widgetFamily) var family
    let snap: Snapshot
    var p: Palette { Palette(dark: scheme == .dark) }

    var body: some View {
        Group {
            if family == .systemSmall { small } else { medium }
        }
        .containerBackground(p.bg, for: .widget)
    }

    /* Small: the number, and the single most pressing thing under it.
       Four rows do not fit here and a truncated list is worse than an
       honest one. */
    /* Small: the two bands and nothing else. A row under them would
       leave each number too small to read at a glance, which is the
       one thing this size is for — the medium widget is where the list
       lives. */
    var small: some View {
        KPIStack(kpis: snap.kpis, p: p, single: 54, paired: 38)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /* Medium: the number on the left, the four soonest on the right —
       the same rows, in the same order, that Home's Up Next shelf
       draws, because both come out of sortUpNext().

       ⚠️ EACH ROW TAKES maxHeight: .infinity, WHICH IS WHAT CLOSES THE
       GAP. Four rows at their natural height came to well under the
       card's, so the content sat in the top two-thirds with a band of
       dead space beneath it and read as clipped. Giving every row an
       equal share of what is left makes the list fill the card, and it
       keeps doing so at any widget height rather than being tuned to
       one. The KPI takes the full height too, so it centres against the
       list instead of hanging off the top. */
    var medium: some View {
        HStack(spacing: 12) {
            KPIStack(kpis: snap.kpis, p: p)
                .frame(width: 84)
                .frame(maxHeight: .infinity)
            VStack(alignment: .leading, spacing: 0) {
                Eyebrow(text: "Up Next", p: p)
                if snap.next.isEmpty {
                    Empty(p: p)
                    Spacer(minLength: 0)
                } else {
                    ForEach(Array(snap.next.prefix(4).enumerated()), id: \.offset) { i, it in
                        if i > 0 {
                            Rectangle().fill(p.rule).frame(height: 0.6)
                        }
                        Row(item: it, p: p)
                            .frame(maxHeight: .infinity)
                    }
                }
            }
        }
    }
}

@main
struct SomedayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SomedayWidget", provider: Provider()) { entry in
            WidgetBody(snap: entry.snap)
                /* Tapping goes to Up Next, not to Home — the widget is
                   already showing Home's summary, so landing there
                   would be the one screen the tap adds nothing to.

                   A HASH rather than a query: js/deeplink.js already
                   hands any hash straight to js/router.js, which knows
                   every route. A `?route=` would have needed a branch
                   of its own and a second place to keep in step. */
                .widgetURL(URL(string: "somedaywelldie://open#upnext"))
        }
        .configurationDisplayName("Up Next")
        .description("What is closest, and how much of your list you have done.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
