import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import './AuthLayout.css';

/**
 * The frame the four credential screens share — checklist 11.3.
 *
 * One heading, one lead line, the form, then one way onward. Nothing else: a
 * sign-in screen that offers six choices is a screen where nobody finds the
 * right one.
 */
export function AuthLayout({ title, lead, children, footer }) {
  const reduceMotion = useReducedMotion() ?? false;
  const enter = reduceMotion
    ? { opacity: 0 }
    : { opacity: 0, transform: 'translateY(0.65rem)' };
  const settle = reduceMotion
    ? { opacity: 1 }
    : { opacity: 1, transform: 'translateY(0px)' };
  const sequence = {
    hidden: {},
    visible: {
      transition: reduceMotion
        ? { staggerChildren: 0 }
        : { delayChildren: 0.02, staggerChildren: 0.065 },
    },
  };
  const item = {
    hidden: enter,
    visible: {
      ...settle,
      transition: {
        duration: reduceMotion ? 0.12 : 0.22,
        ease: [0.23, 1, 0.32, 1],
      },
    },
  };

  return (
    <motion.div className="auth" variants={sequence} initial="hidden" animate="visible">
      <motion.header className="auth__head" variants={item}>
        <h1>{title}</h1>
        {lead ? <p className="muted">{lead}</p> : null}
      </motion.header>

      <motion.div className="auth__content" variants={item}>
        {children}
      </motion.div>

      {footer ? <motion.footer className="auth__foot" variants={item}>{footer}</motion.footer> : null}
    </motion.div>
  );
}

/** "Already have an account? Sign in" — the same shape on every screen. */
export function AuthSwitch({ question, to, action }) {
  return (
    <p className="auth__switch">
      {question}{' '}
      <Link to={to} className="auth__link">
        {action}
      </Link>
    </p>
  );
}
