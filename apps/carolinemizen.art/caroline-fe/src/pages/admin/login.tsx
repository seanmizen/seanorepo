import { type FC, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import styled from 'styled-components';
import { useAuth } from '../../contexts/auth-context';

const OuterContainer = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: #fafafa;
  min-height: 100vh;
`;

const Container = styled.div`
  width: fit-content;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 2rem;
`;

const Card = styled.div`
  background: white;
  padding: 3rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  min-width: 380px;
`;

const Title = styled.h1`
  margin: 0 0 0.5rem;
  font-size: 1.75rem;
  color: #333;
`;

const Subtitle = styled.p`
  margin: 0 0 1rem;
  color: #666;
  font-size: 0.95rem;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const Label = styled.label`
  font-size: 0.9rem;
  color: #555;
  margin-bottom: 0.25rem;
`;

const Input = styled.input`
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  flex: 1;

  &:focus {
    outline: none;
    border-color: #666;
  }
`;

const Button = styled.button`
  padding: 0.75rem;
  background: #333;
  color: white;
  border: 2px solid transparent;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;

  transition:
    box-shadow 120ms ease,
    transform 120ms ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transform: translateY(-1px);
  }

  &:active {
    box-shadow: none;
    transform: translateY(0);
  }

  &:disabled {
    background: #ccc;
    cursor: not-allowed;
    box-shadow: none;
    transform: none;
  }
`;

const EmailBox = styled.div`
  display: flex;
  flex-direction: row;
  gap: 1rem;
  justify-content: space-between;
  align-items: center;
`;
/* margin-bottom: 1rem; */

const Message = styled.div<{ type: 'success' | 'error' }>`
  margin-top: 1rem;
  padding: 0.75rem;
  border-radius: 4px;
  font-size: 0.9rem;
  background: ${(props) => (props.type === 'success' ? '#d4edda' : '#f8d7da')};
  color: ${(props) => (props.type === 'success' ? '#155724' : '#721c24')};
  border: 1px solid
    ${(props) => (props.type === 'success' ? '#c3e6cb' : '#f5c6cb')};
`;

const API_URL = import.meta.env.API_URL;

export const AdminLogin: FC = () => {
  const { user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Redirect to dashboard if already logged in
  if (!authLoading && user) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_URL}/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        credentials: 'include', // Important for bypassed auth to set cookie
      });

      if (!response.ok) {
        throw new Error('Failed to send magic link');
      }

      const data = await response.json();

      // Check if email was bypassed (development mode)
      if (data.user) {
        // Email bypass mode - authenticated directly, redirect to dashboard
        window.location.href = '/admin/dashboard';
        return;
      }

      // Normal mode - email sent
      setMessage({
        type: 'success',
        text: 'Check your email for the magic link!',
      });
      setEmail('');
    } catch (_error) {
      setMessage({
        type: 'error',
        text: 'Failed to send magic link. Please try again.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <OuterContainer>
      <Container>
        <Link to="/">← Back to Home</Link>
        <Card>
          <Title>Admin Login</Title>
          <Subtitle>Enter your email to receive a magic link.</Subtitle>

          <Form onSubmit={handleSubmit}>
            <EmailBox>
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
                disabled={loading}
              />
            </EmailBox>

            <Button type="submit" disabled={loading}>
              {loading ? 'Sending...' : 'Send Magic Link'}
            </Button>
          </Form>
          {message && <Message type={message.type}>{message.text}</Message>}
        </Card>
      </Container>
    </OuterContainer>
  );
};
