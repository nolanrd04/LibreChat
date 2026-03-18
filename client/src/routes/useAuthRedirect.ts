import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthContext } from '~/hooks';

const PENDING_INSERT_STORAGE_KEY = 'prompthub_pending_insert';

export default function useAuthRedirect() {
  const { user, isAuthenticated } = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!isAuthenticated) {
        try {
          const params = new URLSearchParams(location.search);
          const insertTicket = params.get('insertTicket');
          if (insertTicket) {
            const submit = params.get('submit')?.toLowerCase() === 'true' ? 'true' : 'false';
            localStorage.setItem(
              PENDING_INSERT_STORAGE_KEY,
              JSON.stringify({ ticketId: insertTicket, submit }),
            );
          }
        } catch (_error) {
          // Ignore query parsing/localStorage failures and continue with login redirect.
        }

        navigate('/login', { replace: true });
      }
    }, 300);

    return () => {
      clearTimeout(timeout);
    };
  }, [isAuthenticated, navigate, location.search]);

  return {
    user,
    isAuthenticated,
  };
}
