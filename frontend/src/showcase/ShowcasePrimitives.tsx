import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Icon, { type IconName } from './Icon';

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

export function Reveal({ children, className = '', delay = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -9% 0px', threshold: 0.08 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? 'is-visible' : ''} ${className}`}
      style={{ '--reveal-delay': `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  number,
  eyebrow,
  title,
  children,
  align = 'left',
}: {
  number: string;
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  align?: 'left' | 'center';
}) {
  return (
    <div className={`section-heading section-heading-${align}`}>
      <div className="section-index"><span>{number}</span><i /></div>
      <div>
        <div className="section-eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
      </div>
      {children && <p>{children}</p>}
    </div>
  );
}

export function StatusPill({ children, tone = 'cyan', icon }: { children: ReactNode; tone?: 'cyan' | 'green' | 'amber' | 'red'; icon?: IconName }) {
  return (
    <span className={`status-pill status-pill-${tone}`}>
      {icon ? <Icon name={icon} size={13} /> : <b className="status-dot" />}
      {children}
    </span>
  );
}

export function NumberedLabel({ number, children }: { number: string; children: ReactNode }) {
  return <div className="numbered-label"><span>{number}</span>{children}</div>;
}

export function ArrowLink({ children, href = '#', onClick }: { children: ReactNode; href?: string; onClick?: () => void }) {
  return (
    <a className="arrow-link" href={href} onClick={onClick}>
      <span>{children}</span><Icon name="arrow" size={16} />
    </a>
  );
}

export function DataTag({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'forecast' | 'sim' | 'real' }) {
  return <span className={`data-tag data-tag-${tone}`}>{children}</span>;
}
