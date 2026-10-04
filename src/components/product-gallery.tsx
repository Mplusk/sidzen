"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowIcon } from "@/components/icons";

type GalleryImage = { path: string; alt: string; caption?: string | null; width?: number | null; height?: number | null };

export function ProductGallery({ images, name, badge, href, compact = false }: {
  images: GalleryImage[];
  name: string;
  badge?: string | null;
  href?: string;
  compact?: boolean;
}) {
  const [active, setActive] = useState(0);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const current = images[active] ?? images[0];
  const ratio = current?.width && current.height ? current.width / current.height : current ? ratios[current.path] : undefined;
  const change = (step: number) => setActive((index) => (index + step + images.length) % images.length);
  const photo = current ? <Image src={current.path} alt={`${current.alt || name} — фото ${active + 1}`} fill preload={!compact && active === 0} sizes={compact ? "(max-width: 600px) 48vw, (max-width: 900px) 32vw, (max-width: 1200px) 24vw, (max-width: 1600px) 19vw, 250px" : "(max-width: 700px) 94vw, (max-width: 1200px) 45vw, 480px"} onLoad={compact ? undefined : (event) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) setRatios((values) => ({ ...values, [current.path]: image.naturalWidth / image.naturalHeight }));
  }} /> : <span className="image-placeholder">3D</span>;

  return <div className={`product-gallery${compact ? " product-gallery--compact" : ""}`} role="region" aria-roledescription="карусель" aria-label={`Фотографии: ${name}`}>
    <div className="product-gallery__main" style={!compact && ratio ? { aspectRatio: ratio } : undefined} tabIndex={images.length > 1 ? 0 : undefined}
      onKeyDown={(event) => {
        if (images.length < 2 || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        event.preventDefault();
        change(event.key === "ArrowRight" ? 1 : -1);
      }}
      onTouchStart={(event) => { swiped.current = false; touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }}
      onTouchEnd={(event) => {
        if (!touchStart.current || images.length < 2) return;
        const dx = event.changedTouches[0].clientX - touchStart.current.x;
        const dy = event.changedTouches[0].clientY - touchStart.current.y;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { swiped.current = true; change(dx < 0 ? 1 : -1); }
        touchStart.current = null;
      }}
      onClickCapture={(event) => { if (swiped.current) { event.preventDefault(); swiped.current = false; } }}>
      {href ? <Link className="product-gallery__photo" href={href} aria-label={`Открыть товар: ${name}`}>{photo}</Link> : <div className="product-gallery__photo">{photo}</div>}
      {badge && <span className="badge">{badge}</span>}
      {images.length > 1 && <>
        <button className="gallery-arrow gallery-arrow--previous" type="button" aria-label="Предыдущее фото" onClick={() => change(-1)}><ArrowIcon aria-hidden="true" /></button>
        <button className="gallery-arrow gallery-arrow--next" type="button" aria-label="Следующее фото" onClick={() => change(1)}><ArrowIcon aria-hidden="true" /></button>
        <span className={compact ? "visually-hidden" : "gallery-counter"} aria-live="polite" aria-atomic="true">{active + 1} / {images.length}</span>
      </>}
    </div>
    {compact && <div className="gallery-dots" aria-label="Выбор фотографии">
      {images.length > 1 && images.map((item, index) => <button key={`${item.path}-${index}`} type="button" aria-label={`Фото ${index + 1}`} aria-pressed={active === index} onClick={() => setActive(index)}><span /></button>)}
    </div>}
    {!compact && current?.caption && <p className="product-gallery__caption">{current.caption}</p>}
    {!compact && images.length > 1 && <div className="gallery-thumbnails" aria-label="Выбор фотографии">
      {images.map((item, index) => <button key={`${item.path}-${index}`} className="gallery-thumbnail" type="button" aria-label={`Фото ${index + 1}`} aria-pressed={active === index} onClick={() => setActive(index)}>
        <Image src={item.path} alt={`${item.alt || name} — фото ${index + 1}`} fill sizes="72px" />
      </button>)}
    </div>}
  </div>;
}
