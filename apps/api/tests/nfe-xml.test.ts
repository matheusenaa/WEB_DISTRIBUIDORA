import { describe, expect, it } from 'vitest';
import {
  decodeXmlText,
  findBlocks,
  findValue,
  localName,
  mapNfeUnit,
  parseDecimal,
  parseNfeXml,
  toCents,
} from '../src/lib/nfe-xml.js';

/**
 * Leitura do XML da NF-e.
 *
 * O que se protege: dinheiro em centavos e casamento de item. Um parser que
 * perde uma casa decimal multiplica o erro por todas as quantidades da
 * nota, e um parser que embaralha os itens associa o preco de um produto ao
 * codigo de outro.
 */

const nfe = (inner: string, head = '<nfe:infNFe') => `<${head} xmlns="http://www.portalfiscal.inf.br/nfe">${inner}</${head}>`;

const ide = (extra = '') =>
  `<ide><nNF>1234</nNF><serie>1</serie><dhEmi>2026-03-15T10:30:00-03:00</dhEmi>${extra}</ide>`;

const det = (prod: string) => `<det><prod>${prod}</prod></det>`;

const prod = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([tag, value]) => `<${tag}>${value}</${tag}>`)
    .join('');

describe('leitor de tags', () => {
  it('descarta o prefixo de namespace', () => {
    expect(localName('nfe:infNFe')).toBe('infNFe');
    expect(localName('det')).toBe('det');
    expect(localName('')).toBe('');
  });

  it('acha tag com e sem namespace', () => {
    expect(findValue('<nfe:xProd>Leite</nfe:xProd>', 'xProd')).toBe('Leite');
    expect(findValue('<xProd>Leite</xProd>', 'xProd')).toBe('Leite');
  });

  it('nao confunde tag com nome parecido', () => {
    const xml = '<nProt>123</nProt><prot>456</prot>';
    expect(findValue(xml, 'nProt')).toBe('123');
    expect(findValue(xml, 'prot')).toBe('456');
  });

  it('devolve null para tag ausente e para tag vazia', () => {
    expect(findValue('<a>1</a>', 'b')).toBeNull();
    expect(findValue('<a/>', 'a')).toBeNull();
  });

  it('recusa tag vazia em bloco, mas aceita texto com espacos', () => {
    expect(findBlocks('<det></det><det><x>1</x></det>', 'det')).toHaveLength(2);
    expect(findValue('<xProd>  Leite Integral  </xProd>', 'xProd')).toBe('Leite Integral');
  });

  it('decodifica entidades e CDATA', () => {
    expect(decodeXmlText('P&amp;O')).toBe('P&O');
    expect(decodeXmlText('&lt;tag&gt;')).toBe('<tag>');
    expect(decodeXmlText('<![CDATA[Acucar & Cia]]>')).toBe('Acucar & Cia');
    expect(decodeXmlText('&#65;&#x42;')).toBe('AB');
  });

  it('decodifica numero de entidade nao cai em laco', () => {
    expect(decodeXmlText('&#65;&#x42;')).toBe('AB');
  });
});

describe('numeros do XML', () => {
  it('lê decimal com ponto, que e como a NF-e publica', () => {
    expect(parseDecimal('1234.56')).toBe(1234.56);
    expect(parseDecimal('0.0000000000')).toBe(0);
  });

  it('aceita virgula de arquivo reconvertido', () => {
    expect(parseDecimal('1234,56')).toBe(1234.56);
  });

  it('rejeita vazio e texto', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('   ')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal(null)).toBeNull();
  });

  it('converte reais para centavos arredondando uma vez', () => {
    expect(toCents('12.34')).toBe(1234);
    // 10 casas decimais na NF-e: o arredondamento precisa acontecer aqui,
    // e nao em cada multiplicacao depois.
    expect(toCents('12.3456789012')).toBe(1235);
    expect(toCents('0.005')).toBe(1);
  });

  it('centavos nao acumulam erro de float em 10mil itens', () => {
    // 10.000 itens de R$ 0,01 = R$ 100,00. O erro classico seria
    // `0.01 * 3 = 0.030000000000000002`; arredondando por item, sobra
    // apenas o residuo binario que cabe em 1 centavo.
    let total = 0;
    for (let i = 0; i < 10_000; i += 1) total += toCents('0.01')!;
    expect(total).toBe(10_000);
  });
});

describe('unidade comercial', () => {
  it('mapeia as unidades da NF-e para o catalogo', () => {
    expect(mapNfeUnit('UN')).toBe('UN');
    expect(mapNfeUnit('PC')).toBe('UN');
    expect(mapNfeUnit('CX')).toBe('CX');
    expect(mapNfeUnit('KG')).toBe('KG');
    expect(mapNfeUnit('LT')).toBe('L');
    expect(mapNfeUnit('MT')).toBe('M');
    expect(mapNfeUnit('DZ')).toBe('DZ');
  });

  it('ignora caixa alta e espacos', () => {
    expect(mapNfeUnit(' cx ')).toBe('CX');
    expect(mapNfeUnit('Kg')).toBe('KG');
  });

  it('unidade desconhecida vira UN em vez de perder o item', () => {
    expect(mapNfeUnit('ZZZ')).toBe('UN');
    expect(mapNfeUnit(null)).toBe('UN');
    expect(mapNfeUnit('')).toBe('UN');
  });
});

describe('nota completa', () => {
  const xml = nfe(`
    <ide><nNF>1234</nNF><serie>1</serie><dhEmi>2026-03-15T10:30:00-03:00</dhEmi></ide>
    <emit><CNPJ>12345678000190</CNPJ><xNome>Distribuidora Norte</xNome></emit>
    <dest><xNome>Mercado Bom Preco</xNome></dest>
    ${det(
      prod({
        cProd: '001',
        cEAN: '7891000100103',
        xProd: 'Leite Integral 1L',
        uCom: 'UN',
        qCom: '10.0000',
        vUnCom: '5.4900000000',
        vProd: '54.9000000000',
      }),
    )}
    ${det(
      prod({
        cProd: '002',
        cEAN: 'SEM GTIN',
        xProd: 'Arroz 5kg',
        uCom: 'PCT',
        qCom: '4.0000',
        vUnCom: '22.9000000000',
        vProd: '91.6000000000',
      }),
    )}
    <total><ICMSTot><vNF>146.50</vNF></ICMSTot></total>
  `);

  it('le cabecalho, emitente e destinatario', () => {
    const parsed = parseNfeXml(xml);

    expect(parsed.number).toBe('1234');
    expect(parsed.series).toBe('1');
    expect(parsed.issueDate).toBe(new Date('2026-03-15T10:30:00-03:00').toISOString());
    expect(parsed.supplierName).toBe('Distribuidora Norte');
    expect(parsed.supplierDocument).toBe('12345678000190');
    expect(parsed.destinationName).toBe('Mercado Bom Preco');
    expect(parsed.totalCents).toBe(14650);
  });

  it('mantem a ordem dos itens e a numeracao de linha da nota', () => {
    const parsed = parseNfeXml(xml);

    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]?.line).toBe(1);
    expect(parsed.items[1]?.line).toBe(2);
    expect(parsed.items[0]?.name).toBe('Leite Integral 1L');
    expect(parsed.items[1]?.name).toBe('Arroz 5kg');
  });

  it('converte preco unitario e total para centavos', () => {
    const parsed = parseNfeXml(xml);

    expect(parsed.items[0]?.unitValueCents).toBe(549);
    expect(parsed.items[0]?.totalCents).toBe(5490);
    expect(parsed.items[1]?.unitValueCents).toBe(2290);
    expect(parsed.items[1]?.totalCents).toBe(9160);
  });

  it('trata "SEM GTIN" como EAN ausente, e avisa', () => {
    const parsed = parseNfeXml(xml);

    expect(parsed.items[0]?.ean).toBe('7891000100103');
    expect(parsed.items[1]?.ean).toBeNull();
    expect(parsed.warnings.some((w) => w.includes('sem codigo de barras'))).toBe(true);
  });

  it('avisa quando a soma dos itens nao bate com o total da nota', () => {
    const divergente = xml.replace('<vNF>146.50</vNF>', '<vNF>150.00</vNF>');
    const parsed = parseNfeXml(divergente);

    expect(parsed.warnings.some((w) => w.includes('difere do total'))).toBe(true);
  });

  it('nao avisa quando a soma bate', () => {
    expect(parseNfeXml(xml).warnings.some((w) => w.includes('difere do total'))).toBe(false);
  });

  it('nao acusa divergencia por 1 centavo de arredondamento', () => {
    // 0.01 de folga e o ruido esperado das 10 casas decimais da NF-e.
    const centsOff = xml.replace('<vNF>146.50</vNF>', '<vNF>146.51</vNF>');
    expect(parseNfeXml(centsOff).warnings.some((w) => w.includes('difere'))).toBe(false);
  });
});

describe('casos de borda', () => {
  it('pega a chave de acesso do atributo Id', () => {
    const chave = '35260312345678000190550010000000011000000017';
    const xml = `<nfe:infNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00" Id="NFe${chave}">` +
      `<ide><nNF>1</nNF></ide></nfe:infNFe>`;
    expect(parseNfeXml(xml).accessKey).toBe(chave);
  });

  it('pega a chave da tag chNFe quando houver', () => {
    const xml = nfe('<ide><chNFe>35260312345678000190550010000000011000000017</chNFe></ide>');
    expect(parseNfeXml(xml).accessKey).toBe('35260312345678000190550010000000011000000017');
  });

  it('pega a data de emissao quando vier so a data', () => {
    const xml = nfe('<ide><nNF>1</nNF><dEmi>2026-03-15</dEmi></ide>');
    expect(parseNfeXml(xml).issueDate).toBe(new Date('2026-03-15').toISOString());
  });

  it('item sem descricao vira erro, e nao item fantasma', () => {
    const xml = nfe(
      `${det(prod({ cProd: '1', qCom: '1', vUnCom: '1.00', vProd: '1.00' }))}${det(
        prod({ xProd: 'Produto Bom', cEAN: '123', uCom: 'UN', qCom: '2', vUnCom: '1.00', vProd: '2.00' }),
      )}`,
    );
    const parsed = parseNfeXml(xml);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]?.line).toBe(1);
  });

  it('item com quantidade invalida nao entra na importacao', () => {
    const xml = nfe(
      det(prod({ xProd: 'Sem quantidade', cEAN: '1', uCom: 'UN', qCom: '0', vUnCom: '1.00', vProd: '0.00' })),
    );
    const parsed = parseNfeXml(xml);

    expect(parsed.items).toHaveLength(0);
    expect(parsed.errors[0]?.reason).toContain('quantidade invalida');
  });

  it('quantidade fracionada e arredondada com aviso visivel', () => {
    const xml = nfe(
      det(
        prod({
          xProd: 'Peito de frango',
          cEAN: '789',
          uCom: 'KG',
          qCom: '3.7500',
          vUnCom: '18.9000000000',
          vProd: '70.8750000000',
        }),
      ),
    );
    const parsed = parseNfeXml(xml);

    expect(parsed.items[0]?.quantity).toBe(4);
    expect(parsed.warnings.some((w) => w.includes('fracionada'))).toBe(true);
  });

  it('vProd zerado usa o unitario vezes a quantidade', () => {
    const xml = nfe(
      det(
        prod({
          xProd: 'Produto',
          cEAN: '789',
          uCom: 'UN',
          qCom: '3',
          vUnCom: '10.00',
          vProd: '0.00',
        }),
      ),
    );
    expect(parseNfeXml(xml).items[0]?.totalCents).toBe(3000);
  });

  it('det dentro de infAdProd nao vira item', () => {
    // `infAdProd` pode repetir tags do proprio item; sem recorte por bloco,
    // o produto viraria dois.
    const xml = nfe(
      `<det><prod>${prod({ xProd: 'Produto Unico', cEAN: '1', uCom: 'UN', qCom: '1', vUnCom: '5.00', vProd: '5.00' })}` +
        `<infAdProd><det><obsCont><xTexto>extra</xTexto></obsCont></det></infAdProd></prod></det>`,
    );
    expect(parseNfeXml(xml).items).toHaveLength(1);
  });

  it('template sem itens avisa em vez de devolver sucesso vazio', () => {
    const xml = nfe('<ide><nNF>1</nNF></ide><emit><xNome>Fornecedor</xNome></emit>');
    const parsed = parseNfeXml(xml);

    expect(parsed.items).toHaveLength(0);
    expect(parsed.warnings.some((w) => w.includes('modelo de NF-e'))).toBe(true);
  });

  it('XML invalido nao lanca: devolve lista vazia para a tela explicar', () => {
    const parsed = parseNfeXml('isto nao e xml');
    expect(parsed.items).toHaveLength(0);
    expect(parsed.number).toBeNull();
  });

  it('aceita XML sem namespace', () => {
    const xml = `<infNFe><ide><nNF>7</nNF></ide>${det(
      prod({ xProd: 'Item', cEAN: '1', uCom: 'UN', qCom: '1', vUnCom: '1.00', vProd: '1.00' }),
    )}</infNFe>`;
    const parsed = parseNfeXml(xml);

    expect(parsed.number).toBe('7');
    expect(parsed.items).toHaveLength(1);
  });

  it('XML com CDATA no nome do produto', () => {
    const xml = nfe(
      det(
        `<xProd><![CDATA[Café Torrado & Moído 500g]]></xProd><cEAN>1</cEAN><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd>`,
      ),
    );
    expect(parseNfeXml(xml).items[0]?.name).toBe('Café Torrado & Moído 500g');
  });

  it('emitente como pessoa fisica (CPF) e aceito', () => {
    const xml = nfe('<emit><CPF>12345678909</CPF><xNome>Joao</xNome></emit>');
    expect(parseNfeXml(xml).supplierDocument).toBe('12345678909');
  });
});