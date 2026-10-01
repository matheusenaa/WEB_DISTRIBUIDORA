import type { Permission } from '@webdist/shared';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { BarcodeProvider } from '@/lib/barcode/BarcodeManager';
import { LoginPage } from '@/pages/Login';
import { DashboardPage } from '@/pages/Dashboard';
import { PdvPage } from '@/pages/Pdv';
import { SalesPage } from '@/pages/Sales';
import { CashPage } from '@/pages/Cash';
import { ProductsPage } from '@/pages/Products';
import { StockMovementsPage } from '@/pages/StockMovements';
import { AlertsPage } from '@/pages/Alerts';
import { CategoriesPage } from '@/pages/Categories';
import { BrandsPage } from '@/pages/Brands';
import { SuppliersPage } from '@/pages/Suppliers';
import { CustomersPage } from '@/pages/Customers';
import { UsersPage } from '@/pages/Users';
import { ReportsPage } from '@/pages/Reports';
import { CalculatorPage } from '@/pages/Calculator';
import { AuditPage } from '@/pages/Audit';
import { SettingsPage } from '@/pages/Settings';
import { ProfilePage } from '@/pages/Profile';
import { NotFoundPage } from '@/pages/NotFound';
import { BarcodeTestPage } from '@/pages/BarcodeTest';

/**
 * Rotas da aplicacao.
 *
 * `Protected` exige sessao; `WithPermission` exige uma permissao especifica.
 * Ambos sao apenas de navegacao - a API valida cada operacao de fato.
 */

function Protected({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function WithPermission({
  permission,
  children,
}: {
  permission: Permission;
  children: React.ReactNode;
}) {
  const { can } = useAuth();
  // Sem permissao, volta ao Dashboard em vez de mostrar tela vazia.
  if (!can(permission)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner label="Carregando..." />
    </div>
  );
}

export function App() {
  const { user, isLoading } = useAuth();

  return (
    <BarcodeProvider>
      <Routes>
        <Route
          path="/login"
          element={isLoading ? <FullScreenLoader /> : user ? <Navigate to="/" replace /> : <LoginPage />}
        />

        <Route
          element={
            <Protected>
              <AppLayout />
            </Protected>
          }
        >
          <Route
            path="/"
            element={
              <WithPermission permission="dashboard:read">
                <DashboardPage />
              </WithPermission>
            }
          />
        <Route
          path="/pdv"
          element={
            <WithPermission permission="sales:create">
              <PdvPage />
            </WithPermission>
          }
        />
        <Route
          path="/vendas"
          element={
            <WithPermission permission="sales:read">
              <SalesPage />
            </WithPermission>
          }
        />
        <Route path="/vendas/:id" element={<SalesPage />} />
        <Route
          path="/caixa"
          element={
            <WithPermission permission="cash:read">
              <CashPage />
            </WithPermission>
          }
        />
        <Route
          path="/produtos"
          element={
            <WithPermission permission="products:read">
              <ProductsPage />
            </WithPermission>
          }
        />
        <Route
          path="/movimentacoes"
          element={
            <WithPermission permission="stock:read">
              <StockMovementsPage />
            </WithPermission>
          }
        />
        <Route
          path="/alertas"
          element={
            <WithPermission permission="stock:read">
              <AlertsPage />
            </WithPermission>
          }
        />
        <Route
          path="/categorias"
          element={
            <WithPermission permission="categories:read">
              <CategoriesPage />
            </WithPermission>
          }
        />
        <Route
          path="/marcas"
          element={
            <WithPermission permission="brands:read">
              <BrandsPage />
            </WithPermission>
          }
        />
        <Route
          path="/fornecedores"
          element={
            <WithPermission permission="suppliers:read">
              <SuppliersPage />
            </WithPermission>
          }
        />
        <Route
          path="/clientes"
          element={
            <WithPermission permission="customers:read">
              <CustomersPage />
            </WithPermission>
          }
        />
        <Route
          path="/usuarios"
          element={
            <WithPermission permission="users:read">
              <UsersPage />
            </WithPermission>
          }
        />
        <Route
          path="/relatorios"
          element={
            <WithPermission permission="reports:read">
              <ReportsPage />
            </WithPermission>
          }
        />
        <Route
          path="/calculadora"
          element={
            <WithPermission permission="products:read">
              <CalculatorPage />
            </WithPermission>
          }
        />
        <Route
          path="/auditoria"
          element={
            <WithPermission permission="audit:read">
              <AuditPage />
            </WithPermission>
          }
        />
        <Route
          path="/configuracoes"
          element={
            <WithPermission permission="settings:read">
              <SettingsPage />
            </WithPermission>
          }
        />
        <Route
          path="/teste-leitor"
          element={
            <WithPermission permission="products:read">
              <BarcodeTestPage />
            </WithPermission>
          }
        />
        <Route path="/perfil" element={<ProfilePage />} />

        {/* Rota curinga por ultimo: qualquer caminho desconhecido cai aqui. */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      </Routes>
    </BarcodeProvider>
  );
}