import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { config } from './env.js';
import { authPlugin } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerUserRoutes } from './modules/users/routes.js';
import { registerProductRoutes } from './modules/products/routes.js';
import { registerStockRoutes } from './modules/stock/routes.js';
import { registerSaleRoutes } from './modules/sales/routes.js';
import { registerCashRoutes } from './modules/cash/routes.js';
import { registerDashboardRoutes } from './modules/dashboard/routes.js';
import { registerReportRoutes } from './modules/reports/routes.js';
import { registerAuditRoutes } from './modules/audit/routes.js';
import { registerSystemRoutes } from './modules/system/routes.js';
import {
  registerCategoryRoutes,
  registerBrandRoutes,
  registerSupplierRoutes,
  registerCustomerRoutes,
} from './modules/catalog/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Trust proxy: necessario para que o rate limit por IP e o log usem o IP
    // real quando a aplicacao roda atras de Nginx/Traefik/Coolify.
    trustProxy: true,
    logger: {
      level: config.isProduction ? 'info' : 'debug',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.newPassword',
          'req.body.currentPassword',
          'req.body.refreshToken',
        ],
        remove: true,
      },
      transport: config.isProduction
        ? undefined
        : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    },
    // `disableRequestLogging` nao e informado: `false` ja e o padrao e a opcao
    // de topo esta depreciada (FSTDEP023, removida no fastify@6).
    bodyLimit: 5 * 1024 * 1024,
    ajv: { customOptions: { coerceTypes: true, removeAdditional: 'all', allErrors: false } },
  });

  registerErrorHandler(app);

  await app.register(sensible);
  await app.register(cors, {
    origin: (origin, cb) => {
      // Sem Origin = chamada nao vinda de navegador (health check, curl, app desktop).
      if (!origin) return cb(null, true);
      if (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Origem nao autorizada'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(helmet, {
    // API nao serve HTML; CSP nao se aplica aqui.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // Rotas de leitura sao mais pesadas em numero, mas menos em risco.
    allowList: (request) => request.method === 'OPTIONS',
  });

  await app.register(authPlugin);

  /* ------------------------- Rotas ------------------------- */
  await app.register(registerSystemRoutes, { prefix: '/api' });
  await app.register(registerAuthRoutes, { prefix: '/api/auth' });
  await app.register(registerUserRoutes, { prefix: '/api/users' });
  await app.register(registerProductRoutes, { prefix: '/api/products' });
  await app.register(registerCategoryRoutes, { prefix: '/api/categories' });
  await app.register(registerBrandRoutes, { prefix: '/api/brands' });
  await app.register(registerSupplierRoutes, { prefix: '/api/suppliers' });
  await app.register(registerCustomerRoutes, { prefix: '/api/customers' });
  await app.register(registerStockRoutes, { prefix: '/api/stock' });
  await app.register(registerSaleRoutes, { prefix: '/api/sales' });
  await app.register(registerCashRoutes, { prefix: '/api/cash' });
  await app.register(registerDashboardRoutes, { prefix: '/api/dashboard' });
  await app.register(registerReportRoutes, { prefix: '/api/reports' });
  await app.register(registerAuditRoutes, { prefix: '/api/audit' });

  app.get('/', async () => ({
    name: 'WEB DISTRIBUIDORA - API',
    version: '1.0.0',
    docs: '/api/health',
  }));

  return app;
}
