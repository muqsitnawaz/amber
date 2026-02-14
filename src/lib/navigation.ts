export type View = "context" | "knowledge" | "settings";

export function normalizeView(raw: unknown): View {
  if (raw === "knowledge") return "knowledge";
  if (raw === "settings") return "settings";
  return "context";
}
