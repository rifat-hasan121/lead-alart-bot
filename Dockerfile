FROM mcr.microsoft.com/playwright:v1.46.0-jammy

# Node.js 22 (LTS) ইনস্টল করা
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# ডিপেনডেন্সি ফাইল কপি
COPY package*.json ./

# প্যাকেজ ইনস্টল
RUN npm install

# প্রিজমা ও সোর্স ফাইল কপি
COPY prisma ./prisma/
COPY tsconfig.json ./
COPY src ./src/

# প্রিজমা ক্লায়েন্ট জেনারেট ও বিল্ড
RUN npx prisma generate
RUN npm run build

# প্রজেক্ট রান
CMD ["node", "dist/index.js"]