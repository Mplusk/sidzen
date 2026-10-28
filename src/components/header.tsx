import { Logo } from "@/components/logo";
import { HeaderShoppingActions } from "@/components/header-shopping-actions";
import { CatalogSearchInput } from "@/components/catalog-search-input";
import { CatalogMenu } from "@/components/catalog-menu";
import { getCatalogMenuCategories } from "@/lib/catalog";

export async function Header() {
  const categories = await getCatalogMenuCategories();
  return (
    <header className="site-header">
      <div className="utility-bar">
        <div className="container utility-bar__inner">
          <span>Формы природы. Предметы для дома. Доставка по России.</span>
        </div>
      </div>
      <CatalogMenu categories={categories} logo={<Logo />} search={<CatalogSearchInput />} actions={
        <HeaderShoppingActions />
      } />
    </header>
  );
}
