import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

let prismaClient: PrismaClient;

if (globalForPrisma.prisma) {
  prismaClient = globalForPrisma.prisma;
} else {
  const dbUrl = process.env.DATABASE_URL || '';
  const isCloudDb = dbUrl.includes('sslmode=') || dbUrl.includes('neon.tech') || dbUrl.includes('render.com') || dbUrl.includes('supabase');
  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: isCloudDb ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
  });
  const adapter = new PrismaPg(pool);
  prismaClient = new PrismaClient({ adapter });
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prismaClient;
  }
}

export const prisma = prismaClient;
