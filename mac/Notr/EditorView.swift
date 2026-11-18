import AppKit
import SwiftUI
import WebKit
import os

private let log = Logger(subsystem: "app.notr", category: "editor")

/// Hosts the bundled Astryx editor and keeps it in step with the document.
struct EditorView: NSViewRepresentable {
  @Binding var document: MarkdownDocument
  let fileName: String

  func makeCoordinator() -> Coordinator {
    Coordinator(document: $document)
  }

  func makeNSView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    let controller = config.userContentController
    controller.add(context.coordinator, name: "notr")
    // Mark the page as hosted before first paint, so the browser-only welcome
    // screen never flashes while the file is on its way.
    controller.addUserScript(WKUserScript(
      source: """
        (function mark() {
          if (document.documentElement) document.documentElement.classList.add('notr-native');
          else requestAnimationFrame(mark);
        })();
        """,
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true))

    let webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = context.coordinator
    webView.uiDelegate = context.coordinator
    webView.setValue(false, forKey: "drawsBackground") // no white flash before first paint
    if #available(macOS 13.3, *) {
      // Lets Safari's Web Inspector attach (Develop > this Mac > Notr) to debug the editor.
      webView.isInspectable = true
    }
    context.coordinator.push(name: fileName, markdown: document.text, to: webView)

    if let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
      webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
    } else {
      log.fault("Bundled web editor is missing from the app bundle")
    }
    return webView
  }

  /// The web view is the source of truth while editing. The document only
  /// changes underneath it when something native happened: Undo from the menu
  /// bar, Revert To, or the file changing on disk. Show that version.
  func updateNSView(_ webView: WKWebView, context: Context) {
    context.coordinator.push(name: fileName, markdown: document.text, to: webView)
  }

  static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
    webView.configuration.userContentController.removeScriptMessageHandler(forName: "notr")
  }

  @MainActor
  final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private let document: Binding<MarkdownDocument>
    /// What the page is showing, as far as the shell knows.
    private var shown: (name: String, markdown: String)?
    /// A file waiting for the page to finish loading.
    private var pending: (name: String, markdown: String)?
    private var isLoaded = false

    init(document: Binding<MarkdownDocument>) {
      self.document = document
    }

    /// Hand the page a file, unless it already shows exactly this.
    func push(name: String, markdown: String, to webView: WKWebView) {
      if let shown, shown.name == name, shown.markdown == markdown { return }
      shown = (name, markdown)
      guard isLoaded else {
        pending = (name, markdown)
        return
      }
      let payload: [String: String] = ["name": name, "folder": "", "markdown": markdown]
      webView.callAsyncJavaScript(
        // The page may still be hydrating when it finishes loading. If its
        // receiver isn't there yet, leave the file for it to pick up on mount.
        "if (window.notrOpen) { window.notrOpen(doc) } else { window.notrPending = doc }",
        arguments: ["doc": payload], in: nil, in: .page
      ) { result in
        if case .failure(let error) = result {
          log.error("Could not open the file in the editor: \(error.localizedDescription, privacy: .public)")
        }
      }
    }

    // MARK: Navigation

    /// Once the page has loaded, hand it the file.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
      isLoaded = true
      guard let pending else { return }
      self.pending = nil
      shown = nil
      push(name: pending.name, markdown: pending.markdown, to: webView)
    }

    /// If WebKit's content process dies, reload and hand the page the latest text.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
      log.error("The editor's web process ended; reloading")
      isLoaded = false
      pending = shown
      webView.reload()
    }

    /// Links in a document open in the default browser; the editor never navigates away.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
      guard navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url else {
        return .allow
      }
      if isSamePage(url, as: webView.url) { return .allow }
      openExternally(url)
      return .cancel
    }

    /// Links that ask for a new window (target="_blank") go to the default browser too.
    func webView(
      _ webView: WKWebView,
      createWebViewWith configuration: WKWebViewConfiguration,
      for navigationAction: WKNavigationAction,
      windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
      if let url = navigationAction.request.url { openExternally(url) }
      return nil
    }

    private func isSamePage(_ url: URL, as current: URL?) -> Bool {
      guard let current, url.fragment != nil else { return false }
      var a = URLComponents(url: url, resolvingAgainstBaseURL: false)
      var b = URLComponents(url: current, resolvingAgainstBaseURL: false)
      a?.fragment = nil
      b?.fragment = nil
      return a?.url == b?.url
    }

    private func openExternally(_ url: URL) {
      guard let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) else {
        log.info("Ignored a link the editor can't open: \(url.absoluteString, privacy: .public)")
        return
      }
      NSWorkspace.shared.open(url)
    }

    // MARK: Messages from the page

    /// `changed` on every edit (debounced), `save` on ⌘S.
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
      guard
        let body = message.body as? [String: Any],
        let type = body["type"] as? String,
        let markdown = body["markdown"] as? String
      else { return }

      // Writing the binding marks the document edited; DocumentGroup autosaves
      // it and keeps Versions. Record it as shown first so updateNSView doesn't
      // echo it back to the page.
      if let shown { self.shown = (shown.name, markdown) }
      if document.wrappedValue.text != markdown {
        document.wrappedValue.text = markdown
      }
      if type == "save" {
        // Let SwiftUI commit the new text before the window saves it.
        Task { @MainActor in
          NSApp.sendAction(#selector(NSDocument.save(_:)), to: nil, from: nil)
        }
      }
    }
  }
}
