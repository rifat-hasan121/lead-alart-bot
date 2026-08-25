FROM mcr.microsoft.com/playwright:v1.46.0-jammy

# Set working directory
WORKDIR /usr/src/app

# Copy dependency definitions and optional files
COPY package*.json tsconfig.json cookies.json* ./

# Install packages clean
RUN npm ci

# Copy source configurations and prisma schema
COPY prisma ./prisma/
COPY src ./src/

# Generate Prisma Client and compile TypeScript
RUN npx prisma generate
RUN npm run build

# Run the compiled bot in production
CMD ["node", "dist/index.js"]
