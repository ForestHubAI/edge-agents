// Ambient types for the File System Access API's `showSaveFilePicker`, which TS
// does not ship in its default DOM lib. The app uses it for standalone "save to
// disk" (App.tsx). FileSystemFileHandle / createWritable() ARE in lib.dom, so we
// only augment the one missing piece on Window.
interface Window {
  showSaveFilePicker(options?: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }): Promise<FileSystemFileHandle>;
}
