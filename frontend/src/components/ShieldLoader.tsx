import StatusShield from './StatusShield';

/**
 * The one loading state in the app: the shield scanning, with a line saying
 * what is being loaded. `inline` is the small version for menus and lists.
 */
export default function ShieldLoader({ label, inline = false }: { label: string; inline?: boolean }) {
  return (
    <div className={`shield-loader${inline ? ' is-inline' : ''}`} role="status">
      <StatusShield state="scanning" size={inline ? 48 : 64} />
      <span>{label}</span>
    </div>
  );
}
