import React from "react";

function formatKr(value) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

/**
 * Likviditetsbudsjett over tid – netto kontantstrøm per år inkl. vedlikeholdstopp.
 */
export default function CashFlowChart({ scenario, title = "Likviditetsbudsjett (10 år)" }) {
  if (!scenario?.rows?.length) {
    return null;
  }

  const maxAbs = scenario.maxAbs || 1;

  return (
    <figure className="cashflow-chart" aria-label={title}>
      <figcaption className="bar-chart-title">
        {title}
        <span className="bar-chart-subtitle">
          Inkl. inflasjon på drift, rentefradrag 22 % og planlagte TG-tiltak
        </span>
      </figcaption>

      <div className="cashflow-columns">
        {scenario.rows.map((row) => {
          const heightPct = Math.min(100, (Math.abs(row.netto) / maxAbs) * 100);
          const displayHeight = row.netto !== 0 && heightPct < 6 ? 6 : heightPct;
          const isNegative = row.netto < 0;

          return (
            <div key={row.year} className="cashflow-col">
              <div className="bar-chart-value-top">{formatKr(row.netto)}</div>
              <div className="bar-chart-bar-track cashflow-track">
                <div
                  className={`cashflow-bar ${isNegative ? "cashflow-bar--negative" : "cashflow-bar--positive"}`}
                  style={{ height: `${displayHeight}%` }}
                  title={`År ${row.year}: drift ${formatKr(row.drift)}, vedlikehold ${formatKr(row.vedlikehold)}`}
                />
              </div>
              <div className="bar-chart-label">{row.label}</div>
              {row.vedlikehold > 0 ? (
                <div className="cashflow-maint-tag">+{formatKr(row.vedlikehold)}</div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="hint cashflow-foot">
        Kumulativ kontantstrøm etter {scenario.years} år:{" "}
        <strong>{formatKr(scenario.rows[scenario.rows.length - 1]?.kumulativ)}</strong>
        {scenario.umiddelbarKapital > 0 ? (
          <>
            {" "}
            · Umiddelbart kapitalbehov (TG3):{" "}
            <strong>{formatKr(scenario.umiddelbarKapital)}</strong>
          </>
        ) : null}
      </p>
    </figure>
  );
}
