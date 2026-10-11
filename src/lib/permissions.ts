export const PERMISSIONS = {
  dashboardView: "dashboard.view",
  productsRead: "products.read",
  productsWrite: "products.write",
  productsPublish: "products.publish",
  contentWrite: "content.write",
  seoWrite: "seo.write",
  ordersRead: "orders.read",
  ordersWrite: "orders.write",
  customersRead: "customers.read",
  customersWrite: "customers.write",
  filesRead: "files.read",
  pricingWrite: "pricing.write",
  settingsWrite: "settings.write",
  usersWrite: "users.write",
  auditRead: "audit.read",
  monitoringRead: "monitoring.read",
  monitoringClear: "monitoring.clear",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
