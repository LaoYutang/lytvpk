export function normalizePanelUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return `http://${value}`;
}
