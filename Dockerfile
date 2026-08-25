FROM mcr.microsoft.com/playwright:v1.46.0-jammy

# Set working directory
WORKDIR /usr/src/app

# Copy dependency definitions
COPY package*.json ./

# Install packages clean
RUN npm ci

# Copy source configurations and prisma schema
COPY prisma ./prisma/
COPY tsconfig.json ./
COPY src ./src/

# Compile TypeScript and generate Prisma Client
RUN npm run build
RUN npx prisma generate

# Run the compiled bot in production
CMD ["node", "dist/index.js"]
