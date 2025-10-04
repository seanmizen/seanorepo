import { useEffect, useRef, useCallback } from "react";

/**
 * A hook that listens to keypress sequences and triggers callbacks
 * @param {Object} sequences - Object mapping sequences to callback functions
 * @param {number} debounceMs - Milliseconds of inactivity before clearing sequence (default: 2000)
 * @returns {string} - Current key sequence
 */
export const useKeySequence = (sequences = {}, debounceMs = 2000) => {
  const sequenceRef = useRef("");
  const timeoutRef = useRef(null);

  const clearSequence = useCallback(() => {
    sequenceRef.current = "";
  }, []);

  const resetTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(clearSequence, debounceMs);
  }, [clearSequence, debounceMs]);

  useEffect(() => {
    const handleKeyPress = (event) => {
      // Ignore keypresses in input fields, textareas, etc.
      if (
        event.target.tagName === "INPUT" ||
        event.target.tagName === "TEXTAREA" ||
        event.target.isContentEditable
      ) {
        return;
      }

      // Only capture single character keys
      if (event.key.length === 1) {
        sequenceRef.current += event.key.toLowerCase();

        // Check if any registered sequence matches
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

    window.addEventListener("keypress", handleKeyPress);

    return () => {
      window.removeEventListener("keypress", handleKeyPress);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [sequences, resetTimeout, clearSequence]);

  return sequenceRef.current;
};
