/* ==============================================================
   THE NATIVE PICKER — and the reason it is worth having.

   The web layer picks media with <input type="file">, which works
   and quietly breaks one thing: iOS hands Safari a CONVERTED copy
   of a HEIC photo, and the conversion drops every EXIF tag. So
   js/exif.js — the whole "where was this taken" feature — reads a
   file that no longer has the GPS block in it, on the default
   camera format of every modern iPhone. It fails silently, which
   is exactly how it was written up in the backlog.

   PHPicker hands back the ORIGINAL file. Same bytes off the disk,
   metadata intact.

   ⚠️ THE BYTES DO NOT CROSS THE BRIDGE. Each pick is copied into
   the app's own tmp/ and what comes back is a URL the web view can
   fetch, the same shape @capacitor/camera's `webPath` uses. A 20MB
   clip base64'd into a bridge message would be ~27MB of string on
   the main thread, and video is the case this most needs to
   survive.

   ⚠️ NOTHING HERE REPLACES THE WEB PATH. In a browser this plugin
   does not exist and js/nativemedia.js falls through to the same
   hidden <input> the app has always used. See that file.
   ============================================================== */

import Foundation
import Capacitor
import PhotosUI
import UniformTypeIdentifiers
import AVFoundation

@objc(NativeMediaPlugin)
public class NativeMediaPlugin: CAPPlugin, CAPBridgedPlugin,
                                PHPickerViewControllerDelegate,
                                UIImagePickerControllerDelegate,
                                UINavigationControllerDelegate {
    public let identifier = "NativeMediaPlugin"
    public let jsName = "NativeMedia"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise)
    ]

    private var pending: CAPPluginCall?

    @objc func pick(_ call: CAPPluginCall) {
        /* One picker at a time. A second call while one is up would
           strand the first promise, and the sheet it belongs to would
           wait for an answer that never comes. */
        if pending != nil { call.reject("a picker is already open"); return }
        pending = call
        let source = call.getString("source") ?? "library"
        DispatchQueue.main.async { [weak self] in
            source == "camera" ? self?.presentCamera() : self?.presentLibrary(call)
        }
    }

    // MARK: - Library

    private func presentLibrary(_ call: CAPPluginCall) {
        var cfg = PHPickerConfiguration(photoLibrary: .shared())
        cfg.filter = .any(of: [.images, .videos])
        cfg.selectionLimit = call.getInt("limit") ?? 0     // 0 = no limit
        /* ⚠️ .current, NOT .automatic. `automatic` is what re-encodes a
           HEIC to JPEG on the way out — the very transcode this plugin
           exists to avoid. `current` hands back the file as stored. */
        cfg.preferredAssetRepresentationMode = .current
        let vc = PHPickerViewController(configuration: cfg)
        vc.delegate = self
        bridge?.viewController?.present(vc, animated: true)
    }

    public func picker(_ picker: PHPickerViewController,
                       didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard !results.isEmpty else { finish(files: []); return }

        var out = [JSObject]()
        let group = DispatchGroup()
        let lock = NSLock()

        for r in results {
            let p = r.itemProvider
            /* Whichever concrete type this asset actually is: movie
               first, because a video also advertises an image type for
               its poster frame and taking that would silently turn a
               clip into a still. */
            let type = p.hasItemConformingToTypeIdentifier(UTType.movie.identifier)
                ? UTType.movie.identifier
                : (p.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .image) == true }
                   ?? UTType.image.identifier)
            group.enter()
            p.loadFileRepresentation(forTypeIdentifier: type) { [weak self] url, err in
                defer { group.leave() }
                guard let self, let url, err == nil else { return }
                /* The URL handed in here is deleted the moment this
                   closure returns, so it has to be copied, not kept. */
                if let item = self.stash(url, suggested: p.suggestedName) {
                    lock.lock(); out.append(item); lock.unlock()
                }
            }
        }
        group.notify(queue: .main) { [weak self] in self?.finish(files: out) }
    }

    // MARK: - Camera

    private func presentCamera() {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            finish(files: []); return
        }
        let vc = UIImagePickerController()
        vc.sourceType = .camera
        vc.mediaTypes = [UTType.image.identifier, UTType.movie.identifier]
        vc.delegate = self
        bridge?.viewController?.present(vc, animated: true)
    }

    public func imagePickerController(_ picker: UIImagePickerController,
                                      didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)
        if let movie = info[.mediaURL] as? URL, let item = stash(movie, suggested: nil) {
            finish(files: [item]); return
        }
        if let img = info[.originalImage] as? UIImage,
           let data = img.jpegData(compressionQuality: 0.95),
           let item = write(data, ext: "jpg", mime: "image/jpeg") {
            finish(files: [item]); return
        }
        finish(files: [])
    }

    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        finish(files: [])
    }

    // MARK: - Handing the file to the web view

    private func stash(_ src: URL, suggested: String?) -> JSObject? {
        guard let data = try? Data(contentsOf: src) else { return nil }
        let ext = src.pathExtension.isEmpty ? "dat" : src.pathExtension
        let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        return write(data, ext: ext, mime: mime, name: suggested)
    }

    private func write(_ data: Data, ext: String, mime: String, name: String? = nil) -> JSObject? {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("picked", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("\(UUID().uuidString).\(ext)")
        guard (try? data.write(to: file)) != nil else { return nil }
        var o = JSObject()
        /* portablePath turns a file:// path into the capacitor:// URL the
           web view is allowed to fetch. Without it the web layer gets a
           path it cannot read and every pick comes back empty. */
        o["url"] = bridge?.portablePath(fromLocalURL: file)?.absoluteString ?? file.absoluteString
        o["name"] = name ?? file.lastPathComponent
        o["type"] = mime
        return o
    }

    /* Cancelling resolves with an empty list rather than rejecting: the
       user chose to cancel, which is not an error, and a rejection here
       would put a console warning behind an ordinary Back tap. */
    private func finish(files: [JSObject]) {
        let call = pending
        pending = nil
        call?.resolve(["files": files])
    }
}
