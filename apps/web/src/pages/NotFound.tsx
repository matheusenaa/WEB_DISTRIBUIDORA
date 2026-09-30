import { Link } from 'react-router-dom';
import { Home, SearchX } from 'lucide-react';
import { Card, CardContent } from '@/components/ui';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-4xl font-bold text-primary">404</p>
            <p className="mt-1 font-medium">Pagina nao encontrada</p>
            <p className="mt-1 text-sm text-muted-foreground">
              O endereco acessado nao existe ou voce nao tem permissao para ver.
            </p>
          </div>
          <Link
            to="/"
            className="mt-2 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Home className="mr-2 h-4 w-4" aria-hidden />
            Voltar ao inicio
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}