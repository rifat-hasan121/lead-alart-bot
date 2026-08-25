FROM mcr.microsoft.com/playwright:v1.46.0-jammy

# Set working directory
WORKDIR /usr/src/app

# 1. Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# 2. Copy prisma configuration & schema and generate Prisma Client
COPY prisma.config.ts ./
COPY prisma ./prisma/
RUN npx prisma generate

# 3. Copy all remaining source/config files
COPY tsconfig.json ./
COPY cookies.json* ./
COPY src ./src/

# 4. Build TypeScript application
RUN npm run build

# 5. Run the compiled bot in production
CMD ["node", "dist/index.js"]
