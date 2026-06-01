export default function MetricCard({ label, value, subtitle, variant = 'default' }) {
  return (
    <div className={`metric-card metric-${variant}`}>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      {subtitle && <p className="metric-sub">{subtitle}</p>}
    </div>
  );
}
