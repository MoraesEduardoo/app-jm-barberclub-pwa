'use client';

export function FormField({ label, children }) {
  return (
    <label className="block mb-4">
      <span className="block text-xs font-medium text-zinc-400 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export function TextInput(props) {
  return (
    <input
      {...props}
      className={`w-full h-12 rounded-lg bg-elevated border border-zinc-700 px-3.5 text-base text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent touch-manipulation ${
        props.className || ''
      }`}
    />
  );
}

export function PrimaryButton({ children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={`w-full h-12 rounded-lg bg-accent text-white font-semibold text-base shadow-accent-glow active:scale-[0.98] active:bg-accent-dark disabled:opacity-50 disabled:shadow-none transition-all touch-manipulation select-none ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={`w-full h-12 rounded-lg border border-zinc-700 text-zinc-300 text-base font-medium active:scale-[0.98] active:bg-zinc-900 transition-all touch-manipulation select-none ${className}`}
    >
      {children}
    </button>
  );
}
