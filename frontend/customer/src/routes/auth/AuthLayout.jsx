import { Link } from 'react-router-dom';
import './AuthLayout.css';

/**
 * The frame the four credential screens share — checklist 11.3.
 *
 * One heading, one lead line, the form, then one way onward. Nothing else: a
 * sign-in screen that offers six choices is a screen where nobody finds the
 * right one.
 */
export function AuthLayout({ title, lead, children, footer }) {
  return (
    <div className="auth">
      <header className="auth__head">
        <h1>{title}</h1>
        {lead ? <p className="muted">{lead}</p> : null}
      </header>

      {children}

      {footer ? <footer className="auth__foot">{footer}</footer> : null}
    </div>
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
