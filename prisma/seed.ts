import { PrismaClient, ProductType, PublicationStatus } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

const permissionDefinitions = [
  ["dashboard.view", "Просмотр дашборда"],
  ["products.read", "Просмотр каталога"],
  ["products.write", "Редактирование каталога"],
  ["products.publish", "Публикация товаров"],
  ["content.write", "Редактирование контента"],
  ["seo.write", "Управление SEO"],
  ["orders.read", "Просмотр заказов"],
  ["orders.write", "Управление заказами"],
  ["customers.read", "Просмотр клиентов"],
  ["customers.write", "Удаление и восстановление клиентов"],
  ["files.read", "Доступ к моделям клиентов"],
  ["pricing.write", "Управление ценами"],
  ["settings.write", "Настройки магазина"],
  ["users.write", "Пользователи и роли"],
  ["audit.read", "Журнал аудита"],
] as const;

const roleDefinitions = [
  { code: "customer", name: "Покупатель", permissions: [] },
  { code: "content", name: "Контент-менеджер", permissions: ["dashboard.view", "products.read", "products.write", "content.write"] },
  { code: "seo", name: "SEO-специалист", permissions: ["dashboard.view", "products.read", "seo.write", "content.write", "audit.read"] },
  { code: "production", name: "Оператор производства", permissions: ["dashboard.view", "products.read", "orders.read", "orders.write", "files.read"] },
  { code: "sales", name: "Менеджер продаж", permissions: ["dashboard.view", "orders.read", "orders.write", "customers.read", "pricing.write"] },
  { code: "admin", name: "Администратор", permissions: permissionDefinitions.map(([code]) => code).filter((code) => code !== "users.write") },
  { code: "superadmin", name: "Суперадмин", permissions: permissionDefinitions.map(([code]) => code) },
];

async function seedAccess() {
  for (const [code, name] of permissionDefinitions) {
    await prisma.permission.upsert({ where: { code }, update: { name }, create: { code, name } });
  }
  for (const definition of roleDefinitions) {
    const role = await prisma.role.upsert({
      where: { code: definition.code },
      update: { name: definition.name },
      create: { code: definition.code, name: definition.name, isSystem: true },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (definition.permissions.length) {
      const permissions = await prisma.permission.findMany({ where: { code: { in: [...definition.permissions] } } });
      await prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })) });
    }
  }

  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@3dprinta.shop").toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "ChangeMe-3dprinta-2026";
  const admin = await prisma.user.upsert({
    where: { email },
    update: { isActive: true },
    create: { email, passwordHash: hashPassword(password), name: "Администратор 3DPRINTA", emailVerified: new Date() },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "superadmin" } });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: admin.id, roleId: role.id } }, update: {}, create: { userId: admin.id, roleId: role.id } });
}

async function seedCatalog() {
  const markerKey = "system.catalogSeeded";
  if (await prisma.siteSetting.findUnique({ where: { key: markerKey }, select: { id: true } })) return;

  // Existing catalogs belong to administrators. Mark them as initialized rather
  // than recreating removed defaults or overwriting edited lookup entries.
  const catalogCounts = await Promise.all([
    prisma.category.count(), prisma.material.count(), prisma.color.count(),
    prisma.technology.count(), prisma.qualityProfile.count(),
    prisma.postProcessOption.count(), prisma.product.count(),
  ]);
  if (catalogCounts.some((count) => count > 0)) {
    await prisma.siteSetting.create({ data: { key: markerKey, value: true, group: "system", label: "Каталог инициализирован" } });
    return;
  }

  const categories = [
    ["organizers", "Органайзеры", "Порядок на рабочем столе, в мастерской и дома", "/generated/product-organizer.webp"],
    ["fasteners", "Крепления", "Кронштейны, адаптеры и точные технические детали", "/generated/product-mount.webp"],
    ["decor", "Декор", "Фактуры и формы, созданные послойно", "/generated/product-lamp.webp"],
    ["prototypes", "Прототипы", "Функциональные образцы перед запуском серии", "/generated/product-enclosure.webp"],
  ] as const;
  for (const [slug, name, description, image] of categories) {
    await prisma.category.upsert({
      where: { slug },
      update: { name, description, image, visible: true, title: `${name} на заказ` },
      create: { slug, name, h1: name, title: `${name} на заказ`, metaDescription: `${description}. 3D-печать с доставкой по России.`, description, image, visible: true },
    });
  }

  const materials = [
    { slug: "pla", name: "PLA", type: "пластик", density: 1.24, pricePerGram: 7.5, temperature: "до 55 °C", advantages: "точность, экологичность, насыщенные цвета", disadvantages: "не для высокой температуры", description: "Универсальный биопластик для декора, макетов и деталей без высокой тепловой нагрузки." },
    { slug: "petg", name: "PETG", type: "пластик", density: 1.27, pricePerGram: 9.5, temperature: "до 75 °C", advantages: "прочность, влагостойкость, химическая стойкость", disadvantages: "менее резкие мосты", description: "Практичный материал для креплений, корпусов и функциональных деталей." },
    { slug: "abs", name: "ABS", type: "пластик", density: 1.04, pricePerGram: 10.5, temperature: "до 95 °C", advantages: "термостойкость, ударная прочность, обработка", disadvantages: "усадка при печати", description: "Инженерный пластик для нагруженных деталей и корпусов." },
    { slug: "nylon", name: "Nylon PA", type: "пластик", density: 1.14, pricePerGram: 18, temperature: "до 110 °C", advantages: "износостойкость, гибкость, ударная прочность", disadvantages: "впитывает влагу", description: "Материал для шестерён, защёлок и деталей с циклической нагрузкой." },
  ];
  for (const material of materials) await prisma.material.upsert({ where: { slug: material.slug }, update: material, create: material });

  const colors = [
    { slug: "graphite", name: "Графит", hex: "#35383f" },
    { slug: "signal-orange", name: "Сигнальный оранжевый", hex: "#ff6a2a" },
    { slug: "warm-white", name: "Тёплый белый", hex: "#f1ede2" },
    { slug: "cobalt", name: "Кобальт", hex: "#315ee7" },
    { slug: "forest", name: "Лесной", hex: "#2e6b53" },
  ];
  for (const color of colors) await prisma.color.upsert({ where: { slug: color.slug }, update: color, create: color });

  for (const materialSlug of materials.map(({ slug }) => slug)) {
    await prisma.material.update({ where: { slug: materialSlug }, data: { colors: { set: colors.map(({ slug }) => ({ slug })) } } });
  }

  const technologies = [
    { slug: "fdm", name: "FDM/FFF", accuracy: "от ±0,2 мм", applications: "корпуса, крепления, прототипы, декор", description: "Послойное наплавление пластика — быстрый и экономичный способ получить функциональную деталь." },
    { slug: "sla", name: "SLA/MSLA", accuracy: "от ±0,05 мм", applications: "миниатюры, мастер-модели, мелкая механика", description: "Фотополимерная печать для высокой детализации и гладкой поверхности." },
  ];
  for (const technology of technologies) await prisma.technology.upsert({ where: { slug: technology.slug }, update: technology, create: technology });

  const qualityProfiles = [
    { slug: "draft", name: "Draft", layerHeightMm: 0.28, speedMultiplier: 0.75, priceMultiplier: 0.9, description: "Быстрый прототип и проверка габаритов" },
    { slug: "standard", name: "Standard", layerHeightMm: 0.2, speedMultiplier: 1, priceMultiplier: 1, description: "Баланс качества, прочности и цены" },
    { slug: "fine", name: "Fine", layerHeightMm: 0.12, speedMultiplier: 1.65, priceMultiplier: 1.45, description: "Тонкий слой для видимых деталей" },
  ];
  for (const profile of qualityProfiles) await prisma.qualityProfile.upsert({ where: { slug: profile.slug }, update: profile, create: profile });

  const postProcesses = [
    { slug: "support-removal", name: "Снятие поддержек", price: 0, leadDays: 0, description: "Включено в базовую подготовку" },
    { slug: "sanding", name: "Шлифовка", price: 450, leadDays: 1, description: "Ручная обработка видимых поверхностей" },
    { slug: "painting", name: "Покраска", price: 1200, leadDays: 3, description: "Грунт и окраска в согласованный цвет" },
  ];
  for (const option of postProcesses) await prisma.postProcessOption.upsert({ where: { slug: option.slug }, update: option, create: option });

  const products = [
    { slug: "modular-desk-organizer", sku: "ORG-MOD-01", name: "Модульный органайзер Axis", category: "organizers", type: ProductType.READY, basePrice: 1290, oldPrice: 1490, stock: 18, badge: "Хит", image: "/generated/product-organizer.webp", shortDescription: "Система лотков, которую можно наращивать под рабочее место.", dimensions: [180, 105, 42], material: "pla" },
    { slug: "headphone-stand-arc", sku: "ORG-ARC-02", name: "Подставка для наушников Arc", category: "organizers", type: ProductType.READY, basePrice: 1890, stock: 7, badge: "Новинка", image: "/generated/product-headphone-stand.webp", shortDescription: "Устойчивая геометрия и скрытый канал для кабеля.", dimensions: [145, 110, 255], material: "petg" },
    { slug: "gopro-universal-mount", sku: "FIX-GP-03", name: "Универсальное крепление GoPro", category: "fasteners", type: ProductType.PARAMETRIC, basePrice: 790, stock: 0, badge: "Под заказ", image: "/generated/product-mount.webp", shortDescription: "Адаптер с выбором угла, длины плеча и типа основания.", dimensions: [68, 34, 22], material: "petg" },
    { slug: "voronoi-lamp", sku: "DEC-VOR-04", name: "Светильник Voronoi", category: "decor", type: ProductType.READY, basePrice: 3490, stock: 4, badge: "Хит", image: "/generated/product-lamp.webp", shortDescription: "Мягкий свет сквозь органическую ячеистую структуру.", dimensions: [160, 160, 245], material: "pla" },
    { slug: "electronics-enclosure", sku: "PRO-BOX-05", name: "Корпус электроники Prototype Box", category: "prototypes", type: ProductType.PARAMETRIC, basePrice: 2190, stock: 0, badge: "Под заказ", image: "/generated/product-enclosure.webp", shortDescription: "Корпус по вашим габаритам с окнами, стойками и вентиляцией.", dimensions: [120, 80, 40], material: "abs" },

  ];
  for (const item of products) {
    const [widthMm, depthMm, heightMm] = item.dimensions;
    const product = await prisma.product.create({
      data: {
        name: item.name,
        slug: item.slug,
        sku: item.sku,
        type: item.type,
        status: PublicationStatus.PUBLISHED,
        badge: item.badge,
        shortDescription: item.shortDescription,
        description: `${item.shortDescription} Изделие печатается с контролем геометрии и качества каждого слоя. Параметры можно согласовать перед производством.`,
        usage: "Для дома, мастерской, офиса и малосерийного производства.",
        instructions: "Не размещать рядом с открытым огнём. Уход — мягкая влажная ткань.",
        specifications: { technology: "FDM", layer: "0,2 мм", tolerance: "±0,3 мм" },
        basePrice: item.basePrice,
        oldPrice: item.oldPrice,
        stock: item.stock,
        madeToOrder: item.stock === 0,
        leadDays: item.stock === 0 ? 4 : 1,
        widthMm,
        depthMm,
        heightMm,
        title: `${item.name} — купить с доставкой`,
        metaDescription: `${item.shortDescription} Производство 3DPRINTA, доставка по России.`,
        h1: item.name,
        publishedAt: new Date(),
      },
    });
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: item.category } });
    await prisma.productCategory.upsert({
      where: { productId_categoryId: { productId: product.id, categoryId: category.id } },
      update: { isPrimary: true },
      create: { productId: product.id, categoryId: category.id, isPrimary: true },
    });
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    await prisma.productImage.create({ data: { productId: product.id, path: item.image, alt: `${item.name}, изделие 3D-печати`, sortOrder: 0, width: 1200, height: 1200 } });
    await prisma.product.update({
      where: { id: product.id },
      data: {
        materials: { set: [{ slug: item.material }, { slug: "pla" }, { slug: "petg" }] },
        colors: { set: colors.map(({ slug }) => ({ slug })) },
        technologies: { set: [{ slug: "fdm" }] },
        qualityProfiles: { set: qualityProfiles.map(({ slug }) => ({ slug })) },
        postProcesses: { set: postProcesses.map(({ slug }) => ({ slug })) },
      },
    });
  }

  await prisma.siteSetting.create({ data: { key: markerKey, value: true, group: "system", label: "Каталог инициализирован" } });
}

async function seedContent() {
  const rubric = await prisma.rubric.upsert({ where: { slug: "guides" }, update: { name: "Гайды" }, create: { slug: "guides", name: "Гайды", description: "Практические материалы о 3D-печати" } });
  const articles = [
    { slug: "pla-ili-petg", title: "PLA или PETG: что выбрать для вашей детали", excerpt: "Сравниваем прочность, температуру, внешний вид и стоимость двух популярных пластиков.", content: "PLA лучше подходит для макетов, декора и интерьерных деталей. PETG выбирают для креплений, корпусов и изделий, которые контактируют с влагой. При выборе важны не только прочность, но и температура эксплуатации, точность посадок и требуемая обработка." },
  ];
  for (const article of articles) {
    await prisma.article.upsert({
      where: { slug: article.slug },
      update: { ...article, metaTitle: article.title, status: PublicationStatus.PUBLISHED },
      create: { ...article, rubricId: rubric.id, status: PublicationStatus.PUBLISHED, authorName: "Команда 3DPRINTA", h1: article.title, metaTitle: article.title, metaDescription: article.excerpt, publishedAt: new Date() },
    });
  }

  const faq = [
    ["Доставляете по России?", "Да, отправляем СДЭК или Почтой России. Для вашего города стоимость показывается при оформлении."],
  ];
  if (!await prisma.faqItem.count({ where: { scope: "general" } })) await prisma.faqItem.createMany({ data: faq.map(([question, answer], sortOrder) => ({ question, answer, sortOrder, scope: "general" })) });

  const settings = [
    ["site.name", "3DPRINTA", "general", "Название"],
    ["site.domain", "https://3dprinta.shop", "general", "Домен"],
    ["site.tagline", "Печатаем идеи в точных деталях", "general", "Слоган"],
    ["contacts.phone", "", "contacts", "Телефон"],
    ["contacts.email", "", "contacts", "Email"],
    ["contacts.city", "Россия", "contacts", "География"],
    ["contacts.address", "", "contacts", "Адрес самовывоза"],
    ["contacts.hours", "", "contacts", "Часы работы"],
    ["legal.seller", "", "legal", "Наименование продавца"],
    ["legal.inn", "", "legal", "ИНН"],
    ["legal.ogrn", "", "legal", "ОГРН / ОГРНИП"],
    ["legal.address", "", "legal", "Юридический адрес"],
    ["legal.bank", "", "legal", "Банковские реквизиты"],
    ["store.about", "", "general", "О магазине — подтверждённые факты"],
    ["analytics.yandexMetrika", "", "analytics", "Яндекс Метрика"],
    ["analytics.ga4", "", "analytics", "Google Analytics"],
    ["cookie.message", "Мы используем необходимые cookies для работы корзины и личного кабинета.", "legal", "Cookie-баннер"],
  ] as const;
  for (const [key, value, group, label] of settings) {
    await prisma.siteSetting.upsert({ where: { key }, update: { group, label }, create: { key, value, group, label } });
  }

  const priceRules = [
    ["minimum_order", "Минимальная стоимость заказа", 650, "RUB"],
    ["setup_fee", "Подготовка задания", 250, "RUB"],
    ["machine_hour", "Машино-час FDM", 120, "RUB/hour"],
  ] as const;
  for (const [code, name, value, unit] of priceRules) await prisma.priceRule.upsert({ where: { code }, update: {}, create: { code, name, value, unit } });

  const deliveryMethods = [
    ["cdek", "СДЭК", "До пункта выдачи или курьером", 490],
    ["russian-post", "Почта России", "Посылка с отслеживанием", 390],
    ["pickup", "Самовывоз", "По предварительному согласованию", 0],
  ] as const;
  // Do not reset active/deletedAt: removed defaults must stay removed on every deploy.
  for (const [code, name, description, basePrice] of deliveryMethods) await prisma.deliveryMethod.upsert({ where: { code }, update: {}, create: { code, name, description, basePrice } });

  const seoPages = [
    ["/", "Каталог изделий 3DPRINTA", "Интернет-магазин изделий с выбором материала и цвета.", "Каталог изделий"],
    ["/catalog/", "Каталог изделий 3D-печати", "Готовые органайзеры, крепления, декор и прототипы. Выбор материала и цвета.", "Каталог изделий"],
  ] as const;
  for (const [path, title, metaDescription, h1] of seoPages) await prisma.seoPage.upsert({ where: { path }, update: { title, metaDescription, h1 }, create: { path, title, metaDescription, h1, schemaTypes: path === "/" ? ["Organization", "WebSite", "FAQPage"] : ["BreadcrumbList"] } });
}

async function main() {
  await seedAccess();
  await seedCatalog();
  await seedContent();
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
