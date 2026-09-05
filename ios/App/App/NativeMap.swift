/* ==============================================================
   THE NATIVE MAP

   MapKit, presented over the web view, and the one place in this
   app where a whole screen is native rather than HTML.

   Why it is worth it, in order:
     - MapLibre is ~900KB fetched at runtime and was the single
       biggest cost of a cold launch on the one tab that needs it;
     - CARTO's raster basemap is a third-party dependency on a path
       the app cannot fail gracefully on;
     - and an iOS user knows this map already — the gestures, the
       look, the "Open in Maps" that comes with it.

   ⚠️ IT IS A MODAL, NOT A TAB, AND THAT IS THE WHOLE INTEGRATION.
   Nothing native is embedded inside the web view and no web
   element is drawn over native. The web app navigates to its own
   map page as it always did, that page asks for this, and
   dismissing hands control straight back. So there is exactly one
   seam, it is a present/dismiss, and the browser build never
   reaches it — see nativemap.js, where MapLibre still runs
   unchanged.

   ⚠️ THE POINTS COME FROM THE WEB LAYER, like the widget's. The
   filter, the To Go/Done split and which activities the account
   can even see are all decided by the same cache Home reads, so a
   second reading of them cannot drift.
   ============================================================== */

import Foundation
import Capacitor
import MapKit

class ActivityPin: NSObject, MKAnnotation {
    let id: String
    let title: String?
    let subtitle: String?
    let coordinate: CLLocationCoordinate2D
    let done: Bool
    let priority: String

    init(id: String, title: String?, subtitle: String?,
         coordinate: CLLocationCoordinate2D, done: Bool, priority: String) {
        self.id = id; self.title = title; self.subtitle = subtitle
        self.coordinate = coordinate; self.done = done; self.priority = priority
    }

    /* The app's own scale, kept in step with PRI_VAR in map.js and the
       tokens in base.css. Done outranks priority, exactly as it does on
       the web map: a finished thing has no next. */
    var tint: UIColor {
        if done { return UIColor(red: 0.42, green: 0.53, blue: 0.33, alpha: 1) }   // --green
        switch priority {
        case "high":   return UIColor(red: 0.61, green: 0.35, blue: 0.18, alpha: 1) // --pri-high
        case "low":    return UIColor(red: 0.26, green: 0.53, blue: 0.60, alpha: 1) // --slate
        default:       return UIColor(red: 0.42, green: 0.27, blue: 0.67, alpha: 1) // --violet
        }
    }
}

class NativeMapViewController: UIViewController, MKMapViewDelegate {

    var pins: [ActivityPin] = []
    /* Called with an activity id when a pin's callout is tapped, or
       with nil when the screen is simply closed. */
    var onFinish: ((String?) -> Void)?

    private let map = MKMapView()
    private var answered = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        map.frame = view.bounds
        map.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        map.delegate = self
        /* No user-location dot: the app never asks for a fix just to
           draw a map, and requesting one here would raise a permission
           prompt nobody pressed anything to get. Same rule primeBias()
           follows in location.js. */
        map.showsUserLocation = false
        map.pointOfInterestFilter = .excludingAll
        view.addSubview(map)

        map.addAnnotations(pins)
        fitAll()

        let done = UIButton(type: .close)
        done.translatesAutoresizingMaskIntoConstraints = false
        done.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        view.addSubview(done)
        NSLayoutConstraint.activate([
            done.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            done.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
        ])
    }

    /* Everything in view, with room around the edges — and a floor on
       how far it will zoom in, or a library with one pin in it opens
       looking down a chimney. */
    private func fitAll() {
        guard !pins.isEmpty else { return }
        var rect = MKMapRect.null
        for p in pins {
            let pt = MKMapPoint(p.coordinate)
            rect = rect.union(MKMapRect(x: pt.x, y: pt.y, width: 0, height: 0))
        }
        map.setVisibleMapRect(rect,
            edgePadding: UIEdgeInsets(top: 90, left: 60, bottom: 90, right: 60),
            animated: false)
        if map.region.span.latitudeDelta < 0.02 {
            map.setRegion(MKCoordinateRegion(center: map.region.center,
                span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)),
                animated: false)
        }
    }

    func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
        guard let pin = annotation as? ActivityPin else { return nil }
        let id = "activity"
        let v = (mapView.dequeueReusableAnnotationView(withIdentifier: id) as? MKMarkerAnnotationView)
            ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: id)
        v.annotation = annotation
        v.markerTintColor = pin.tint
        v.glyphImage = UIImage(systemName: pin.done ? "checkmark" : "flag.fill")
        v.canShowCallout = true
        /* MapKit does the clustering itself once annotations share an
           identifier — the same job actsToGeoJSON() hands to MapLibre's
           worker on the web side. */
        v.clusteringIdentifier = "activity"
        v.displayPriority = pin.priority == "high" && !pin.done ? .required : .defaultHigh
        let open = UIButton(type: .detailDisclosure)
        v.rightCalloutAccessoryView = open
        return v
    }

    func mapView(_ mapView: MKMapView, annotationView view: MKAnnotationView,
                 calloutAccessoryControlTapped control: UIControl) {
        guard let pin = view.annotation as? ActivityPin else { return }
        finish(pin.id)
    }

    @objc private func closeTapped() { finish(nil) }

    /* ⚠️ Answers ONCE. The promise on the other side is a single
       resolve, and a swipe-dismiss racing the close button would
       otherwise settle it twice. */
    private func finish(_ id: String?) {
        guard !answered else { return }
        answered = true
        dismiss(animated: true) { [weak self] in self?.onFinish?(id) }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        /* A swipe down never reaches the close button. */
        if !answered { answered = true; onFinish?(nil) }
    }
}

@objc(NativeMapPlugin)
public class NativeMapPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeMapPlugin"
    public let jsName = "NativeMap"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "present", returnType: CAPPluginReturnPromise)
    ]

    @objc func present(_ call: CAPPluginCall) {
        let rows = call.getArray("points", JSObject.self) ?? []
        let pins: [ActivityPin] = rows.compactMap { r in
            guard let id = r["id"] as? String,
                  let lat = r["lat"] as? Double,
                  let lng = r["lng"] as? Double else { return nil }
            return ActivityPin(
                id: id,
                title: r["name"] as? String,
                subtitle: r["detail"] as? String,
                coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                done: (r["done"] as? Bool) ?? false,
                priority: (r["priority"] as? String) ?? "medium")
        }

        DispatchQueue.main.async { [weak self] in
            guard let host = self?.bridge?.viewController else {
                call.reject("no view controller"); return
            }
            let vc = NativeMapViewController()
            vc.pins = pins
            vc.modalPresentationStyle = .fullScreen
            vc.onFinish = { id in
                var o = JSObject()
                o["openId"] = id ?? ""
                call.resolve(o)
            }
            host.present(vc, animated: true)
        }
    }
}
