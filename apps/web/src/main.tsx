import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { initTheme, ThemeProvider } from './lib/theme';
import { ApiError } from './lib/api';
import './index.css';

// Antes do primeiro render: evita o flash de tema claro em quem escolheu o
// escuro. Precisa rodar antes do createRoot.
initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // 4xx nunca devem ser repetidos: sao erros de regra de negocio.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root nao encontrado no index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <App />
            <Toaster
              position="top-right"
              richColors
              closeButton
              toastOptions={{ duration: 4000 }}
            />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);