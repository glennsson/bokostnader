/** Estimert årlig verdistigning (%) – forenklet, justerbar av bruker. */
export const KOMMUNER = [
  { key: "oslo", label: "Oslo", verdistigningAarlig: 5.5 },
  { key: "baerum", label: "Bærum", verdistigningAarlig: 5.0 },
  { key: "asker", label: "Asker", verdistigningAarlig: 4.8 },
  { key: "nordre-follo", label: "Nordre Follo", verdistigningAarlig: 4.8 },
  { key: "bergen", label: "Bergen", verdistigningAarlig: 4.5 },
  { key: "stavanger", label: "Stavanger", verdistigningAarlig: 4.0 },
  { key: "trondheim", label: "Trondheim", verdistigningAarlig: 4.0 },
  { key: "kristiansand", label: "Kristiansand", verdistigningAarlig: 3.8 },
  { key: "drammen", label: "Drammen", verdistigningAarlig: 4.2 },
  { key: "fredrikstad", label: "Fredrikstad", verdistigningAarlig: 3.5 },
  { key: "tromso", label: "Tromsø", verdistigningAarlig: 3.0 },
  { key: "annet", label: "Annet (norsk snitt)", verdistigningAarlig: 3.5 },
];

export function getKommuneRate(kommuneKey) {
  const match = KOMMUNER.find((item) => item.key === kommuneKey);
  return match?.verdistigningAarlig ?? 3.5;
}

/**
 * Estimerer boligverdi i dag ut fra kjøpspris, år eid, årlig verdistigning og kvm.
 * Kvm gir en liten ekstra justering (større boliger har ofte sterkere pris per kvm over tid).
 */
export function estimateBoligverdi({ kjopspris, aarBodd, verdistigningAarlig, boarealKvm }) {
  if (kjopspris <= 0) {
    return 0;
  }

  const years = Math.max(0, aarBodd);
  const rate = verdistigningAarlig / 100;
  let estimated = kjopspris * (1 + rate) ** years;

  if (boarealKvm > 0) {
    const kvmBonus = 1 + Math.min(years * 0.004, 0.12);
    estimated *= kvmBonus;
  }

  return Math.round(estimated);
}

export function calculateVerdistigning(kjopspris, verdiIDag) {
  const diff = verdiIDag - kjopspris;
  const prosent = kjopspris > 0 ? (diff / kjopspris) * 100 : 0;
  return { diff, prosent };
}
