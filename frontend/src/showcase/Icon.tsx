export type IconName =
  | 'arrow'
  | 'chevron'
  | 'close'
  | 'compass'
  | 'grid'
  | 'layers'
  | 'menu'
  | 'pause'
  | 'play'
  | 'plus'
  | 'route'
  | 'ship'
  | 'spark'
  | 'target'
  | 'terminal'
  | 'waves';

type IconProps = {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
};

export default function Icon({ name, size = 18, strokeWidth = 1.5, className }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };

  switch (name) {
    case 'arrow':
      return <svg {...common}><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></svg>;
    case 'chevron':
      return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
    case 'close':
      return <svg {...common}><path d="M6 6l12 12M18 6 6 18" /></svg>;
    case 'compass':
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M14.8 9.2 13 13l-3.8 1.8L11 11z" /><path d="M12 3.5v1.8M12 18.7v1.8" /></svg>;
    case 'grid':
      return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>;
    case 'layers':
      return <svg {...common}><path d="m12 4 8 4-8 4-8-4z" /><path d="m4 12 8 4 8-4" /><path d="m4 16 8 4 8-4" /></svg>;
    case 'menu':
      return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
    case 'pause':
      return <svg {...common}><path d="M9 5v14M15 5v14" /></svg>;
    case 'play':
      return <svg {...common} fill="currentColor" stroke="none"><path d="m8 5 11 7-11 7z" /></svg>;
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case 'route':
      return <svg {...common}><path d="M5 18c4-1.5 3-7 6.5-8.5S17 5 19 4" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="4" r="2" /></svg>;
    case 'ship':
      return <svg {...common}><path d="M4 15h16l-2 4H6z" /><path d="M12 15V6M8 10h8l-4-4z" /><path d="M5 21c1.5-1 2.8-1 4.3 0 1.5-1 2.9-1 4.4 0 1.5-1 2.8-1 4.3 0" /></svg>;
    case 'spark':
      return <svg {...common}><path d="m12 3 1.4 6.6L20 12l-6.6 1.4L12 20l-1.4-6.6L4 12l6.6-2.4z" /></svg>;
    case 'target':
      return <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2" /></svg>;
    case 'terminal':
      return <svg {...common}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>;
    case 'waves':
      return <svg {...common}><path d="M3 9c2.5-2 4.5-2 7 0s4.5 2 7 0c1.3-1 2.5-1.3 4-.7" /><path d="M3 15c2.5-2 4.5-2 7 0s4.5 2 7 0c1.3-1 2.5-1.3 4-.7" /></svg>;
    default:
      return null;
  }
}
