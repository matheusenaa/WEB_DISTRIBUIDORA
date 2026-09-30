/**
 * Seed do banco.
 *
 * O que e criado aqui e FUNDAMENTAL e util desde o primeiro dia:
 *  - usuario administrador inicial;
 *  - categorias/marcas/fornecedores/clientes de exemplo (editaveis);
 *  - formas de pagamento e parametros basicos do sistema.
 *
 * Vendas, movimentacoes e relatorios NAO sao inventados por padrao, porque
 * numero falso em dashboard e relatorio e exatamente o que o projeto proibe.
 * Para gerar dados de teste use:  SEED_DEMO_SALES=true npm run db:seed
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
// Carrega o .env da raiz do monorepo antes de abrir a conexao.
const dotenv = (await import('dotenv')).default;
dotenv.config({ path: path.join(repoRoot, '.env') });

const prisma = new PrismaClient();

const SEED_DEMO_SALES = process.env.SEED_DEMO_SALES === 'true';

/**
 * Calcula o digito verificador de um EAN-13 a partir dos 12 primeiros digitos.
 * Gera codigos de barras REAIS e validos, em vez de numeros inventados.
 */
function ean13(base12: string): string {
  if (!/^\d{12}$/.test(base12)) throw new Error(`Base invalida para EAN-13: ${base12}`);
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return `${base12}${check}`;
}

async function main(): Promise<void> {
  console.log('> Populando o banco de dados...\n');

  /* ---------------------------------------------------------------- */
  /* 1. Usuario administrador                                          */
  /* ---------------------------------------------------------------- */
  const adminUsername = (process.env.ADMIN_USERNAME ?? 'admin').toLowerCase();
  const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@webdistribuidora.com.br').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
  const adminName = process.env.ADMIN_NAME ?? 'Administrador';

  const existingAdmin = await prisma.user.findUnique({ where: { username: adminUsername } });
  let adminId: number;

  if (existingAdmin) {
    adminId = existingAdmin.id;
    console.log(`  [ok] Administrador "${adminUsername}" ja existe (id ${adminId}).`);
  } else {
    const admin = await prisma.user.create({
      data: {
        name: adminName,
        username: adminUsername,
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 12),
        role: 'ADMIN',
        status: 'ATIVO',
      },
    });
    adminId = admin.id;
    console.log(`  [ok] Administrador criado: ${admin.username} (id ${admin.id})`);
  }

  /* ---------------------------------------------------------------- */
  /* 2. Parametros do sistema                                          */
  /* ---------------------------------------------------------------- */
  const settings: Record<string, string> = {
    'company.name': 'WEB DISTRIBUIDORA',
    'company.document': '',
    'company.phone': '',
    'company.address': '',
    'sale.allowNegativeStock': 'false',
    'sale.sellerMaxDiscount': '0',
    'sale.adminMaxDiscount': '40',
    'stock.defaultMinAlert': '5',
    'cash.tolerance': '0.01',
    'print.autoPrintReceipt': 'false',
    'print.receiptWidth': '80mm',
    'pdv.requireOpenCash': 'true',
  };

  for (const [key, value] of Object.entries(settings)) {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: {} });
  }
  console.log(`  [ok] ${Object.keys(settings).length} configuracoes gravadas.`);

  /* ---------------------------------------------------------------- */
  /* 3. Cadastros basicos                                             */
  /* ---------------------------------------------------------------- */
  const categoryNames = ['Bebidas', 'Mercearia', 'Higiene Pessoal', 'Limpeza', 'Descartaveis', 'Congelados'];
  const categories = await Promise.all(
    categoryNames.map((name) =>
      prisma.category.upsert({ where: { name }, create: { name, active: true }, update: {} }),
    ),
  );
  console.log(`  [ok] ${categories.length} categorias.`);

  const brandNames = ['Unilever', 'Nestle', 'Coca-Cola', 'Ambev', 'Colgate-Palmolive'];
  const brands = await Promise.all(
    brandNames.map((name) => prisma.brand.upsert({ where: { name }, create: { name, active: true }, update: {} })),
  );
  console.log(`  [ok] ${brands.length} marcas.`);

  const supplierSeed = [
    { name: 'Distribuidora Alfa Ltda', document: '12.345.678/0001-90' },
    { name: 'Atacado Beta S.A.', document: '98.765.432/0001-10' },
    { name: 'Comercial Gamma ME', document: '11.222.333/0001-44' },
  ];
  const suppliers = [];
  for (const s of supplierSeed) {
    const found = await prisma.supplier.findFirst({ where: { name: s.name } });
    suppliers.push(
      found ?? (await prisma.supplier.create({ data: { name: s.name, document: s.document, active: true } })),
    );
  }
  console.log(`  [ok] ${suppliers.length} fornecedores.`);

  const customerSeed = [
    { name: 'Consumidor Final', document: null },
    { name: 'Mercado Sao Jose', document: '11.111.111/0001-11' },
  ];
  const customers = [];
  for (const c of customerSeed) {
    const found = await prisma.customer.findFirst({ where: { name: c.name } });
    customers.push(found ?? (await prisma.customer.create({ data: { ...c, active: true } })));
  }
  console.log(`  [ok] ${customers.length} clientes.`);

  /* ---------------------------------------------------------------- */
  /* 4. Produtos de exemplo (sem estoque e sem venda)                   */
  /*    Estoque inicial entra como movimentacao registrada, nunca       */
  /*    como numero solto, para o historico comecar consistente.        */
  /* ---------------------------------------------------------------- */
  const existingProducts = await prisma.product.count();
  if (existingProducts > 0) {
    console.log(`  [--] Ja existem ${existingProducts} produtos. Pulando cadastro de produtos.`);
  } else {
    // Barcodes EAN-13 com digito verificador calculado em tempo de execucao.
    const productSeed = [
      { name: 'Coca-Cola 2L', base: '789100031550', cat: 'Bebidas', brand: 'Coca-Cola', cost: 650, sale: 899, min: 12, unit: 'UN' },
      { name: 'Guarana Antarctica 2L', base: '789191000019', cat: 'Bebidas', brand: 'Ambev', cost: 480, sale: 679, min: 12, unit: 'UN' },
      { name: 'Cerveja Brahma Lata 350ml', base: '789108570010', cat: 'Bebidas', brand: 'Ambev', cost: 320, sale: 449, min: 24, unit: 'UN' },
      { name: 'Agua Mineral 500ml', base: '789191000190', cat: 'Bebidas', brand: null, cost: 120, sale: 199, min: 48, unit: 'UN' },
      { name: 'Arroz Tipo 1 5kg', base: '789600400123', cat: 'Mercearia', brand: null, cost: 1890, sale: 2499, min: 6, unit: 'UN' },
      { name: 'Feijao Carioca 1kg', base: '789600400567', cat: 'Mercearia', brand: null, cost: 780, sale: 1049, min: 8, unit: 'UN' },
      { name: 'Acucar Unico 1kg', base: '789600400891', cat: 'Mercearia', brand: null, cost: 420, sale: 579, min: 10, unit: 'UN' },
      { name: 'Oleo de Soja 900ml', base: '789114910124', cat: 'Mercearia', brand: null, cost: 620, sale: 849, min: 6, unit: 'UN' },
      { name: 'Macarrao Parafuso 500g', base: '789600400234', cat: 'Mercearia', brand: 'Nestle', cost: 350, sale: 499, min: 10, unit: 'UN' },
      { name: 'Sabonete em Po 1kg', base: '789103590103', cat: 'Higiene Pessoal', brand: 'Unilever', cost: 980, sale: 1399, min: 4, unit: 'UN' },
      { name: 'Shampoo 400ml', base: '789103590301', cat: 'Higiene Pessoal', brand: 'Unilever', cost: 1150, sale: 1599, min: 4, unit: 'UN' },
      { name: 'Creme Dental 90g', base: '789103591200', cat: 'Higiene Pessoal', brand: 'Colgate-Palmolive', cost: 720, sale: 1099, min: 5, unit: 'UN' },
      { name: 'Detergente Neutro 500ml', base: '789102413470', cat: 'Limpeza', brand: 'Unilever', cost: 180, sale: 289, min: 20, unit: 'UN' },
      { name: 'Desinfetante 1L', base: '789103598145', cat: 'Limpeza', brand: 'Unilever', cost: 480, sale: 699, min: 12, unit: 'UN' },
      { name: 'Papel Higienico 12un', base: '789103590402', cat: 'Higiene Pessoal', brand: null, cost: 1450, sale: 1999, min: 6, unit: 'PCT' },
      { name: 'Copo Descartavel 200ml', base: '789603609806', cat: 'Descartaveis', brand: null, cost: 520, sale: 749, min: 10, unit: 'PCT' },
      { name: 'Guardanapo 100un', base: '789603609807', cat: 'Descartaveis', brand: null, cost: 380, sale: 549, min: 10, unit: 'PCT' },
      { name: 'Saco de Lixo 100L', base: '789603609850', cat: 'Descartaveis', brand: null, cost: 890, sale: 1199, min: 5, unit: 'PCT' },
    ];

    const categoryByName = new Map(categories.map((c) => [c.name, c.id]));
    const brandByName = new Map(brands.map((b) => [b.name, b.id]));

    let index = 1;
    for (const p of productSeed) {
      const product = await prisma.product.create({
        data: {
          internalCode: String(index).padStart(5, '0'),
          barcode: ean13(p.base),
          name: p.name,
          categoryId: categoryByName.get(p.cat) ?? null,
          brandId: p.brand ? brandByName.get(p.brand) ?? null : null,
          supplierId: suppliers[index % suppliers.length]?.id ?? null,
          costPrice: p.cost,
          salePrice: p.sale,
          stock: 0,
          minStock: p.min,
          unit: p.unit,
          status: 'ATIVO',
        },
      });

      // Entrada inicial de 3x o estoque minimo, registrada como movimentacao.
      const initialQty = p.min * 3;
      await prisma.stockMovement.create({
        data: {
          type: 'ENTRADA',
          productId: product.id,
          quantity: initialQty,
          previousStock: 0,
          resultingStock: initialQty,
          reason: 'Estoque inicial do cadastro',
          documentNumber: 'CADASTRO',
          unitCost: p.cost,
          userId: adminId,
        },
      });
      await prisma.product.update({ where: { id: product.id }, data: { stock: initialQty } });

      index += 1;
    }
    console.log(`  [ok] ${productSeed.length} produtos cadastrados com estoque inicial registrado.`);
  }

  /* ---------------------------------------------------------------- */
  /* 5. Dados de demonstracao (opcionais)                              */
  /* ---------------------------------------------------------------- */
  if (SEED_DEMO_SALES) {
    console.log('\n> Gerando vendas de demonstracao (SEED_DEMO_SALES=true)...');
    const products = await prisma.product.findMany({ where: { status: 'ATIVO', stock: { gt: 0 } } });
    const methods = ['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CREDITO'];

    let saleNumber = (await prisma.sale.aggregate({ _max: { number: true } }))._max.number ?? 0;
    let created = 0;

    for (let dayOffset = 29; dayOffset >= 0; dayOffset -= 1) {
      const salesToday = 2 + Math.floor(Math.random() * 5);
      for (let s = 0; s < salesToday; s += 1) {
        const when = new Date();
        when.setDate(when.getDate() - dayOffset);
        when.setHours(9 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60), 0, 0);
        if (when > new Date()) continue;

        const itemCount = 1 + Math.floor(Math.random() * 4);
        const chosen = new Set<number>();
        while (chosen.size < itemCount) {
          const p = products[Math.floor(Math.random() * products.length)];
          if (p) chosen.add(p.id);
        }

        let subtotal = 0;
        let costTotal = 0;
        const lines = [...chosen].map((id) => {
          const p = products.find((x) => x.id === id)!;
          const qty = 1 + Math.floor(Math.random() * 3);
          subtotal += p.salePrice * qty;
          costTotal += p.costPrice * qty;
          return { product: p, qty };
        });

        const method = methods[Math.floor(Math.random() * methods.length)]!;
        saleNumber += 1;

        const sale = await prisma.sale.create({
          data: {
            number: saleNumber,
            sellerId: adminId,
            userId: adminId,
            customerId: Math.random() > 0.8 ? customers[1]?.id ?? null : null,
            subtotal,
            discountCents: 0,
            total: subtotal,
            costTotal,
            paymentMethod: method,
            amountPaidCents: subtotal,
            changeCents: 0,
            status: 'CONCLUIDA',
            createdAt: when,
            items: {
              create: lines.map((l) => ({
                productId: l.product.id,
                productName: l.product.name,
                productUnit: l.product.unit,
                barcode: l.product.barcode,
                quantity: l.qty,
                unitPrice: l.product.salePrice,
                costPrice: l.product.costPrice,
                subtotal: l.product.salePrice * l.qty,
              })),
            },
            payments: { create: [{ method, amountCents: subtotal }] },
          },
        });

        // Baixa de estoque + movimentacao, replicando o fluxo real de venda.
        for (const l of lines) {
          const current = await prisma.product.findUniqueOrThrow({ where: { id: l.product.id } });
          const next = Math.max(0, current.stock - l.qty);
          await prisma.product.update({ where: { id: l.product.id }, data: { stock: next } });
          await prisma.stockMovement.create({
            data: {
              type: 'SAIDA',
              productId: l.product.id,
              quantity: l.qty,
              previousStock: current.stock,
              resultingStock: next,
              reason: `Venda #${saleNumber}`,
              documentNumber: String(saleNumber),
              userId: adminId,
              saleId: sale.id,
              createdAt: when,
            },
          });
        }

        created += 1;
      }
    }
    console.log(`  [ok] ${created} vendas de demonstracao geradas em 30 dias.`);
  }

  /* ---------------------------------------------------------------- */
  /* Resumo                                                            */
  /* ---------------------------------------------------------------- */
  const [users, products, movements, sales] = await Promise.all([
    prisma.user.count(),
    prisma.product.count(),
    prisma.stockMovement.count(),
    prisma.sale.count(),
  ]);

  console.log('\n--------------------------------------------------------------');
  console.log(' Seed concluido.');
  console.log(`   usuarios:  ${users}`);
  console.log(`   produtos:  ${products}`);
  console.log(`   estoque:   ${movements} movimentacoes`);
  console.log(`   vendas:    ${sales}`);
  console.log('--------------------------------------------------------------');
  console.log(`\n Acesse com:`);
  console.log(`   usuario: ${adminUsername}`);
  console.log(`   senha:   ${adminPassword}`);
  if (adminPassword === 'ChangeMe123!') {
    console.log('\n >> ALTERE A SENHA DO ADMINISTRADOR NO PRIMEIRO ACESSO.\n');
  }
}

main()
  .catch((err) => {
    console.error('\n[ERRO] Falha ao executar o seed:\n', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
