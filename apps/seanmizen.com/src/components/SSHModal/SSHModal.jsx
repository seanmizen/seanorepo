import { useEffect, useRef, useState } from 'react';
import styles from './SSHModal.module.css';

const SITE_BASE_URL =
  process.env.NODE_ENV === 'development'
    ? 'http://localhost:4120'
    : 'https://seanmizen.com/tcp';

const SSHModal = ({ isOpen, onClose }) => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isError, setIsError] = useState(false);
  const focusRef = useRef(null);

  useEffect(() => {
    if (isOpen && focusRef.current) {
      focusRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleEscKey = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleEscKey);
    }

    return () => {
      window.removeEventListener('keydown', handleEscKey);
    };
  }, [isOpen, onClose]);

  const handleSubmit = async (e) => {
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
      if (!response.ok) {
        throw new Error('Failed to send SSH details');
      }
      await response.json();
      setIsSuccess(true);
    } catch (_error) {
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={styles.backdrop}>
      <button
        type="button"
        className={styles.backdropButton}
        onClick={onClose}
        aria-label="Close modal"
      />
      <div className={styles.modal}>
        <button
          type="button"
          ref={focusRef}
          className={styles.closeButton}
          onClick={onClose}
        >
          x
        </button>

        <h2>SSH Access</h2>

        <div className={styles.content}>
          <p>
            If your email address is whitelisted, we'll send you SSH connection
            instructions.
          </p>
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className={styles.input}
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
            <p className={styles.success}>
              ✓ Request submitted! If your email is whitelisted, you'll receive
              connection details shortly.
            </p>
          )}

          {isError && (
            <p className={styles.error}>
              Failed to send SSH details. Please try again.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SSHModal;
