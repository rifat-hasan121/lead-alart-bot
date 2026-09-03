import { prisma } from "../src/db/prisma.js";

async function main() {
  console.log("Seeding keywords...");

  const roleKeywords = [
    // Bengali
    "ওয়েবসাইট",
    "ওয়েব সাইট",
    "ওয়েব ডেভেলপার",
    "ডেভেলপার",
    "সাইট",
    "ফ্রন্টএন্ড",
    "ব্যাকএন্ড",
    "ফুলস্ট্যাক",
    "ল্যান্ডিং পেজ",
    "ই-কমার্স",
    "অনলাইন শপ",
    "পোর্টাল",
    "ওয়ার্ডপ্রেস",
    "রিঅ্যাক্ট",
    "ওয়েব ডিজাইন",
    "রিডিজাইন",
    "ওয়েব এপ্লিকেশন",
    "বাগ ফিক্স",
    // English/Banglish
    "website",
    "web site",
    "web developer",
    "developer",
    "dev",
    "frontend",
    "front-end",
    "backend",
    "back-end",
    "fullstack",
    "full stack",
    "landing page",
    "ecommerce",
    "e-commerce",
    "online store",
    "wordpress",
    "react",
    "nextjs",
    "laravel",
    "shopify",
    "elementor",
    "web design",
    "redesign",
    "web app",
    "web development",
    "ui to code",
    "figma to html",
    "figma to react",
    "bug fix",
    "custom website",
  ];

  const intentKeywords = [
    // Bengali
    "লাগবে",
    "খুঁজছি",
    "চাই",
    "দরকার",
    "চাচ্ছিলাম",
    "করতে হবে",
    "বানিয়ে দিতে হবে",
    "বানাতে চাই",
    "বানাতে পারি এমন কেউ",
    "তৈরি করতে চাই",
    "হায়ার করতে চাই",
    "ইনবক্স করুন",
    "ইনবক্স দিন",
    "ইনবক্সে আসেন",
    "বাজেট কত",
    "প্রাইস কত",
    "খরচ কেমন হবে",
    "পোর্টফোলিও দিন",
    "ডেমো দিন",
    "কোটেশন দিন",
    "প্রস্তাব পাঠান",
    "কে কে পারেন",
    // English/Banglish
    "needed",
    "need",
    "looking for",
    "hiring",
    "hire",
    "require",
    "required",
    "urgent",
    "urgently needed",
    "dm me",
    "inbox me",
    "send portfolio",
    "send cv",
    "drop portfolio",
    "quote please",
    "budget",
    "lagbe",
    "khujchi",
    "chai",
    "chacchilam",
    "dorkar",
    "banate chai",
    "kore dite parben",
    "kew ki achen",
    "keu ki paren",
    "inbox koren",
    "dm koren",
  ];

  const negativeKeywords = [
    // English & Banglish Freelancer/Agency Provider phrases
    "i am a web developer",
    "i am a developer",
    "i am web developer",
    "i am developer",
    "ami web developer",
    "ami developer",
    "ami website banai",
    "ami website banaye",
    "amra website banai",
    "jara website banate chan",
    "jara website banaben",
    "i will build",
    "i'll build",
    "i build",
    "we build",
    "we develop",
    "available for work",
    "offering service",
    "hire me",
    "service available",
    "inbox me for service",
    "inbox for order",
    "dm for order",
    "contact for service",
    "feel free to inbox",
    "feel free to message",
    "providing service",
    "we provide",
    "i provide",
    "i create",
    "our team",
    "my portfolio",
    "our portfolio",
    "amar portfolio",
    "amar service",
    "special offer",
    "discount offer",
    "cheap price",
    // Bengali Provider phrases
    "আমি ডেভেলপার",
    "আমি ওয়েব ডেভেলপার",
    "আমি ওয়েবসাইট বানিয়ে দেই",
    "আমি ওয়েবসাইট বানাই",
    "আমরা ওয়েবসাইট বানিয়ে থাকি",
    "কাজ খুঁজছি",
    "অফার চলছে",
    "ডিসকাউন্ট চলছে",
    "যাঁরা ওয়েবসাইট বানাতে চান",
    "ইনবক্স করুন অর্ডারের জন্য",
    "আমাদের সার্ভিস",
    "আমার পোর্টফোলিও",
    "কম খরচে",
    "অফারে",
    "প্যাকেজ",
  ];

  const allKeywords = [
    ...roleKeywords.map((phrase) => ({ phrase, type: "role" })),
    ...intentKeywords.map((phrase) => ({ phrase, type: "intent" })),
    ...negativeKeywords.map((phrase) => ({ phrase, type: "negative" })),
  ];

  for (const item of allKeywords) {
    await prisma.keyword.upsert({
      where: { phrase: item.phrase },
      update: { type: item.type, isActive: true },
      create: { phrase: item.phrase, type: item.type, isActive: true },
    });
  }

  console.log("Seeding sample monitored groups...");
  const sampleGroups = [
    {
      name: "Find Web Developer BD",
      groupUrl: "https://www.facebook.com/groups/findwebdeveloperbd",
    },
    {
      name: "Web Design & Development Bangladesh",
      groupUrl:
        "https://www.facebook.com/groups/webdesigndevelopmentbangladesh.official/",
    },
    {
      name: "Web Design & App Development",
      groupUrl: "https://www.facebook.com/groups/1292149266080746/",
    },
    {
      name: "Web Design & App Development",
      groupUrl: "https://www.facebook.com/groups/webandappdeveloperbd/",
    },
    {
      name: "Web Developer Bangladesh",
      groupUrl: "https://www.facebook.com/groups/WebDBD/",
    },
    {
      name: "Web Design & Development",
      groupUrl: "https://www.facebook.com/groups/webdad/",
    },
    {
      name: "WEB DESIGNER AND DEVELOPER GROUP BANGLADESH",
      groupUrl: "https://www.facebook.com/groups/webdeveloperbd//",
    },
  ];

  for (const group of sampleGroups) {
    await prisma.monitoredGroup.upsert({
      where: { groupUrl: group.groupUrl },
      update: { name: group.name, isActive: true }, // এখানেও isActive: true নিশ্চিত করা হলো
      create: {
        name: group.name,
        groupUrl: group.groupUrl,
        isActive: true,
      },
    });
  }

  console.log("Database seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
