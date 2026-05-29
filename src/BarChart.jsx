import React, { useId, useMemo } from "react";

function defaultFormat(value) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function clampPercent(value, max) {
  if (!max || max <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (value / max) * 100));
}

/**
 * Enkle vertikale søylediagrammer med ren CSS (ingen chart-bibliotek).
 */
export default function BarChart({
  title,
  subtitle,
  items = [],
  formatValue = defaultFormat,
  maxValue: maxValueProp,
  showLegend = true,
  emptyMessage = "Ingen tall å vise ennå.",
}) {
  const legendId = useId();

  const maxValue = useMemo(() => {
    if (maxValueProp != null && maxValueProp > 0) {
      return maxValueProp;
    }
    const values = items.map((item) => item.value ?? 0);
    return values.length ? Math.max(...values) : 0;
  }, [items, maxValueProp]);

  const hasSegments = items.some((item) => item.segments?.length > 0);

  if (items.length === 0) {
    return (
      <figure className="bar-chart bar-chart--empty">
        {title ? <figcaption className="bar-chart-title">{title}</figcaption> : null}
        <p className="bar-chart-empty">{emptyMessage}</p>
      </figure>
    );
  }

  return (
    <figure className="bar-chart" aria-labelledby={title ? legendId : undefined}>
      {title ? (
        <figcaption id={legendId} className="bar-chart-title">
          {title}
          {subtitle ? <span className="bar-chart-subtitle">{subtitle}</span> : null}
        </figcaption>
      ) : null}

      <div
        className="bar-chart-columns"
        role="list"
        aria-label={title ?? "Søylediagram"}
      >
        {items.map((item) => {
          const value = item.value ?? 0;
          const heightPct = clampPercent(value, maxValue);
          const displayHeight = value > 0 && heightPct < 4 ? 4 : heightPct;

          return (
            <div
              key={item.id ?? item.label}
              role="listitem"
              className={`bar-chart-col${item.highlight ? " bar-chart-col--highlight" : ""}`}
            >
              <div className="bar-chart-value-top">{formatValue(value)}</div>
              <div
                className="bar-chart-bar-track"
                title={`${item.label}: ${formatValue(value)}`}
              >
                {hasSegments && item.segments?.length ? (
                  <div
                    className="bar-chart-bar bar-chart-bar--stacked"
                    style={{ height: `${displayHeight}%` }}
                  >
                    {item.segments.map((segment) => {
                      const segHeight =
                        value > 0
                          ? clampPercent(segment.value ?? 0, value)
                          : 0;
                      return (
                        <div
                          key={segment.key ?? segment.label}
                          className={`bar-chart-segment bar-chart-segment--${segment.variant ?? "default"}`}
                          style={{ height: `${segHeight}%` }}
                          title={`${segment.label}: ${formatValue(segment.value)}`}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div
                    className="bar-chart-bar bar-chart-bar--single"
                    style={{ height: `${displayHeight}%` }}
                  />
                )}
              </div>
              <div className="bar-chart-label">{item.label}</div>
            </div>
          );
        })}
      </div>

      {showLegend && hasSegments ? (
        <ul className="bar-chart-legend" aria-hidden="true">
          <li>
            <span className="bar-chart-legend-swatch bar-chart-segment--loan" />
            Lån
          </li>
          <li>
            <span className="bar-chart-legend-swatch bar-chart-segment--operating" />
            Drift, felleskostnader m.m.
          </li>
        </ul>
      ) : null}
    </figure>
  );
}

export function monthlyCostChartItem(result, { highlight = false } = {}) {
  const totals = result.totals ?? result;
  const monthlyTotal = totals.monthlyTotal ?? 0;
  const monthlyLoan = totals.monthlyLoanCost ?? 0;
  const operating = Math.max(0, monthlyTotal - monthlyLoan);

  return {
    id: result.id,
    label: result.adresse?.trim() || result.name || "Ukjent",
    value: monthlyTotal,
    highlight,
    segments: [
      { key: "loan", label: "Lån", value: monthlyLoan, variant: "loan" },
      {
        key: "operating",
        label: "Drift m.m.",
        value: operating,
        variant: "operating",
      },
    ],
  };
}
