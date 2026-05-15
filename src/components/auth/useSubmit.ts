import { useState, type FormEvent } from "react";

/** Convenience submit handler that runs an async fn, surfacing errors via setError. */
export function useSubmit(
  fn: () => Promise<void>,
  setError: (e: string | null) => void,
): { submitting: boolean; onSubmit: (e: FormEvent) => void } {
  const [submitting, setSubmitting] = useState(false);
  return {
    submitting,
    onSubmit: (e: FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setError(null);
      setSubmitting(true);
      fn()
        .catch((err: Error) => setError(err.message))
        .finally(() => setSubmitting(false));
    },
  };
}
