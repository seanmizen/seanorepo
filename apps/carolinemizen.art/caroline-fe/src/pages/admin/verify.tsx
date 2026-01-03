import { type FC, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useAuth } from '@/contexts/auth-context';

const Container = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: #fafafa;
`;

const Card = styled.div`
  background: white;
  padding: 3rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 400px;
  text-align: center;
`;

const Title = styled.h1`
  margin: 0 0 1rem;
  font-size: 1.75rem;
  color: #333;
`;

const Message = styled.p<{ type: 'info' | 'error' | 'success' }>`
  color: ${(props) =>
    props.type === 'error'
      ? '#721c24'
      : props.type === 'success'
        ? '#155724'
        : '#666'};
`;

const Spinner = styled.div`
  border: 3px solid #f3f3f3;
  border-top: 3px solid #333;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
  margin: 1rem auto;

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
`;

export const AdminVerify: FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>(
    'verifying',
  );
  const [errorMessage, setErrorMessage] = useState('');
  const hasAttemptedVerification = useRef(false);

  useEffect(() => {
    // Guard: only verify once
    if (hasAttemptedVerification.current) return;

    const token = searchParams.get('token');

    if (!token) {
      setStatus('error');
      setErrorMessage('No token provided');
      return;
    }

    hasAttemptedVerification.current = true;

    const verifyToken = async () => {
      try {
        await login(token);
        setStatus('success');
        // Navigate after successful login
        navigate('/admin/dashboard', { replace: true });
      } catch (_error) {
        setStatus('error');
        setErrorMessage(
          'Invalid or expired token. Please request a new magic link.',
        );
      }
    };

    verifyToken();
  }, [searchParams, login, navigate]);

  return (
    <Container>
      <Card>
        {status === 'verifying' && (
          <>
            <Title>Verifying...</Title>
            <Spinner />
            <Message type="info">
              Please wait while we verify your magic link.
            </Message>
          </>
        )}

        {status === 'error' && (
          <>
            <Title>Verification Failed</Title>
            <Message type="error">{errorMessage}</Message>
            <button
              type="button"
              onClick={() => {
                window.location.href = '/admin/login';
              }}
              style={{
                marginTop: '1rem',
                padding: '0.75rem 1.5rem',
                background: '#667eea',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: 'bold',
              }}
            >
              Request New Magic Link
            </button>
          </>
        )}

        {status === 'success' && (
          <>
            <Title>Success!</Title>
            <Message type="success">Redirecting to admin dashboard...</Message>
          </>
        )}
      </Card>
    </Container>
  );
};
