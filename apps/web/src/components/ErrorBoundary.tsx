import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundaryClass extends Component<ErrorBoundaryProps & { navigate: (to: string) => void }, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps & { navigate: (to: string) => void }) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary capturou um erro:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleGoHome = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
    this.props.navigate('/');
  };

  handleCopyError = async (): Promise<void> => {
    const errorDetails = this.state.error
      ? `${this.state.error.name}: ${this.state.error.message}\n\nStack:\n${this.state.error.stack || 'N/A'}\n\nComponent Stack:\n${this.state.errorInfo?.componentStack || 'N/A'}`
      : 'Nenhum detalhe disponível';

    try {
      await navigator.clipboard.writeText(errorDetails);
    } catch (err) {
      console.error('Falha ao copiar detalhes do erro:', err);
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 py-8 text-center">
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold">Algo inesperado aconteceu</h1>
            <p className="max-w-md text-sm text-muted-foreground">
              Não foi possível carregar esta tela. Os dados já salvos não foram perdidos.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button onClick={this.handleRetry}>Tentar novamente</Button>
            <Button variant="outline" onClick={this.handleGoHome}>
              Voltar ao início
            </Button>
            <Button variant="ghost" onClick={this.handleCopyError}>
              Copiar detalhes do erro
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function ErrorBoundary({ children }: ErrorBoundaryProps): ReactNode {
  const navigate = useNavigate();
  return <ErrorBoundaryClass navigate={navigate}>{children}</ErrorBoundaryClass>;
}
