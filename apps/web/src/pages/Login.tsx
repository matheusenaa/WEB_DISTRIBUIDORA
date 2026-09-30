import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Lock, LogIn, User as UserIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Informe o usuario'),
  password: z.string().min(1, 'Informe a senha'),
});

type LoginForm = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values.username, values.password);
      toast.success('Acesso liberado');
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        // Mensagens invalidas/inexistentes ficam deliberadamente genericas
        // para nao revelar quais usuarios existem.
        setError(
          caught.status === 401
            ? 'Usuario ou senha incorretos.'
            : caught.message || 'Nao foi possivel entrar. Tente novamente.',
        );
      } else {
        setError('Nao foi possivel falar com o servidor. Verifique se a API esta rodando.');
      }
    }
  });

  return (
    <div className="flex min-h-screen">
      {/* Painel de marca: escondido em telas pequenas para focar no formulario. */}
      <aside className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
          aria-hidden
        />
        <div className="relative">
          <div className="flex flex-col items-center gap-4 text-center">
            <img
              src="/logo-web-distribuidora.jpeg"
              alt="WEB DISTRIBUIDORA"
              className="h-24 w-auto max-w-[90%] rounded-lg shadow-lg object-contain"
            />
            <div>
              <p className="text-lg font-extrabold leading-tight tracking-tight">WEB DISTRIBUIDORA</p>
              <p className="text-xs text-primary-foreground/70">Sistema de gestao comercial</p>
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-bold leading-tight">
            Controle total de produtos, estoque, vendas e caixa.
          </h1>
          <ul className="mt-6 space-y-3 text-sm text-primary-foreground/85">
            {[
              'PDV com leitor de codigo de barras, sem plugin',
              'Baixa automatica de estoque e custo medio ponderado',
              'Fechamento de caixa com conferencia de diferencas',
              'Relatorios de margem, lucro e produtos mais vendidos',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-primary-foreground/50">
          Acesso restrito a pessoal autorizado.
        </p>
      </aside>

      {/* Formulario */}
      <main className="flex w-full items-center justify-center p-6 lg:w-[480px] lg:shrink-0">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-2 lg:hidden">
            <img
              src="/logo-web-distribuidora.jpeg"
              alt="WEB DISTRIBUIDORA"
              className="h-16 w-auto max-w-[80%] rounded-lg shadow-md object-contain"
            />
            <div>
              <p className="font-bold leading-tight">WEB DISTRIBUIDORA</p>
              <p className="text-xs text-muted-foreground">Sistema de gestao comercial</p>
            </div>
          </div>

          <h2 className="text-2xl font-bold">Entrar</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Informe suas credenciais para acessar o sistema.
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <FormError>{error}</FormError>

            <Field label="Usuario" htmlFor="username" error={errors.username?.message}>
              <div className="relative">
                <UserIcon
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="username"
                  autoFocus
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="pl-9"
                  invalid={Boolean(errors.username)}
                  {...register('username')}
                />
              </div>
            </Field>

            <Field label="Senha" htmlFor="password" error={errors.password?.message}>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="pl-9 pr-10"
                  invalid={Boolean(errors.password)}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </div>
            </Field>

            <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
              {!isSubmitting && <LogIn className="h-4 w-4" aria-hidden />}
              {isSubmitting ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Primeira vez acessando? Troque a senha padrao em <strong>Meu perfil</strong> apos o
            primeiro login.
          </p>
        </div>
      </main>
    </div>
  );
}