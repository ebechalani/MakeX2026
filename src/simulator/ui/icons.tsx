/**
 * The small pictures on the simulator's buttons, drawn as inline SVG so that the page needs no
 * icon font and no pictures from the network. They are decoration: every button that uses one
 * also has a text or an aria-label.
 */
import type { ReactNode } from 'react';

interface IconProps {
  className?: string;
}

function Svg({ className = 'h-5 w-5', children, filled = false }: IconProps & { children: ReactNode; filled?: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const FlagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 21V4" />
    <path d="M5 4h11l-1.5 4L16 12H5z" fill="currentColor" />
  </Svg>
);

export const StopIcon = (p: IconProps) => (
  <Svg {...p} filled>
    <rect x="5" y="5" width="14" height="14" rx="2.5" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p} filled>
    <rect x="6" y="5" width="4.5" height="14" rx="1.2" />
    <rect x="13.5" y="5" width="4.5" height="14" rx="1.2" />
  </Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg {...p} filled>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
  </Svg>
);

export const RestartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
  </Svg>
);

export const FinishIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 21V4" />
    <path d="M5 4h14v9H5" />
    <path d="M9.7 4v9M14.3 4v9M5 8.5h14" />
  </Svg>
);

export const ResetIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4v6h6" />
    <path d="M20 20v-6h-6" />
    <path d="M20 10a8 8 0 0 0-14.5-3.5L4 10M4 14a8 8 0 0 0 14.5 3.5L20 14" />
  </Svg>
);

export const UndoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);

export const RedoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Svg>
);

export const NewFileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M12 12v6M9 15h6" />
  </Svg>
);

export const OpenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);

export const SaveIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14" />
  </Svg>
);

export const ExamplesIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.8 1 .9 1.7h5.4c.1-.7.4-1.3.9-1.7A6 6 0 0 0 12 3z" />
  </Svg>
);

export const ChevronIcon = ({ className = 'h-4 w-4', open = false }: IconProps & { open?: boolean }) => (
  <Svg className={`${className} transition-transform ${open ? 'rotate-90' : ''}`}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const DiceIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01" strokeWidth={2.6} />
  </Svg>
);

export const ZonesIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1.2" />
    <rect x="13" y="13" width="7" height="7" rx="1.2" strokeDasharray="2.5 2.5" />
    <path d="M13 7.5h7M7.5 13v7" />
  </Svg>
);

export const SensorsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20h.01" strokeWidth={3} />
    <path d="M8.5 16.5a5 5 0 0 1 7 0M5.5 13a9.5 9.5 0 0 1 13 0M2.5 9.5a14 14 0 0 1 19 0" />
  </Svg>
);

export const TrailIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="6" r="2" />
    <path d="M8 18h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7" strokeDasharray="1 3.4" />
  </Svg>
);

export const SoundIcon = ({ className, on = true }: IconProps & { on?: boolean }) => (
  <Svg className={className}>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor" />
    {on ? <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" /> : <path d="m16 9.5 5 5M21 9.5l-5 5" />}
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const RulesIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" />
    <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 8h6M9 12h6" />
  </Svg>
);

export const TestIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 3h5M10.5 3v6.2L5.3 18a2 2 0 0 0 1.7 3h10a2 2 0 0 0 1.7-3l-5.2-8.8V3" />
    <path d="M7.6 15h8.8" />
  </Svg>
);

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 11 8-7 8 7" />
    <path d="M6 9.5V20h12V9.5" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" strokeWidth={2.6} />
  </Svg>
);

export const CrossIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 7l10 10M17 7 7 17" strokeWidth={2.6} />
  </Svg>
);

export const RotateLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5v5h5" />
    <path d="M4.6 10A8 8 0 1 1 4 13" />
  </Svg>
);

export const RotateRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 5v5h-5" />
    <path d="M19.4 10A8 8 0 1 0 20 13" />
  </Svg>
);

export const CentreIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
  </Svg>
);

export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </Svg>
);
