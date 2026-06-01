import { Crown } from 'lucide-react';

export default function PlusButton({ onClick }) {
  return (
    <button className="plus-btn" onClick={onClick} title="Cashy PLUS — próximamente">
      <span className="plus-badge">PLUS</span>
      <Crown size={18} />
    </button>
  );
}
