"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { MAX_PRODUCT_IMAGES, serializeGallery } from "@/lib/product-admin";

type SavedImage = { path: string; alt: string; caption?: string | null };
type EditorImage = SavedImage & { key: string; file?: File };
const acceptedTypes = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export function AdminProductImages({ initialImages }: { initialImages: SavedImage[] }) {
  const [images, setImages] = useState<EditorImage[]>(() => initialImages.map((image, index) => ({ ...image, key: `saved-${index}` })));
  const [error, setError] = useState("");
  const uploadInput = useRef<HTMLInputElement>(null);
  const objectUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function update(next: EditorImage[]) {
    const transfer = new DataTransfer();
    next.forEach((image) => { if (image.file) transfer.items.add(image.file); });
    if (uploadInput.current) uploadInput.current.files = transfer.files;
    setImages(next);
  }

  function addFiles(files: File[]) {
    if (images.length + files.length > MAX_PRODUCT_IMAGES) { setError(`В галерее может быть до ${MAX_PRODUCT_IMAGES} фотографий.`); return; }
    if (images.filter((image) => image.file).length + files.length > 10) { setError("За одно сохранение можно загрузить до 10 новых фотографий."); return; }
    if (files.some((file) => !acceptedTypes.includes(file.type) || file.size > 10 * 1024 * 1024 || !file.size)) { setError("Выберите JPG, PNG, WebP или AVIF размером до 10 МБ каждый."); return; }
    setError("");
    update([...images, ...files.map((file) => {
      const path = URL.createObjectURL(file);
      objectUrls.current.add(path);
      return { key: path, path, alt: "", caption: "", file };
    })]);
  }

  function move(index: number, to: number) {
    const next = [...images];
    const [image] = next.splice(index, 1);
    next.splice(to, 0, image);
    update(next);
  }

  const saved = images.filter((image) => !image.file);
  const uploaded = images.filter((image) => image.file);
  const layout = images.map((image) => ({ index: image.file ? saved.length + uploaded.indexOf(image) : saved.indexOf(image), alt: image.alt, caption: image.caption ?? "" }));

  return <div className="admin-image-manager">
    <input type="hidden" name="imagesText" value={serializeGallery(saved)} />
    <input type="hidden" name="imageLayout" value={JSON.stringify(layout)} />
    <input ref={uploadInput} type="file" name="newImages" multiple hidden aria-hidden="true" tabIndex={-1} />
    <label className="image-upload-field" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(Array.from(event.dataTransfer.files)); }}>
      <strong>Добавить фотографии</strong>
      <span>Выберите сразу несколько файлов или перетащите их сюда</span>
      <input type="file" accept={acceptedTypes.join(",")} multiple onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} aria-label="Добавить фотографии товара" />
      <small>До 10 новых фото за сохранение, до {MAX_PRODUCT_IMAGES} в галерее. JPG, PNG, WebP, AVIF — до 10 МБ каждый.</small>
    </label>
    {error && <p className="notice" role="alert">{error}</p>}
    <p className="gallery-editor-hint" aria-live="polite">{images.length ? `${images.length} фото. Первое — обложка товара. Изменения применятся после сохранения товара.` : "Фотографии пока не добавлены."}</p>
    <div className="admin-image-grid">
      {images.map((image, index) => <div className="admin-image-tile" key={image.key}>
        <div className="admin-image-tile__photo"><Image src={image.path} alt={image.alt || `Фото ${index + 1}`} fill sizes="220px" unoptimized={Boolean(image.file)} />{index === 0 && <span className="badge">Главное фото</span>}</div>
        {image.file && <small className="admin-image-filename" title={image.file.name}>{image.file.name} · новое</small>}
        <label className="field"><span>Описание фото {index + 1}</span><input value={image.alt} maxLength={250} placeholder="Например, вид сбоку" onChange={(event) => update(images.map((item) => item.key === image.key ? { ...item, alt: event.target.value.replace(/[|\r\n]/g, " ") } : item))} /></label>
        <label className="field"><span>Подпись</span><input value={image.caption ?? ""} maxLength={500} onChange={(event) => update(images.map((item) => item.key === image.key ? { ...item, caption: event.target.value.replace(/[\r\n]/g, " ") } : item))} /></label>
        <div className="admin-image-tile__actions">
          <button type="button" disabled={index === 0} onClick={() => move(index, index - 1)} aria-label={`Переместить фото ${index + 1} раньше`}>←</button>
          <button type="button" disabled={index === images.length - 1} onClick={() => move(index, index + 1)} aria-label={`Переместить фото ${index + 1} позже`}>→</button>
          <button type="button" disabled={index === 0} onClick={() => move(index, 0)}>На обложку</button>
          <button type="button" className="admin-delete-link" aria-label={`Удалить фото ${index + 1}`} onClick={() => {
            update(images.filter((item) => item.key !== image.key));
            if (image.file) { URL.revokeObjectURL(image.path); objectUrls.current.delete(image.path); }
            setError("");
          }}>Удалить</button>
        </div>
      </div>)}
    </div>
  </div>;
}
