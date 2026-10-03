import { basename, dirname, join, resolve } from 'node:path';

/**
 * Nomes de arquivo de backup.
 *
 * Estas expressoes regulares aparecem na criacao, na listagem, na
 * validacao do restore, na exclusao e no restore pendente do startup.
 * Mantidas aqui em um unico lugar porque ja houve um bug de restore
 * caused por divergencia de caminho entre dois desses pontos: o `.db.gz`
 * gravado em um lugar e procurado em outro. Duplicar o padrao em cinco
 * arquivos e exatamente o que allowiu aquilo.
 *
 * Formato: webdist-<AAAAMMDD>-<HHMMSS>-<sufixo>.db(.gz)
 * O sufixo aleatorio impede que dois backups no mesmo segundo se
 * sobrescrevam, o que aconteceria com data/hora apenas.
 */
const STAMP = String.raw`\d{8}-\d{6}`;
const SUFFIX = String.raw`[0-9a-f]{6}`;

/** Casos aceitos: arquivo compactado, cru e restore pendente. */
export const BACKUP_FILE_PATTERN = new RegExp(
  `^webdist-(?:${STAMP}|pre-restore-${STAMP}|pending-restore-${STAMP})-${SUFFIX}\\.db(?:\\.gz)?$`,
);

/** Restore ainda nao aplicado, aguardando o proximo start. */
export const PENDING_RESTORE_PATTERN = new RegExp(`^webdist-pending-restore-${STAMP}-${SUFFIX}\\.db$`);

/** Backup compactado pronto para listar/restaurar. */
export const ARCHIVED_BACKUP_PATTERN = new RegExp(
  `^webdist-(?:${STAMP}|pre-restore-${STAMP})-${SUFFIX}\\.db\\.gz$`,
);

/** Sufixo curto, suficiente para desambiguar dois backups no mesmo segundo. */
export function randomSuffix(): string {
  return Math.random().toString(16).slice(2, 8).padEnd(6, '0');
}

export function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Resolve a pasta de backups a partir do arquivo do banco.
 *
 * `dbFile` costuma estar em `<root>/apps/api/prisma/dev.db`; a pasta de
 * backups fica na raiz do projeto. Se `dbFile` mudar de lugar, apenas
 * este ponto precisa mudar.
 */
/**
 * Pasta de backups para um dado arquivo de banco.
 *
 * O layout do repositorio e `<repo>/apps/api/prisma/dev.db` com backups em
 * `<repo>/backups`, mas no app instalado o banco fica em
 * `%APPDATA%/WEB DISTRIBUIDORA/dev.db`. Subir sempre `../../..` colocava os
 * backups na pasta home do usuario (`C:/Users/<nome>/backups`), fora do
 * aplicativo. Por isso o layout e identificado pelo nome da pasta.
 */
export function backupsDirFor(dbFile: string): string {
  const dir = dirname(dbFile);

  if (basename(dir).toLowerCase() === 'prisma') {
    return join(resolve(dir, '../../..'), 'backups');
  }

  return join(dir, 'backups');
}
