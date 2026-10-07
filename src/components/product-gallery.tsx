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
  const [measured, setMeasured] = useState<{ path: string; ratio: number } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const current = images[active] ?? images[0];
  // Keep one stable frame, even when subsequent photos have different proportions.
  const first = images[0];
  const ratio = first?.width && first.height ? first.width / first.height : measured?.path === first?.path ? measured?.ratio : undefined;
  const select = (index: number) => {
    const node = viewport.current;
    if (!node || !images.length) return;
    const next = (index + images.length) % images.length;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wraps = Math.abs(next - active) > 1;
    node.scrollTo({ left: next * node.clientWidth, behavior: reduced || wraps ? "instant" : "smooth" });
    setActive(next);
  };

  return <div className={`product-gallery${compact ? " product-gallery--compact" : ""}`} role="region" aria-roledescription="карусель" aria-label={`Фотографии: ${name}`}>
    <div className="product-gallery__main" style={!compact && ratio ? { aspectRatio: ratio } : undefined} tabIndex={images.length > 1 ? 0 : undefined}
      onKeyDown={(event) => {
        if (images.length < 2 || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        event.preventDefault();
        select(active + (event.key === "ArrowRight" ? 1 : -1));
      }}
      >
      <div ref={viewport} className="product-gallery__viewport"
        onScroll={(event) => {
          const node = event.currentTarget;
          if (node.clientWidth) setActive(Math.max(0, Math.min(images.length - 1, Math.round(node.scrollLeft / node.clientWidth))));
        }}
        onPointerDown={(event) => { swiped.current = false; pointerStart.current = { x: event.clientX, y: event.clientY }; }}
        onPointerMove={(event) => {
          if (!pointerStart.current) return;
          const dx = event.clientX - pointerStart.current.x;
          const dy = event.clientY - pointerStart.current.y;
          if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) swiped.current = true;
        }}
        onPointerUp={() => { pointerStart.current = null; }}
        onPointerCancel={() => { pointerStart.current = null; }}
        onClickCapture={(event) => { if (swiped.current) { event.preventDefault(); swiped.current = false; } }}>
        {images.length ? images.map((item, index) => <div className="product-gallery__slide" key={`${item.path}-${index}`} aria-hidden={index !== active}>
          {href ? <Link className="product-gallery__photo" href={href} tabIndex={index === active ? 0 : -1} aria-label={`Открыть товар: ${name}`}>
            <Image src={item.path} alt={`${item.alt || name} — фото ${index + 1}`} fill sizes="(max-width: 600px) 48vw, (max-width: 900px) 32vw, (max-width: 1200px) 24vw, (max-width: 1600px) 19vw, 250px" />
          </Link> : <div className="product-gallery__photo"><Image src={item.path} alt={`${item.alt || name} — фото ${index + 1}`} fill preload={!compact && index === 0} sizes="(max-width: 700px) 94vw, (max-width: 1200px) 45vw, 480px" onLoad={index === 0 && !compact && !(first?.width && first.height) ? event => {
            const photo = event.currentTarget;
            if (photo.naturalWidth > 0 && photo.naturalHeight > 0) setMeasured({ path: item.path, ratio: photo.naturalWidth / photo.naturalHeight });
          } : undefined} /></div>}
        </div>) : href ? <Link className="product-gallery__photo" href={href} aria-label={`Открыть товар: ${name}`}><span className="image-placeholder">3D</span></Link> : <span className="image-placeholder">3D</span>}
      </div>
      {badge && <span className="badge">{badge}</span>}
      {images.length > 1 && <>
        <button className="gallery-arrow gallery-arrow--previous" type="button" aria-label="Предыдущее фото" onClick={() => select(active - 1)}><ArrowIcon aria-hidden="true" /></button>
        <button className="gallery-arrow gallery-arrow--next" type="button" aria-label="Следующее фото" onClick={() => select(active + 1)}><ArrowIcon aria-hidden="true" /></button>
        <span className={compact ? "visually-hidden" : "gallery-counter"} aria-live="polite" aria-atomic="true">{active + 1} / {images.length}</span>
      </>}
    </div>
    {compact && <div className="gallery-dots" aria-label="Выбор фотографии">
      {images.length > 1 && images.map((item, index) => <button key={`${item.path}-${index}`} type="button" aria-label={`Фото ${index + 1}`} aria-pressed={active === index} onClick={() => select(index)}><span /></button>)}
    </div>}
    {!compact && current?.caption && <p className="product-gallery__caption">{current.caption}</p>}
    {!compact && images.length > 1 && <div className="gallery-thumbnails" aria-label="Выбор фотографии">
      {images.map((item, index) => <button key={`${item.path}-${index}`} className="gallery-thumbnail" type="button" aria-label={`Фото ${index + 1}`} aria-pressed={active === index} onClick={() => select(index)}>
        <Image src={item.path} alt={`${item.alt || name} — фото ${index + 1}`} fill sizes="72px" />
      </button>)}
    </div>}
  </div>;
}
