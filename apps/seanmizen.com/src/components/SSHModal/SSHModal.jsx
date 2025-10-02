import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import styles from "./SSHModal.module.css";

const SSHModal = ({ isOpen, onClose }) => {
  const [email, setEmail] = useState("");

  const sendSSHMutation = useMutation({
    mutationFn: async (email) => {
      const response = await fetch("http://localhost:3001/send-ssh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        throw new Error("Failed to send SSH details");
      }
      return response.json();
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    sendSSHMutation.mutate(email);
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <button className={styles.closeButton} onClick={onClose}>
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
              disabled={sendSSHMutation.isPending}
              className={styles.button}
            >
              {sendSSHMutation.isPending ? "Sending..." : "Send SSH Details"}
            </button>
          </form>

          {sendSSHMutation.isSuccess && (
            <p className={styles.success}>
              ✓ Request submitted! If your email is whitelisted, you'll receive
              connection details shortly.
            </p>
          )}

          {sendSSHMutation.isError && (
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
