import { ROLE_LABELS } from '@webdist/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Card, CardContent, CardHeader } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, initials, relative } from '@/lib/format';

export function ProfilePage() {
  const { user, refreshProfile, logout } = useAuth();

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  if (!user) return null;

  const saveProfile = async () => {
    if (name.trim().length < 3) {
      toast.error('Informe seu nome completo.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      toast.error('Informe um e-mail valido.');
      return;
    }
    setSavingProfile(true);
    try {
      await api.put('/api/auth/profile', { name: name.trim(), email: email.trim() });
      await refreshProfile();
      toast.success('Perfil atualizado.');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel salvar.');
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    setPasswordError(null);
    if (currentPassword.length === 0) return setPasswordError('Informe a senha atual.');
    if (newPassword.length < 8) return setPasswordError('A nova senha deve ter ao menos 8 caracteres.');
    if (newPassword !== confirmPassword) return setPasswordError('As senhas nao conferem.');
    if (newPassword === currentPassword) {
      return setPasswordError('A nova senha deve ser diferente da atual.');
    }
    setSavingPassword(true);
    try {
      await api.post('/api/auth/change-password', {
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Senha alterada com sucesso.', {
        description: 'Por seguranca, voce sera desconectado.',
      });
      // Trocar a senha revoga os tokens: encerrar a sessao local.
      setTimeout(() => void logout(), 1500);
    } catch (error) {
      setPasswordError(
        error instanceof ApiError ? error.message : 'Nao foi possivel alterar a senha.',
      );
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Meu perfil</h1>
        <p className="text-sm text-muted-foreground">Seus dados de acesso e permissao</p>
      </div>

      <Card>
        <CardContent className="flex items-center gap-4 p-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
            {initials(user.name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{user.name}</p>
            <p className="text-sm text-muted-foreground">
              {user.username} · {user.email}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge tone="accent">{ROLE_LABELS[user.role]}</Badge>
              <Badge tone={user.status === 'ATIVO' ? 'success' : 'destructive'}>
                {user.status === 'ATIVO' ? 'Ativo' : 'Bloqueado'}
              </Badge>
              <Badge tone="muted">
                {user.lastAccessAt ? `Acesso ${relative(user.lastAccessAt)}` : 'Primeiro acesso'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Dados pessoais" />
          <CardContent className="space-y-4">
            <Field label="Nome completo" htmlFor="pf-name" required>
              <Input id="pf-name" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="E-mail" htmlFor="pf-email" required>
              <Input
                id="pf-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label="Usuario" htmlFor="pf-username" hint="O usuario nao pode ser alterado.">
              <Input id="pf-username" value={user.username} disabled readOnly className="opacity-60" />
            </Field>
            <p className="text-xs text-muted-foreground">
              Conta criada em {dateTime(user.createdAt)}.
            </p>
            <Button onClick={() => void saveProfile()} loading={savingProfile}>
              Salvar dados
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Alterar senha" description="Recomendado trocar a senha padrao" />
          <CardContent className="space-y-4">
            {passwordError && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {passwordError}
              </div>
            )}
            <Field label="Senha atual" htmlFor="pf-current" required>
              <Input
                id="pf-current"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Field label="Nova senha" htmlFor="pf-new" required hint="Minimo de 8 caracteres.">
              <Input
                id="pf-new"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirmar nova senha" htmlFor="pf-confirm" required>
              <Input
                id="pf-confirm"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Button
              variant="accent"
              onClick={() => void changePassword()}
              loading={savingPassword}
            >
              Alterar senha
            </Button>
            <p className="text-xs text-muted-foreground">
              Por seguranca, voce sera desconectado de todos os dispositivos apos trocar a senha.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Suas permissoes"
            description={`${user.permissions.length} permissoes ativas para o perfil ${ROLE_LABELS[user.role]}`}
          />
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {user.permissions.map((permission) => (
                <Badge key={permission} tone="muted" className="font-mono text-[11px]">
                  {permission}
                </Badge>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              As permissoes sao definidas pelo administrador e aplicadas pelo servidor em cada
              operacao.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}