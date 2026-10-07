"use client";
import { useState } from "react";
import Link from "next/link";

export function ProductCategoryControl({ categories, initialCategoryId, initialMode, aiReady }: { categories: Array<{ id: string; name: string }>; initialCategoryId: string; initialMode: string; aiReady: boolean }) {
  const [mode, setMode] = useState(initialMode);
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  return <>
    <label className="field"><span>Категоризация</span><select name="categoryMode" value={mode} onChange={event => setMode(event.target.value)}><option value="MANUAL">Вручную · не менять через ИИ</option><option value="AI" disabled={!aiReady}>Автоматически · DeepSeek</option></select></label>
    <label className="field"><span>Основная категория{mode === "MANUAL" ? " *" : ""}</span><select name="primaryCategoryId" value={categoryId} required={mode === "MANUAL"} onChange={event => { setCategoryId(event.target.value); setMode("MANUAL"); }}><option value="">{mode === "AI" ? "Определить после сохранения товара" : "Выберите категорию"}</option>{categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
    <p className="field--full muted" role="status">{mode === "AI" ? "После сохранения DeepSeek определит основную категорию в фоне. Сохраните новый товар как черновик и обновите страницу после обработки. Любой ручной выбор выключит ИИ для этого товара. Повторный выбор режима DeepSeek и сохранение запускают новый расчёт." : "Выбранная категория защищена от автоматической категоризации. Для пересчёта выберите режим DeepSeek и сохраните товар."} {!aiReady && <Link className="text-link" href="/account/integrations/#category-ai">Подключить DeepSeek в ЛК →</Link>}</p>
  </>;
}
