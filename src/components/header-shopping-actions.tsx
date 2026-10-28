"use client";
import { CartIcon, HeartIcon, UserIcon } from "./icons";
import { NavLink } from "./nav-link";
import { useShoppingState } from "./shopping-state";
const countLabel = (count: number) => count > 99 ? "99+" : String(count);
export function HeaderShoppingActions() {
  const { ids, cartQuantity } = useShoppingState();
  return <nav className="header-actions" aria-label="Основная навигация">
    <NavLink href="/account/" aria-label="Личный кабинет" exact={false}><UserIcon aria-hidden="true" /><span className="header-action-label">Кабинет</span></NavLink>
    <NavLink href="/favorites/" aria-label={`Избранное: ${ids.length}`}><HeartIcon aria-hidden="true" />{ids.length > 0 && <span className="header-count" aria-hidden="true">{countLabel(ids.length)}</span>}<span className="header-action-label">Избранное</span></NavLink>
    <NavLink href="/cart/" aria-label={`Корзина: ${cartQuantity}`}><CartIcon aria-hidden="true" />{cartQuantity > 0 && <span className="header-count" aria-hidden="true">{countLabel(cartQuantity)}</span>}<span className="header-action-label">Корзина</span></NavLink>
  </nav>;
}
