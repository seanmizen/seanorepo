import type { ChangeEvent, FC, FormEvent, KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import styles from './ssh-modal.module.css';

const SITE_BASE_URL =
  process.env.NODE_ENV === 'development'
    ? 'http://localhost:4120'
    : 'https://seanmizen.com/tcp';

interface SSHModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SSHModal: FC<SSHModalProps> = ({ isOpen, onClose }) => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isError, setIsError] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, input, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setIsSuccess(false);
    setIsError(false);

    try {
      const response = await fetch(`${SITE_BASE_URL}/send-ssh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error('Failed to send SSH details');
      await response.json();
      setIsSuccess(true);
    } catch {
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackdropKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ssh-modal-title"
      ref={modalRef}
    >
      <button
        type="button"
        className={styles.backdropButton}
        onClick={onClose}
        onKeyDown={handleBackdropKeyDown}
        aria-label="Close modal"
        tabIndex={-1}
      />
      <div className={styles.modal}>
        <button
          type="button"
          ref={closeButtonRef}
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close SSH modal"
        >
          ✕
        </button>

        <h2 id="ssh-modal-title">SSH Access</h2>

        <div className={styles.content}>
          <p>
            If your email address is whitelisted, we'll send you SSH connection
            instructions.
          </p>
          <form onSubmit={handleSubmit}>
            <label htmlFor="ssh-email" className="sr-only">
              Email address
            </label>
            <input
              id="ssh-email"
              type="email"
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setEmail(e.target.value)
              }
              placeholder="your@email.com"
              required
              className={styles.input}
              aria-describedby={isError ? 'ssh-error' : undefined}
            />
            <button
              type="submit"
              disabled={isLoading}
              className={styles.button}
            >
              {isLoading ? 'Sending...' : 'Send SSH Details'}
            </button>
          </form>

          {isSuccess && (
            <output className={styles.success}>
              ✓ Request submitted! If your email is whitelisted, you'll receive
              connection details shortly.
            </output>
          )}

          {isError && (
            <p id="ssh-error" className={styles.error} role="alert">
              Failed to send SSH details. Please try again.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export { SSHModal };
