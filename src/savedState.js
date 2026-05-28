export function extractStateFromPayload(saved, { defaultStatusQuo, defaultNyBolig, emptyForm }) {
  if (!saved) {
    return null;
  }

  const result = {};

  if (saved.activeTab === "flytt" || saved.activeTab === "boformer") {
    result.activeTab = saved.activeTab;
  }

  if (saved.statusQuo) {
    const sq = { ...defaultStatusQuo, ...saved.statusQuo };
    if (sq.aarBodd != null && !sq.overtakelsesdato) {
      const approx = new Date();
      approx.setFullYear(approx.getFullYear() - Math.round(sq.aarBodd));
      sq.overtakelsesdato = approx.toISOString().slice(0, 10);
      delete sq.aarBodd;
    }
    result.statusQuo = sq;
  }

  if (saved.nyBolig) {
    result.nyBolig = { ...defaultNyBolig, ...saved.nyBolig };
  }

  if (Array.isArray(saved.forms) && saved.forms.length > 0) {
    result.forms = saved.forms.map((form) => ({ ...emptyForm, ...form, id: form.id }));
  }

  if (saved.nextId) {
    result.nextId = saved.nextId;
  }

  result.savedAt = saved.savedAt ?? null;
  return result;
}
