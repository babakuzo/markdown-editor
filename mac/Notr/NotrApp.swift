// Notr: a native Mac shell around the Astryx editor.
//
// Native: windows, menus, Open/Save, autosave and Versions, Finder
// "Open With" and default-app handling (declared in Info.plist).
// Web (bundled, offline): the read view and the editor, built from
// @astryxdesign/core and @astryxdesign/richtext.
//
// The web build (`npm run build`, the `out/` folder) is copied into
// mac/web and bundled as a folder reference named "web". `make app`
// does all of this; see the README.

import SwiftUI
import UniformTypeIdentifiers

@main
struct NotrApp: App {
  var body: some Scene {
    DocumentGroup(newDocument: MarkdownDocument()) { file in
      EditorView(document: file.$document, fileName: file.fileURL?.lastPathComponent ?? "Untitled.md")
        .frame(minWidth: 720, minHeight: 520)
    }
  }
}

extension UTType {
  /// The system's Markdown type, declared by Daring Fireball and imported in Info.plist.
  static let markdown = UTType(importedAs: "net.daringfireball.markdown")
}

/// The file on disk. A value type, so undo and Versions work for free.
struct MarkdownDocument: FileDocument {
  static let readableContentTypes: [UTType] = [.markdown, .plainText]
  static let writableContentTypes: [UTType] = [.markdown]

  var text: String

  init(text: String = "# Untitled\n") {
    self.text = text
  }

  init(configuration: ReadConfiguration) throws {
    guard let data = configuration.file.regularFileContents else {
      throw CocoaError(.fileReadCorruptFile)
    }
    // Markdown files are UTF-8 in practice; fall back to Latin-1 rather than refusing to open.
    text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
  }

  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
    FileWrapper(regularFileWithContents: Data(text.utf8))
  }
}
