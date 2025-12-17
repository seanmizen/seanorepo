import { useCallback, useEffect, useRef } from 'react';

type SequenceCallback = (sequence: string) => void;
type Sequences = Record<string, SequenceCallback>;

export const useKeySequence = (
  sequences: Sequences = {},
  debounceMs = 2000,
): string => {
  const sequenceRef = useRef('');
  const timeoutRef = useRef<number | null>(null);

  const clearSequence = useCallback(() => {
    sequenceRef.current = '';
  }, []);

  const resetTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(clearSequence, debounceMs);
  }, [clearSequence, debounceMs]);

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      if (event.key.length === 1) {
        sequenceRef.current += event.key.toLowerCase();

        Object.entries(sequences).forEach(([sequence, callback]) => {
          if (sequenceRef.current.includes(sequence.toLowerCase())) {
            callback(sequence);
            clearSequence();
            return;
          }
        });

        resetTimeout();
      }
    };

    window.addEventListener('keypress', handleKeyPress);

    return () => {
      window.removeEventListener('keypress', handleKeyPress);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [sequences, resetTimeout, clearSequence]);

  return sequenceRef.current;
};
