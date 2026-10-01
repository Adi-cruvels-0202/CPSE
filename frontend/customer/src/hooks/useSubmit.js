import { useCallback, useState } from 'react';
import { ApiError } from '../lib/api.js';

/**
 * Everything a form does around its own submit, in one place.
 *
 * Every screen in Phase 11 needs the same four things and would otherwise
 * re-implement them slightly differently:
 *
 *   pending      to disable the button, so a double tap cannot place two orders
 *                or create two accounts (checklist 11.17)
 *   fieldErrors  a 422's issues, keyed by field, to render under the input
 *   error        the one message that is not about a single field
 *   reset        clearing both when the customer starts typing again
 *
 * The server's wording is used as-is. `ApiError.message` is written for the
 * customer (backend docs/API.md), so re-phrasing it here would mean two copies
 * of the same sentence drifting apart.
 */
export function useSubmit(action, { onSuccess } = {}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const reset = useCallback(() => {
    setError(null);
    setFieldErrors({});
  }, []);

  const submit = useCallback(
    async (...args) => {
      // Guards the window between the first click and the button disabling.
      if (pending) return undefined;

      setPending(true);
      setError(null);
      setFieldErrors({});

      try {
        const result = await action(...args);
        onSuccess?.(result);
        return result;
      } catch (caught) {
        if (caught instanceof ApiError) {
          const fields = caught.fieldErrors;
          setFieldErrors(fields);
          // A 422 whose issues are all field-level is fully explained by the
          // inputs; a banner repeating "the request did not pass validation"
          // adds nothing. Anything else needs saying out loud.
          if (!caught.isValidation || Object.keys(fields).length === 0) setError(caught);
        } else {
          setError(caught);
        }
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [action, onSuccess, pending],
  );

  return { submit, pending, error, fieldErrors, reset, setError };
}
