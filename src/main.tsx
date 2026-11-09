import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { ApiError } from './api/client';
import { App } from './App';
import { SheetProvider, ToastProvider } from './components/ui';
import { AuthProvider } from './lib/auth';
import './styles/app.css';

// Si la sesión expira o la cuenta se desactiva, se vuelve al login.
const onAuthError = (err: unknown) => {
  if (err instanceof ApiError && (err.status === 401 || (err.status === 403 && err.message.includes('no está activa')))) {
    queryClient.setQueryData(['me'], null);
  }
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <SheetProvider>
              <App />
            </SheetProvider>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
