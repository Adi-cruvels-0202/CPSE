import { useState } from 'react';
import './RemoteImage.css';

/**
 * An image from a URL we do not control, with what to show when it does not load.
 *
 * This is not defensive padding: the seeded catalogue points at
 * `images.cpse.local`, which resolves nowhere, and a merchant's real URL will
 * rot eventually too. A grid of broken-image icons is the difference between a
 * shop that looks unfinished and one that looks fine without photos.
 *
 * The fallback is the name's initials on a tinted block — recognisable, and it
 * keeps the layout from shifting when an image fails.
 */
export function RemoteImage({ src, alt, name, ratio = '1 / 1', className = '', rounded }) {
  const [failed, setFailed] = useState(false);
  const showFallback = !src || failed;

  return (
    <div
      className={`remote-image ${className}`.trim()}
      style={{ aspectRatio: ratio, borderRadius: rounded }}
    >
      {showFallback ? (
        <span className="remote-image__fallback" role="img" aria-label={alt ?? name ?? ''}>
          {initialsOf(name ?? alt)}
        </span>
      ) : (
        <img
          src={src}
          alt={alt ?? ''}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

/** "Sharma Kirana Store" → "SK". Two letters is what fits legibly. */
export function initialsOf(name) {
  if (!name) return '?';

  const words = String(name)
    .trim()
    .split(/\s+/)
    .filter((word) => /[a-z0-9]/i.test(word));

  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
