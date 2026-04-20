import { motion, type MotionProps } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';

type ModernCardTone = 'default' | 'success' | 'warning' | 'danger' | 'glass';

interface ModernCardProps extends MotionProps {
  children: ReactNode;
  interactive?: boolean;
  tone?: ModernCardTone;
  className?: string;
  style?: CSSProperties;
}

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export default function ModernCard({
  children,
  className,
  interactive = false,
  tone = 'default',
  whileHover,
  whileTap,
  transition,
  ...props
}: ModernCardProps) {
  return (
    <motion.div
      className={joinClassNames(
        'modern-card',
        interactive && 'modern-card-interactive',
        tone === 'success' && 'modern-card-success',
        tone === 'warning' && 'modern-card-warning',
        tone === 'danger' && 'modern-card-danger',
        tone === 'glass' && 'modern-card-glass',
        className,
      )}
      whileHover={interactive ? whileHover ?? { y: -2, scale: 1.01 } : whileHover}
      whileTap={interactive ? whileTap ?? { scale: 0.995 } : whileTap}
      transition={transition ?? { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
