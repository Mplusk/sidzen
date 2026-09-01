"use client";

import { useMemo, useState } from "react";
import { addModelToCart } from "@/app/actions/cart";
import { UploadIcon } from "@/components/icons";
import { formatPrice } from "@/lib/format";
import { calculatePrintQuote } from "@/lib/pricing";

type Material = { slug: string; name: string; density: number; pricePerGram: number; colors: { slug: string; name: string; hex: string }[] };
type Quality = { slug: string; name: string; layerHeightMm: number; priceMultiplier: number };
type PostProcess = { slug: string; name: string; price: number };
type UploadedFile = { id: string; originalName: string; sizeBytes: number; widthMm: number | null; heightMm: number | null; depthMm: number | null; volumeCm3: number | null; watertight: boolean | null; status: string; analysisNote: string | null };

export function ModelConfigurator({ materials, qualities, postProcesses, minimumOrder, setupFee }: { materials: Material[]; qualities: Quality[]; postProcesses: PostProcess[]; minimumOrder: number; setupFee: number }) {
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [materialSlug, setMaterialSlug] = useState(materials[0]?.slug ?? "pla");
  const [colorSlug, setColorSlug] = useState(materials[0]?.colors[0]?.slug ?? "");
  const [qualitySlug, setQualitySlug] = useState(qualities.find((item) => item.slug === "standard")?.slug ?? qualities[0]?.slug ?? "standard");
  const [postSlug, setPostSlug] = useState(postProcesses[0]?.slug ?? "support-removal");
  const [infill, setInfill] = useState(20);
  const [quantity, setQuantity] = useState(1);
  const [scale, setScale] = useState(1);
  const material = materials.find((item) => item.slug === materialSlug) ?? materials[0];
  const quality = qualities.find((item) => item.slug === qualitySlug) ?? qualities[0];
  const post = postProcesses.find((item) => item.slug === postSlug) ?? postProcesses[0];
  const quote = useMemo(() => file && material && quality && post ? calculatePrintQuote({ volumeCm3: file.volumeCm3 ?? (((file.widthMm ?? 50) * (file.heightMm ?? 50) * (file.depthMm ?? 50)) / 1000) * .28, densityGcm3: material.density, materialPricePerGram: material.pricePerGram, infillPercent: infill, qualityMultiplier: quality.priceMultiplier, postProcessingPrice: post.price, quantity, minimumOrder, setupFee, scale }) : null, [file, material, quality, post, infill, quantity, minimumOrder, setupFee, scale]);

  async function upload(selected: File) {
    setUploading(true);
    setError("");
    try {
      const data = new FormData();
      data.set("file", selected);
      const response = await fetch("/api/model/upload", { method: "POST", body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить файл");
      setFile(result.file);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Не удалось загрузить файл");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="configurator">
      <div className="configurator__panel">
        <span className="eyebrow">Конфигуратор</span><h2>1. Загрузите модель</h2>
        <label className="upload-zone"><input type="file" accept=".stl,.obj,.3mf,.step,.stp" disabled={uploading} onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void upload(selected); }} /><div><UploadIcon /><strong>{uploading ? "Анализируем модель…" : file ? file.originalName : "Перетащите файл или нажмите для выбора"}</strong><small>STL, OBJ, 3MF, STEP · до 100 МБ · файл не публикуется</small></div></label>
        {error && <p className="notice notice--danger" style={{ marginTop: 16 }}>{error}</p>}
        {file && <div className={file.watertight === false ? "notice" : "notice notice--success"} style={{ marginTop: 16 }}><strong>{file.watertight === false ? "Нужна проверка оператора" : "Модель проанализирована"}</strong><br />Габариты: {file.widthMm ?? "—"} × {file.depthMm ?? "—"} × {file.heightMm ?? "—"} мм · объём: {file.volumeCm3 ?? "—"} см³{file.analysisNote ? <><br />{file.analysisNote}</> : null}</div>}
        <h2 style={{ marginTop: 46 }}>2. Настройте печать</h2>
        <div className="form-grid">
          <label className="field"><span>Материал</span><select value={materialSlug} onChange={(event) => { const nextMaterial = materials.find((item) => item.slug === event.target.value); setMaterialSlug(event.target.value); setColorSlug(nextMaterial?.colors[0]?.slug ?? ""); }}>{materials.map((item) => <option key={item.slug} value={item.slug}>{item.name} · {item.pricePerGram} ₽/г</option>)}</select></label>
          <label className="field"><span>Цвет</span><select id="model-color" value={colorSlug} onChange={(event) => setColorSlug(event.target.value)}>{material?.colors.map((color) => <option key={color.slug} value={color.slug}>{color.name}</option>)}</select></label>
          <label className="field"><span>Качество</span><select value={qualitySlug} onChange={(event) => setQualitySlug(event.target.value)}>{qualities.map((item) => <option key={item.slug} value={item.slug}>{item.name} · слой {item.layerHeightMm} мм</option>)}</select></label>
          <label className="field"><span>Постобработка</span><select value={postSlug} onChange={(event) => setPostSlug(event.target.value)}>{postProcesses.map((item) => <option key={item.slug} value={item.slug}>{item.name}{item.price ? ` · +${item.price} ₽` : ""}</option>)}</select></label>
          <label className="field"><span className="range-output">Заполнение <strong>{infill}%</strong></span><input type="range" min="10" max="100" step="5" value={infill} onChange={(event) => setInfill(Number(event.target.value))} /></label>
          <label className="field"><span className="range-output">Масштаб <strong>{Math.round(scale * 100)}%</strong></span><input type="range" min="0.5" max="2" step="0.05" value={scale} onChange={(event) => setScale(Number(event.target.value))} /></label>
          <label className="field"><span>Количество</span><input type="number" min="1" max="999" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))} /></label>
        </div>
      </div>
      <aside className="configurator__summary"><span className="eyebrow">Предварительный расчёт</span><h2>{quote ? formatPrice(quote.total) : "Загрузите файл"}</h2><ul className="summary-list"><li><span>Габариты</span><strong>{file ? `${Math.round((file.widthMm ?? 0) * scale)} × ${Math.round((file.depthMm ?? 0) * scale)} × ${Math.round((file.heightMm ?? 0) * scale)} мм` : "—"}</strong></li><li><span>Примерный вес</span><strong>{quote ? `${quote.estimatedWeightGrams} г` : "—"}</strong></li><li><span>Время печати</span><strong>{quote ? `≈ ${quote.estimatedPrintHours} ч` : "—"}</strong></li><li><span>Цена за штуку</span><strong>{quote ? formatPrice(quote.unitPrice) : "—"}</strong></li><li><span>Количество</span><strong>{quantity}</strong></li></ul><p style={{ color: "#bac5d3", fontSize: ".82rem" }}>Расчёт ориентировочный. Оператор проверит толщины стенок, нависания и способ расположения на столе.</p>
        <form action={addModelToCart}><input type="hidden" name="modelFileId" value={file?.id ?? ""} /><input type="hidden" name="material" value={materialSlug} /><input type="hidden" name="color" value={colorSlug} /><input type="hidden" name="quality" value={qualitySlug} /><input type="hidden" name="postProcessing" value={postSlug} /><input type="hidden" name="infill" value={infill} /><input type="hidden" name="scale" value={scale} /><input type="hidden" name="quantity" value={quantity} /><button className="button button--light" style={{ width: "100%" }} type="submit" disabled={!file}>Добавить расчёт в корзину</button></form>
      </aside>
    </div>
  );
}
