export type View = "wiki" | "context" | "knowledge" | "settings";

export function normalizeView(raw: unknown): View {
  if (raw === "wiki") return "wiki";
  if (raw === "context") return "context";
  if (raw === "knowledge") return "knowledge";
  if (raw === "settings") return "settings";
  return "wiki";
}
