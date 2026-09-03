import 'dotenv/config';
import dns from 'dns';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import pg from 'pg';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

let prismaClient: PrismaClient;

if (globalForPrisma.prisma) {
  prismaClient = globalForPrisma.prisma;
} else {
  let dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
  // Strip channel_binding query params if present to prevent node-pg connection issues
  dbUrl = dbUrl.replace(/[\?&]channel_binding=[^&]+/g, '');

  if (dbUrl.startsWith('file:') || dbUrl.startsWith('sqlite:')) {
    const adapter = new PrismaBetterSqlite3({ url: dbUrl });
    prismaClient = new PrismaClient({ adapter });
  } else {
    const isCloudDb = dbUrl.includes('sslmode=') || dbUrl.includes('neon.tech') || dbUrl.includes('render.com') || dbUrl.includes('supabase');
    const pool = new pg.Pool({
      connectionString: dbUrl,
      ssl: isCloudDb ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
    });
    const adapter = new PrismaPg(pool);
    prismaClient = new PrismaClient({ adapter });
  }

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prismaClient;
  }
}

export const prisma = prismaClient;
